import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { JobData, Queue } from 'bullmq';

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(@InjectQueue('social-posting') private readonly queue: Queue) {}

  async queueJob(
    post: any,
    delay: number,
  ) {
    const jobData = {
      postId: post.id,
      platform: post.platform,
    };

    return this.queue.add(`post-${post.id}`, jobData, {
      delay,
      jobId: post.id,
      removeOnComplete: true,
      removeOnFail: false,
    });
  }

   async removeQueueJobs(postId: string): Promise<void> {
    try {
      const jobs = await this.queue.getJobs(['waiting', 'delayed', 'active']);
      const jobsToRemove = jobs.filter(
        (job) =>
          job?.data?.postId === postId ||
          job?.id === postId ||
          job?.name === `post-${postId}`,
      );

      await Promise.allSettled(jobsToRemove.map((job) => job.remove()));

      if (jobsToRemove.length > 0) {
        this.logger.log(
          `Removed ${jobsToRemove.length} queue jobs for post ${postId}`,
        );
      }
    } catch (error) {
      this.logger.error(`Error removing queue jobs for post ${postId}:`, error);
      throw error;
    }
  }
}
