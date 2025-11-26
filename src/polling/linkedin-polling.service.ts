// src/polling/services/linkedin-polling.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { LinkedinApiClient } from './clients/linkedin-api.client';
import { TooManyRequestsException } from '@/common/filters/too-many-requests.exception';
import { RateLimitService } from '@/rate-limit/rate-limit.service';
import { SocialAccountService } from '@/social-account/social-account.service';
import { Platform } from '@generated/enums';

@Injectable()
export class LinkedinPollingService {
  private readonly logger = new Logger(LinkedinPollingService.name);

  constructor(
    @InjectQueue('engagement-processing') private engagementQueue: Queue,
    private socialAccountService: SocialAccountService,
    private linkedinApiClient: LinkedinApiClient,
    private rateLimitService: RateLimitService,
  ) {}

  async pollForNewEngagements(): Promise<void> {
    this.logger.debug('Polling for LinkedIn engagements...');

    // 1. Fetch all connected LinkedIn accounts
    const linkedinAccounts = await this.socialAccountService.findAllForPlatform(
      Platform.LINKEDIN,
    );

    for (const account of linkedinAccounts) {
      try {
        // 2. Check rate limit BEFORE making API call
        // await this.rateLimitService.checkLimit(
        //   Platform.LINKEDIN,
        //   account.platformAccountId,
        //   'get_engagements',
        // );

        // 3. Get last poll time or default to 2 hours ago
        const lastPolledTime =
          account.lastSyncAt ||
          new Date(Date.now() - 2 * 60 * 60 * 1000);

        // 4. Call LinkedIn API to get new engagements
        const newEngagements = await this.linkedinApiClient.getEngagements(
          account.accessToken,
          account.platformAccountId,
          lastPolledTime,
        );

        this.logger.debug(
          `Found ${newEngagements.length} new engagements for LinkedIn account ${account.id}`,
        );

        // 5. Add each engagement to the processing queue
        for (const engagement of newEngagements) {
          await this.engagementQueue.add('process-engagement', {
            platform: Platform.LINKEDIN,
            engagementData: engagement,
            socialAccountId: account.id,
            organizationId: account.organizationId,
          });
        }

        // 6. Update last polled time
        await this.socialAccountService.updateLastPolledTime(account.id);
      } catch (error) {
        if (error instanceof TooManyRequestsException) {
          this.logger.warn(
            `Rate limit exceeded for LinkedIn account ${account.id}. Skipping.`,
          );
          break; // Stop polling all accounts if we hit rate limit
        }

        this.logger.error(
          `Failed to poll LinkedIn account ${account.id}:`,
          error.stack,
        );
        // Continue with next account even if one fails
        continue;
      }
    }
  }
}
