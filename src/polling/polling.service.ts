import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LinkedinPollingService } from './linkedin-polling.service';
import { XPollingService } from './x-polling.service';
import { Platform } from '@generated/enums';

@Injectable()
export class PollingService {
  private readonly logger = new Logger(PollingService.name);

  constructor(
    private readonly linkedinPollingService: LinkedinPollingService,
    private readonly xPollingService: XPollingService,
  ) {}

  // Poll LinkedIn every 15 minutes
  @Cron('*/15 * * * *')
  async handleLinkedInPolling() {
    this.logger.debug('Starting scheduled LinkedIn engagement poll...');
    try {
      await this.linkedinPollingService.pollForNewEngagements();
    } catch (error) {
      this.logger.error('LinkedIn polling job failed', error.stack);
    }
  }

  // Poll X every 5 minutes (more frequent due to higher volume)
  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleXPolling() {
    this.logger.debug('Starting scheduled X engagement poll...');
    try {
      await this.xPollingService.pollForNewEngagements();
    } catch (error) {
      this.logger.error('X polling job failed', error.stack);
    }
  }

  // Manual trigger for testing or immediate polling
  async manualPoll(platform: Platform): Promise<void> {
    this.logger.debug(`Manual poll triggered for ${platform}`);
    switch (platform) {
      case Platform.LINKEDIN:
        await this.linkedinPollingService.pollForNewEngagements();
        break;
      case Platform.X:
        await this.xPollingService.pollForNewEngagements();
        break;
      default:
        throw new Error(`Unsupported platform for polling: ${platform}`);
    }
  }
}