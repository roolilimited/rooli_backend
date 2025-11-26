import {  Processor } from '@nestjs/bullmq';
import { Job } from 'bull';
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Platform } from '@generated/enums';

@Injectable()
@Processor('engagement-processing')
export class EngagementWorker {
  private readonly logger = new Logger(EngagementWorker.name);

  constructor(private readonly eventEmitter: EventEmitter2) {}

  async processEngagementJob(job: Job<{
    platform: Platform;
    engagementData: any;
    socialAccountId: string;
    organizationId: string;
  }>): Promise<void> {
    const { platform, engagementData, socialAccountId, organizationId } = job.data;

    try {
      this.logger.debug(`Processing ${platform} engagement job ${job.id}`);

      // Emit event for other modules (Analytics, Notifications)
      this.eventEmitter.emit('engagement.received', {
        platform,
        data: engagementData,
        socialAccountId,
        organizationId,
        receivedAt: new Date(),
      });

      this.logger.log(`Successfully processed ${platform} engagement job ${job.id}`);

    } catch (error) {
      this.logger.error(`Failed to process engagement job ${job.id}:`, error.stack);
      throw error; // Let BullMQ handle retries
    }
  }
}