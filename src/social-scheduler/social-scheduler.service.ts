import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import {
  CancelResult,
  MetaScheduledPost,
  PlatformServiceMap,
  ScheduleResult,
} from './interfaces/social-scheduler.interface';
import { FacebookPlatformService } from './platforms/facebook-platform.service';
import { InstagramPlatformService } from './platforms/instagram-platform.service';
import { Queue } from 'bullmq';
import { RETRY_CONFIG, ERROR_MESSAGES } from './constants/scheduler.constants';
import * as moment from 'moment-timezone';
import { PreparePostService } from './prepare-post.service';
import { PostRepository } from './post-repo.service';
import { EncryptionService } from '@/common/utility/encryption.service';
import { PrismaService } from '@/prisma/prisma.service';
import { QueueService } from './queue.service';
import { Platform, PostStatus, ScheduleJobStatus } from '@generated/enums';

@Injectable()
export class SocialSchedulerService {
  private readonly logger = new Logger(SocialSchedulerService.name);
  private readonly platformServices: PlatformServiceMap = {};
  private readonly maxRetryCount = RETRY_CONFIG.MAX_RETRIES;

  constructor(
    @InjectQueue('social-posting') private readonly queue: Queue,
    private readonly prisma: PrismaService,
    private readonly facebookService: FacebookPlatformService,
    private readonly encryptionService: EncryptionService,
    private readonly instagramService: InstagramPlatformService,
    private readonly prepareService: PreparePostService,
    private readonly postRepo: PostRepository,
    private readonly queueService: QueueService,
  ) {
    this.registerPlatformServices();
  }

  private registerPlatformServices(): void {
    this.platformServices[Platform.META] = this.facebookService;
    this.platformServices[Platform.INSTAGRAM] = this.instagramService;
  }

  async schedulePost(postId: string): Promise<ScheduleResult> {
    try {
      const post = await this.postRepo.findById(postId);
      const preparedPost = await this.prepareService.preparePlatformPost(post);

      if (preparedPost.platform === Platform.INSTAGRAM) {
        return await this.scheduleInstagramPost(
          preparedPost as MetaScheduledPost,
        );
      }

      if (preparedPost.platform === Platform.FACEBOOK) {
        return await this.scheduleFacebookPost(preparedPost);
      }

      throw new BadRequestException(
        `Unsupported platform for scheduling: ${preparedPost.platform}`,
      );
    } catch (error) {
      return await this.handleSchedulingError(postId, error);
    }
  }

  async publishImmediately(postId: string): Promise<ScheduleResult> {
    try {
      const post = await this.postRepo.findById(postId);
      const preparedPost = await this.prepareService.preparePlatformPost(post);
      const platformService = this.resolvePlatformService(post);

      this.logger.log(
        `Publishing post ${postId} immediately to ${preparedPost.platform}`,
      );

      const result = await platformService.publishImmediately(preparedPost);

      if (!result?.success) {
        throw new Error(result?.error || 'Failed to publish immediately');
      }

      await this.postRepo.updatePublishedPost(post, result);
      return { success: true, jobId: result.platformPostId };
    } catch (error) {
      this.logger.error(
        `Failed to publish post ${postId} immediately: ${error?.message}`,
        error?.stack,
      );
      return await this.handleSchedulingError(postId, error);
    }
  }

  async processScheduledPost(data: any): Promise<void> {
    const { postId } = data;
    const post = await this.postRepo.findById(postId);

    if (post.status !== PostStatus.SCHEDULED) {
      this.logger.warn(
        `Post ${postId} has status ${post.status}, expected SCHEDULED. Skipping.`,
      );
      return;
    }

    try {
      await this.postRepo.updatePostStatus({
        postId,
        status: PostStatus.PUBLISHING,
        queueStatus: ScheduleJobStatus.PROCESSING,
      });

      const platformPost = await this.prepareService.preparePlatformPost(post);

      // Handle Instagram container if present
      if (
        platformPost.platform === Platform.INSTAGRAM &&
        post.metadata?.containerId
      ) {
        this.logger.log(
          `Publishing Instagram container: ${post.metadata.containerId}`,
        );
      }

      const platformService = this.resolvePlatformService(post);
      const result = await platformService.publishImmediately(platformPost);

      if (!result?.success) {
        throw new Error(
          result?.error || ERROR_MESSAGES.PUBLISH_FAILED(platformPost.platform),
        );
      }

      await this.postRepo.markPostAsPublished(postId, result.platformPostId);
      this.logger.log(
        `✅ Successfully published post ${postId} to ${post.platform}`,
      );
    } catch (error) {
      // handleSchedulingError will update DB status and return void; we can still log and rethrow or swallow
      await this.handleSchedulingError(postId, error);
    }
  }

  async cancelScheduledPost(
    postId: string,
    organizationId: string,
  ): Promise<CancelResult> {
    try {
      const post = await this.postRepo.findById(postId, organizationId);
      const metadata = this.extractMetadata(post.metadata);

      // Execute cancellation steps in parallel where possible
      await Promise.allSettled([
        this.cancelPlatformResources(post, metadata),
        this.queueService.removeQueueJobs(postId),
      ]);

      await this.postRepo.markPostAsCancelled(postId);

      this.logger.log(`✅ Successfully cancelled post ${postId}`);
      return {
        success: true,
        message: 'Scheduled post cancelled successfully.',
      };
    } catch (error) {
      this.logger.error(`❌ Error cancelling post ${postId}:`, error);
      return {
        success: false,
        error: error?.message,
        message: 'Failed to cancel scheduled post.',
      };
    }
  }

  async getQueueMetrics() {
    try {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        this.queue.getWaitingCount(),
        this.queue.getActiveCount(),
        this.queue.getCompletedCount(),
        this.queue.getFailedCount(),
        this.queue.getDelayedCount(),
      ]);

      return {
        waiting,
        active,
        completed,
        failed,
        delayed,
        total: waiting + active + delayed,
      };
    } catch (error) {
      this.logger.error('Error getting queue metrics:', error);
      return this.getEmptyMetrics();
    }
  }

  // ==================== Private Methods ====================

  private async scheduleInstagramPost(
    post: MetaScheduledPost,
  ): Promise<ScheduleResult> {
    this.logger.log(`Creating Instagram container for post ${post.id}`);

    const containerResult = await this.instagramService.schedulePost(post);

    if (!containerResult?.success || !containerResult.containerId) {
      throw new Error(
        containerResult?.error || ERROR_MESSAGES.CONTAINER_CREATION_FAILED,
      );
    }

    const containerId = containerResult.containerId;
    const delay = this.calculateDelay(post.scheduledAt, post.timezone);

    const job = await this.queueService.queueJob(post, delay);

    // Use repository method that exists
    await this.postRepo.updateInstagramScheduledPost(
      post.id,
      String(job.id),
      containerId,
    );

    this.logger.log(
      `Scheduled IG post ${post.id} | container: ${containerId} | delay: ${delay}ms`,
    );
    return { success: true, jobId: String(job.id) };
  }

  private async scheduleFacebookPost(post: any): Promise<ScheduleResult> {
    const platformService = this.resolvePlatformService(post);
    const result = await platformService.schedulePost(post);

    if (!result?.success) {
      throw new Error(result?.error || ERROR_MESSAGES.NATIVE_SCHEDULING_FAILED);
    }

    await this.postRepo.updateFacebookScheduledPost(
      post.id,
      result.platformPostId,
    );

    this.logger.log(
      `Scheduled post ${post.id} with Facebook native API, platformPostId: ${result.platformPostId}`,
    );
    return { success: true, jobId: result.platformPostId };
  }

  private calculateDelay(scheduledAt: Date | string, timezone: string): number {
    if (!scheduledAt || !timezone) {
      this.logger.warn(
        'calculateDelay called without scheduledAt or timezone. Defaulting to 0 delay.',
      );
      return 0;
    }

    try {
      const scheduledMoment = moment.tz(scheduledAt, timezone);
      const nowMoment = moment.tz(timezone); // now in timezone
      const delay = Math.max(scheduledMoment.diff(nowMoment), 0);
      this.logger.debug(
        `Calculated delay ${delay}ms for scheduledAt=${scheduledAt} tz=${timezone}`,
      );
      return delay;
    } catch (err) {
      this.logger.error('Failed to calculate delay, defaulting to 0', err);
      return 0;
    }
  }

  private resolvePlatformService(post: any) {
    const platformKey = post?.socialAccount?.platform;
    if (!platformKey) {
      throw new Error(ERROR_MESSAGES.NO_PLATFORM_SERVICE('unknown'));
    }

    // Prefer platform-specific service based on post.platform for META/X split
    if (platformKey === Platform.META) {
      return post.platform === Platform.INSTAGRAM
        ? this.instagramService
        : this.facebookService;
    }

    const service = this.platformServices[platformKey];
    if (!service) {
      throw new Error(ERROR_MESSAGES.NO_PLATFORM_SERVICE(platformKey));
    }
    return service;
  }

  // Database / Media utilities
  private async getMediaFiles(mediaIds: string[]): Promise<string[]> {
    if (!mediaIds?.length) return [];

    const mediaFiles = await this.prisma.mediaFile.findMany({
      where: { id: { in: mediaIds } },
      select: { url: true },
    });

    return mediaFiles.map((f) => f.url);
  }

  // Error Handling - now returns a ScheduleResult so callers can return
  private async handleSchedulingError(
    postId: string,
    error: any,
  ): Promise<ScheduleResult> {
    try {
      const errorMessage = error?.message || 'Unknown error';
      this.logger.error(
        `Scheduling error for post ${postId}: ${errorMessage}`,
        error?.stack,
      );

      await this.prisma.post.update({
        where: { id: postId },
        data: {
          status: PostStatus.FAILED,
          errorMessage: String(errorMessage).substring(0, 1000),
          queueStatus: ScheduleJobStatus.FAILED,
        },
      });
    } catch (dbError) {
      this.logger.error(
        `Failed to update post ${postId} error status:`,
        dbError,
      );
    }

    return {
      success: false,
      error: error?.message || 'Unknown scheduling error',
    };
  }

  // Platform Resource Management
  private async cancelPlatformResources(
    post: any,
    metadata: Record<string, any>,
  ): Promise<void> {
    const targetPlatform = post.platform;
    const containerId = metadata?.containerId;
    const cancellationPromises: Promise<void>[] = [];

    if (targetPlatform === Platform.INSTAGRAM && containerId) {
      cancellationPromises.push(
        this.deleteScheduledPlatformPost(post, String(containerId)),
      );
    }

    if (
      targetPlatform === Platform.FACEBOOK &&
      post.platformPostId &&
      post.status === PostStatus.SCHEDULED
    ) {
      cancellationPromises.push(this.deleteScheduledPlatformPost(post));
    }

    await Promise.allSettled(cancellationPromises);
  }

  // renaming private to avoid duplicate method name with public cancelScheduledPost
  private async deleteScheduledPlatformPost(
    post: any,
    containerId?: string,
  ): Promise<void> {
    const pageAccount = post.pageAccount;
    if (!pageAccount?.accessToken) {
      throw new Error('Missing page access token for post cancellation');
    }

    try {
      const decryptedToken = await this.encryptionService.decrypt(
        pageAccount.accessToken,
      );

      switch (post.platform) {
        case Platform.INSTAGRAM:
          if (!containerId)
            throw new Error('Container ID is required for Instagram');
          await this.instagramService.deleteScheduledPost(
            containerId,
            decryptedToken,
          );
          this.logger.log(`🗑️ Deleted Instagram container: ${containerId}`);
          break;

        case Platform.FACEBOOK:
          if (!post.platformPostId)
            throw new Error('Platform post ID is required for Facebook');
          const fbService = this.platformServices[Platform.META];
          await fbService.deleteScheduledPost(
            post.platformPostId,
            decryptedToken,
          );
          this.logger.log(
            `🗑️ Cancelled native Facebook scheduled post: ${post.platformPostId}`,
          );
          break;

        default:
          this.logger.warn(
            `No platform cancellation implemented for ${post.platform}`,
          );
      }
    } catch (error) {
      const identifier = containerId || post.platformPostId;
      this.logger.error(
        `Failed to cancel ${post.platform} post ${identifier}:`,
        error,
      );
      throw error;
    }
  }

  // Utility Methods
  private extractMetadata(metadata: any): Record<string, any> {
    return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? metadata
      : {};
  }

  private getEmptyMetrics() {
    return {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      total: 0,
    };
  }
}
