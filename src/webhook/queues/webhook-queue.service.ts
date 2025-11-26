import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { WebhookService } from '../webhook.service';
import { Platform } from '@generated/enums';

@Injectable()
export class WebhookQueueService {
  private readonly logger = new Logger(WebhookQueueService.name);

  constructor(
    @InjectQueue('webhook-processing') private readonly webhookQueue: Queue,
  ) {}

  async addWebhookJob(jobData: {
    platform: Platform;
    rawBody: string;
    headers: Record<string, string>;
    parsedBody: any;
  }): Promise<void> {
    try {
      await this.webhookQueue.add('process-webhook', jobData, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 50, // Keep last 50 completed jobs for debugging
        removeOnFail: 100, // Keep last 100 failed jobs
      });
      this.logger.debug(`[${jobData.platform}] Webhook job added to queue`);
    } catch (error) {
      this.logger.error(
        `Failed to add webhook job to queue: ${error.message}`,
        error.stack,
      );
      throw error; // Let the controller handle this
    }
  }

  // Optional: Method to get queue metrics for monitoring
  async getQueueStats() {
    return {
      waiting: await this.webhookQueue.getWaitingCount(),
      active: await this.webhookQueue.getActiveCount(),
      completed: await this.webhookQueue.getCompletedCount(),
      failed: await this.webhookQueue.getFailedCount(),
    };
  }
}
