import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bull';
import { XApiClient } from './clients/x-api.client';
import { TooManyRequestsException } from '@/common/filters/too-many-requests.exception';
import { RateLimitService } from '@/rate-limit/rate-limit.service';
import { SocialAccountService } from '@/social-account/social-account.service';
import { Platform } from '@generated/enums';

@Injectable()
export class XPollingService {
  private readonly logger = new Logger(XPollingService.name);

  constructor(
    @InjectQueue('engagement-processing') private engagementQueue: Queue,
    private socialAccountService: SocialAccountService,
    private xApiClient: XApiClient,
    private rateLimitService: RateLimitService,
  ) {}

  async pollForNewEngagements(): Promise<void> {
    this.logger.debug('Polling for X engagements...');
    
    const xAccounts = await this.socialAccountService.findAllForPlatform(Platform.X);

    for (const account of xAccounts) {
      try {
        // Check rate limit for X API
        // await this.rateLimitService.checkLimit(
        //   Platform.X,
        //   account.platformAccountId,
        //   'get_tweet_engagements'
        // );

        const lastPolledTime = account.lastSyncAt 
          || new Date(Date.now() - 30 * 60 * 1000); // 30 minutes ago for X

        const newEngagements = await this.xApiClient.getEngagements(
          account.accessToken,
          account.platformAccountId,
          lastPolledTime,
        );

        this.logger.debug(`Found ${newEngagements.length} new engagements for X account ${account.id}`);

        for (const engagement of newEngagements) {
          await this.engagementQueue.add('process-engagement', {
            platform: Platform.X,
            engagementData: engagement,
            socialAccountId: account.id,
            organizationId: account.organizationId,
          });
        }

        await this.socialAccountService.updateLastPolledTime(account.id);

      } catch (error) {
        if (error instanceof TooManyRequestsException) {
          this.logger.warn(`Rate limit exceeded for X account ${account.id}. Skipping.`);
          break;
        }
        
        this.logger.error(`Failed to poll X account ${account.id}:`, error.stack);
        continue;
      }
    }
  }
}