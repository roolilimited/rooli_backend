import { Injectable, Logger } from '@nestjs/common';
import { MetaWebhookStrategy } from './strategies/meta-webhook.strategy';
import { ParsedWebhookPayload, WebhookEvent, WebhookStrategy } from './types/webhook.types';
import { PrismaService } from '@/prisma/prisma.service';
import { Platform } from '@generated/enums';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private strategies: Map<Platform, WebhookStrategy> = new Map();

  constructor(
    private readonly prisma: PrismaService,
    private readonly metaStrategy: MetaWebhookStrategy,
  ) {
    this.strategies.set(Platform.INSTAGRAM, metaStrategy);
    this.strategies.set(Platform.FACEBOOK, metaStrategy);
  }

  async verifyWebhookSignature(
    platform: Platform,
    rawBody: string,
    headers: Record<string, string>,
  ): Promise<boolean> {
    const strategy = this.strategies.get(platform);
    if (!strategy) {
      this.logger.warn(
        `[${platform}] No strategy found for signature verification.`,
      );
      return false;
    }

    const signature =
      headers['x-hub-signature'] || headers['x-hub-signature-256'];
    return strategy.verifySignature(rawBody, signature, headers);
  }

  /**
   * This method is now called by the QUEUE WORKER (BullMQ processor)
   * It does the heavy lifting: parsing, DB operations, etc.
   */
  async processIncomingWebhook(
    platform: Platform,
    rawBody: string,
    headers: Record<string, string>,
    parsedBody: any, // Already parsed by the controller
  ): Promise<WebhookEvent> {
    const strategy = this.strategies.get(platform);
    if (!strategy) {
      this.logger.warn(`[${platform}] No strategy found, skipping webhook.`);
      return;
    }

    try {
      // Signature was already verified by the controller before queuing
      // Now parse the payload for processing
      const { externalId, platformAccountId, eventType }: ParsedWebhookPayload =
        strategy.parsePayload(parsedBody);

      // Lookup org
      const organizationId = await this.lookupOrganizationId(
        platform,
        platformAccountId,
      );
      if (!organizationId) {
        this.logger.warn(
          `[${platform}] No org found for accountId=${platformAccountId}`,
        );
        return;
      }

      // Store event (dedupe handled by @@unique)
      const webhookEvent = await this.prisma.webhookEvent.upsert({
        where: { platform_externalId: { platform, externalId } },
        update: {}, // ignore duplicates
        create: {
          platform,
          eventType,
          externalId,
          platformAccountId,
          payload: parsedBody, // Use the already-parsed body
          organizationId,
        },
      });

      this.logger.log(
        `[${platform}] Successfully processed webhook event ${webhookEvent.id}`,
      );
      return webhookEvent;

      // Here you would emit events for other modules (Analytics, Inbox)
      // e.g., this.eventEmitter.emit('webhook.processed', webhookEvent);
    } catch (error) {
      this.logger.error(
        `[${platform}] Failed to process webhook from queue: ${error.message}`,
        error.stack,
      );
      // You might want to throw the error to let the queue handle retries
      throw error;
    }
  }

  // ====== VERIFICATION METHOD ======
  handleVerificationRequest(platform: Platform, query: any, body: any): string {
    const strategy = this.strategies.get(platform);
    if (!strategy) throw new Error(`No verification strategy for ${platform}`);

    const challengeResponse = strategy.handleVerification(query, body);
    if (!challengeResponse) throw new Error('Verification failed');
    return challengeResponse;
  }

  private async lookupOrganizationId(
    platform: Platform,
    platformAccountId?: string,
  ): Promise<string | null> {
    if (!platformAccountId) return null;
    const account = await this.prisma.socialAccount.findFirst({
      where: { platform, platformAccountId },
      select: { organizationId: true },
    });
    return account?.organizationId || null;
  }


}
