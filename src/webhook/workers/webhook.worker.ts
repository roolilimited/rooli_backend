import { Processor } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bull';
import { WebhookService } from '../webhook.service';
import { WebhookProcessingService } from '../webhook-processing.service';
import { Platform } from '@generated/enums';

@Injectable()
@Processor('webhook-processing') // This decorator makes it a consumer
export class WebhookWorker {
  private readonly logger = new Logger(WebhookWorker.name);

  constructor(
    private readonly webhookService: WebhookService,
    private readonly webhookProcessingService: WebhookProcessingService,
  ) {}

 // @Process('process-webhook')
  async processWebhookJob(
    job: Job<{
      platform: Platform;
      rawBody: string;
      headers: Record<string, string>;
      parsedBody: any;
    }>,
  ): Promise<void> {
    const { platform, rawBody, headers, parsedBody } = job.data;

    this.logger.debug(`[${platform}] Starting job ${job.id}`);

    try {
      // 1. Initial processing (validation, parsing, saving to webhook_events)
      const webhookEvent = await this.webhookService.processIncomingWebhook(
        platform,
        rawBody,
        headers,
        parsedBody,
      );

      // 2. Business logic processing (analytics, inbox events)
      //await this.webhookProcessingService.processWebhookEvent(webhookEvent);

      this.logger.log(`[${platform}] Job ${job.id} completed successfully`);
    } catch (error) {
      this.logger.error(
        `[${platform}] Job ${job.id} failed: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}
