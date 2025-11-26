import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { BasePlatformService } from './base-platform.service';
import {
  PublishingResult,
  MetaScheduledPost,
  InstagramPublishingResult,
} from '../interfaces/social-scheduler.interface';

@Injectable()
export class InstagramPlatformService extends BasePlatformService {
  readonly platform = 'INSTAGRAM';
  private readonly GRAPH_API_URL = 'https://graph.facebook.com/v24.0';
  private readonly MAX_CAROUSEL_ITEMS = 10;
  private readonly MAX_POLL_ATTEMPTS = 3;
  private readonly INITIAL_POLL_DELAY_MS = 3000;
  private readonly MAX_POLL_DELAY_MS = 20000;

  constructor(http: HttpService) {
    super(http);
  }

  async schedulePost(post: MetaScheduledPost): Promise<InstagramPublishingResult> {
    try {
      this.validateRequiredFields(post, ['accessToken', 'instagramBusinessId']);

      const { accessToken, instagramBusinessId, contentType } = post;

      this.logger.log('Creating Instagram containers');

      const isReel = this.isReelContent(contentType);

      if (isReel) {
        return await this.scheduleReel(post, instagramBusinessId, accessToken);
      }

      this.validateMediaUrls(post.mediaUrls);

      if (post.mediaUrls.length === 1) {
        return await this.createSingleMediaContainer(
          post,
          instagramBusinessId,
          accessToken,
          contentType,
        );
      }

      return await this.createCarouselContainers(
        post,
        instagramBusinessId,
        accessToken,
      );
    } catch (error) {
      this.logger.error('Schedule failed', {
        error: error.message,
      });
      throw error;
    }
  }

  async publishImmediately(post: MetaScheduledPost): Promise<InstagramPublishingResult> {
    const context = { postId: post.id, operation: 'publish_immediate' };

    try {
      this.validateRequiredFields(post, ['accessToken', 'instagramBusinessId']);

      const { accessToken, instagramBusinessId, containerId, contentType } =
        post;

      // Publish existing container
      if (containerId) {
        this.logger.log('Publishing pre-created container', {
          ...context,
          containerId,
        });
        return await this.publishContainer(
          instagramBusinessId,
          containerId,
          accessToken,
        );
      }

      // Create and publish (no existing container)
      this.logger.log('Creating and publishing immediately', context);

      const isReel = this.isReelContent(contentType);

      if (isReel) {
        return await this.createAndPublishReel(
          post,
          instagramBusinessId,
          accessToken,
        );
      }

      this.validateMediaUrls(post.mediaUrls);

      // Create container
      const containerResult = await this.createContainers(
        post,
        instagramBusinessId,
        accessToken,
      );

      if (!containerResult.success || !containerResult.containerId) {
        throw new Error(containerResult.error || 'Container creation failed');
      }

      // Publish it
      return await this.publishContainer(
        instagramBusinessId,
        containerResult.containerId,
        accessToken,
      );
    } catch (error) {
      this.logger.error('Immediate publish failed', {
        ...context,
        error: error.message,
      });
      return this.handleError(error, 'Instagram publish', context);
    }
  }

  /**
   * Central container publishing method with retry logic
   */
  private async publishContainer(
    igAccountId: string,
    containerId: string,
    accessToken: string,
    retryCount: number = 0,
  ): Promise<PublishingResult> {
    const context = { igAccountId, containerId, retryCount };

    try {
      this.logger.log('Publishing container', context);

      // Check current state
      const state = await this.getContainerState(containerId, accessToken);

      if (state.published) {
        this.logger.warn('Container already published', context);
        return {
          success: true,
          platformPostId: containerId,
          metadata: { containerId, alreadyPublished: true },
        };
      }

      if (!state.ready) {
        this.logger.warn('Container not ready', {
          ...context,
          status: state.status,
        });

        // Retry with exponential backoff (max 3 retries)
        if (retryCount < 3) {
          const delay = Math.min(2000 * Math.pow(2, retryCount), 8000);
          await this.sleep(delay);
          return await this.publishContainer(
            igAccountId,
            containerId,
            accessToken,
            retryCount + 1,
          );
        }

        return {
          success: false,
          error: `Media processing incomplete: ${state.status}`,
          metadata: { containerId, status: state.status, shouldRetry: true },
        };
      }

      // Publish
      const endpoint = `${this.GRAPH_API_URL}/${igAccountId}/media_publish`;
      const response = await this.makeApiRequest(
        () =>
          firstValueFrom(
            this.http.post(endpoint, null, {
              params: { access_token: accessToken, creation_id: containerId },
            }),
          ),
        'publish Instagram media',
      );

      const publishedId = response.data.id;
      this.logger.log('Successfully published', { ...context, publishedId });

      return {
        success: true,
        platformPostId: publishedId,
      };
    } catch (error) {
      this.logger.error('Publish failed', { ...context, error: error.message });

      // Check if it's a transient error worth retrying
      if (this.isRetryableError(error) && retryCount < 2) {
        const delay = 3000 * (retryCount + 1);
        await this.sleep(delay);
        return await this.publishContainer(
          igAccountId,
          containerId,
          accessToken,
          retryCount + 1,
        );
      }

      throw error;
    }
  }

  /**
   * Unified container creation logic
   */
  private async createContainers(
    post: MetaScheduledPost,
    igAccountId: string,
    accessToken: string,
  ): Promise<InstagramPublishingResult> {
    if (post.mediaUrls.length === 1) {
      return await this.createSingleMediaContainer(
        post,
        igAccountId,
        accessToken,
        post.contentType,
      );
    }

    return await this.createCarouselContainers(post, igAccountId, accessToken);
  }

  private async createSingleMediaContainer(
    post: MetaScheduledPost,
    igAccountId: string,
    accessToken: string,
    contentType?: string,
  ) {
    const mediaUrl = post.mediaUrls[0];
    const isVideo = await this.detectMediaType(mediaUrl, contentType);

    this.logger.log('Creating single media container', {
      postId: post.id,
      mediaType: isVideo ? 'VIDEO' : 'IMAGE',
    });

    const containerId = await this.createMediaContainer(
      igAccountId,
      mediaUrl,
      post.content,
      accessToken,
      isVideo,
    );

    if (isVideo) {
      await this.pollMediaProcessing(containerId, accessToken);
    }

    return {
      success: true,
      platformPostId: null,
      containerId,
      mediaType: isVideo ? 'VIDEO' : 'IMAGE',
      containerStatus: 'READY',
    };
  }

  private async createCarouselContainers(
    post: MetaScheduledPost,
    igAccountId: string,
    accessToken: string,
  ) {
    this.logger.log('Creating carousel', {
      postId: post.id,
      itemCount: post.mediaUrls.length,
    });

    // Create all child containers in parallel
    const childPromises = post.mediaUrls.map(async (mediaUrl) => {
      const isVideo = await this.detectMediaType(mediaUrl);
      return await this.createCarouselItemContainer(
        igAccountId,
        mediaUrl,
        accessToken,
        isVideo,
      );
    });

    let childContainerIds: string[];
    try {
      childContainerIds = await Promise.all(childPromises);
    } catch (error) {
      this.logger.error('Failed creating carousel items', {
        postId: post.id,
        error: error.message,
      });
      // Attempt cleanup of any created containers
      await this.cleanupContainers(
        childContainerIds?.filter(Boolean) || [],
        accessToken,
      );
      throw error;
    }

    // Wait for all to process
    await this.pollMultipleContainers(childContainerIds, accessToken);

    // Create carousel container
    const carouselContainerId = await this.createCarouselContainer(
      igAccountId,
      childContainerIds,
      post.content,
      accessToken,
    );

    this.logger.log('Carousel created', {
      postId: post.id,
      containerId: carouselContainerId,
    });

    return {
      success: true,
      platformPostId: null,
      containerId: carouselContainerId,
      childContainerIds,
      itemCount: post.mediaUrls.length,
      mediaType: 'CAROUSEL_ALBUM',
      containerStatus: 'READY',
    };
  }

  private async scheduleReel(
    post: MetaScheduledPost,
    igAccountId: string,
    accessToken: string,
  ) {
    if (!post.mediaUrls?.length) {
      throw new Error('Reel requires a video');
    }

    if (post.mediaUrls.length > 1) {
      throw new Error('Reels support only one video');
    }

    this.logger.log('Creating Reel container', { postId: post.id });

    const containerId = await this.createReelContainer(
      igAccountId,
      post.mediaUrls[0],
      post.content,
      accessToken,
      post.metadata,
    );

    await this.pollMediaProcessing(containerId, accessToken, 60, 3000);

    return {
      success: true,
      platformPostId: null,
      containerId,
      mediaType: 'REELS',
      containerStatus: 'READY',
    };
  }

  private async createAndPublishReel(
    post: MetaScheduledPost,
    igAccountId: string,
    accessToken: string,
  ): Promise<PublishingResult> {
    const reelResult = await this.scheduleReel(post, igAccountId, accessToken);

    if (!reelResult.success || !reelResult.containerId) {
      throw new Error('Failed to create Reel container');
    }

    return await this.publishContainer(
      igAccountId,
      reelResult.containerId,
      accessToken,
    );
  }

  // ============================================
  // CONTAINER CREATION
  // ============================================

  private async createMediaContainer(
    igAccountId: string,
    mediaUrl: string,
    caption: string,
    accessToken: string,
    isVideo: boolean,
  ): Promise<string> {
    const params: any = {
      access_token: accessToken,
      caption: caption || '',
    };

    if (isVideo) {
      params.media_type = 'VIDEO';
      params.video_url = mediaUrl;
    } else {
      params.image_url = mediaUrl;
    }

    const response = await this.makeApiRequest(
      () =>
        firstValueFrom(
          this.http.post(`${this.GRAPH_API_URL}/${igAccountId}/media`, null, {
            params,
          }),
        ),
      'create media container',
    );

    return response.data.id;
  }

  private async createCarouselItemContainer(
    igAccountId: string,
    mediaUrl: string,
    accessToken: string,
    isVideo: boolean,
  ): Promise<string> {
    const params: any = {
      access_token: accessToken,
      is_carousel_item: true,
    };

    if (isVideo) {
      params.media_type = 'VIDEO';
      params.video_url = mediaUrl;
    } else {
      params.image_url = mediaUrl;
    }

    const response = await this.makeApiRequest(
      () =>
        firstValueFrom(
          this.http.post(`${this.GRAPH_API_URL}/${igAccountId}/media`, null, {
            params,
          }),
        ),
      'create carousel item container',
    );

    return response.data.id;
  }

  private async createCarouselContainer(
    igAccountId: string,
    childContainerIds: string[],
    caption: string,
    accessToken: string,
  ): Promise<string> {
    const params = {
      access_token: accessToken,
      media_type: 'CAROUSEL',
      children: childContainerIds.join(','),
      caption: caption || '',
    };

    const response = await this.makeApiRequest(
      () =>
        firstValueFrom(
          this.http.post(`${this.GRAPH_API_URL}/${igAccountId}/media`, null, {
            params,
          }),
        ),
      'create carousel container',
    );

    return response.data.id;
  }

  private async createReelContainer(
    igAccountId: string,
    videoUrl: string,
    caption: string,
    accessToken: string,
    metadata: any,
  ): Promise<string> {
    const params: any = {
      access_token: accessToken,
      media_type: 'REELS',
      video_url: videoUrl,
      caption: caption || '',
      share_to_feed: metadata.shareToFeed !== false,
    };

    if (metadata.coverUrl) {
      params.thumb_offset = metadata.thumbOffset || 0;
    }

    if (metadata.audioName) {
      params.audio_name = metadata.audioName;
    }

    if (metadata.collaborators?.length) {
      params.collaborators = metadata.collaborators.join(',');
    }

    if (metadata.locationId) {
      params.location_id = metadata.locationId;
    }

    const response = await this.makeApiRequest(
      () =>
        firstValueFrom(
          this.http.post(`${this.GRAPH_API_URL}/${igAccountId}/media`, null, {
            params,
          }),
        ),
      'create Reel container',
    );

    return response.data.id;
  }

  // ============================================
  // POLLING & STATUS CHECKS (Will use webhooks when it goes live)
  // ============================================

  /**
   * Poll single container with exponential backoff
   */
  private async pollMediaProcessing(
    containerId: string,
    accessToken: string,
    maxAttempts: number = this.MAX_POLL_ATTEMPTS,
    initialDelay: number = this.INITIAL_POLL_DELAY_MS,
  ): Promise<void> {
    let delay = initialDelay;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const status = await this.checkMediaStatus(containerId, accessToken);

      this.logger.debug('Container status', { containerId, status, attempt });

      if (status === 'FINISHED') {
        return;
      }

      if (status === 'ERROR') {
        throw new Error(`Media processing failed: ${containerId}`);
      }

      if (status === 'EXPIRED') {
        throw new Error(`Container expired: ${containerId}`);
      }

      // Exponential backoff with jitter
      await this.sleep(delay + Math.random() * 500);
      delay = Math.min(delay * 1.5, this.MAX_POLL_DELAY_MS);
    }

    throw new Error(`Processing timeout for container: ${containerId}`);
  }

  /**
   * Poll multiple containers efficiently
   */
  private async pollMultipleContainers(
    containerIds: string[],
    accessToken: string,
  ): Promise<void> {
    const pending = new Set(containerIds);
    let attempt = 0;
    let delay = this.INITIAL_POLL_DELAY_MS;

    while (pending.size > 0 && attempt < this.MAX_POLL_ATTEMPTS) {
      attempt++;

      // Check all pending containers
      const statusChecks = Array.from(pending).map(async (id) => {
        const status = await this.checkMediaStatus(id, accessToken);
        return { id, status };
      });

      const results = await Promise.all(statusChecks);

      // Remove finished containers
      for (const { id, status } of results) {
        if (status === 'FINISHED') {
          pending.delete(id);
        } else if (status === 'ERROR') {
          throw new Error(`Processing failed for container: ${id}`);
        } else if (status === 'EXPIRED') {
          throw new Error(`Container expired: ${id}`);
        }
      }

      if (pending.size > 0) {
        this.logger.debug('Waiting for containers', {
          pending: pending.size,
          attempt,
        });
        await this.sleep(delay);
        delay = Math.min(delay * 1.5, this.MAX_POLL_DELAY_MS);
      }
    }

    if (pending.size > 0) {
      throw new Error(`Processing timeout for ${pending.size} containers`);
    }
  }

  private async getContainerState(
    containerId: string,
    accessToken: string,
  ): Promise<{ ready: boolean; published: boolean; status: string }> {
    const status = await this.checkMediaStatus(containerId, accessToken);

    return {
      ready: status === 'FINISHED',
      published: status === 'PUBLISHED',
      status,
    };
  }

  private async checkMediaStatus(
    containerId: string,
    accessToken: string,
  ): Promise<string> {
    const response = await this.makeApiRequest(
      () =>
        firstValueFrom(
          this.http.get(`${this.GRAPH_API_URL}/${containerId}`, {
            params: { access_token: accessToken, fields: 'status_code' },
          }),
        ),
      'check media status',
    );

    return response.data.status_code || 'IN_PROGRESS';
  }

  // ============================================
  // HELPERS
  // ============================================

  private async detectMediaType(
    url: string,
    explicitType?: string,
  ): Promise<boolean> {
    if (explicitType === 'VIDEO') return true;
    if (explicitType === 'IMAGE') return false;

    // Check extension
    const videoExts = ['.mp4', '.mov', '.avi', '.mkv', '.m4v', '.webm'];
    if (videoExts.some((ext) => url.toLowerCase().includes(ext))) {
      return true;
    }

    // For cloud storage URLs without extensions, try HEAD request
    try {
      const response = await firstValueFrom(
        this.http.head(url, { timeout: 3000 }),
      );
      const contentType = response.headers['content-type'] || '';
      return contentType.startsWith('video/');
    } catch {
      // Default to image if detection fails
      return false;
    }
  }

  private validateMediaUrls(urls: string[] | undefined): void {
    if (!urls?.length) {
      throw new Error('At least one media URL required');
    }

    if (urls.length > this.MAX_CAROUSEL_ITEMS) {
      throw new Error(`Maximum ${this.MAX_CAROUSEL_ITEMS} media items allowed`);
    }
  }

  private isReelContent(contentType?: string): boolean {
    return contentType === 'REELS' || contentType === 'REEL';
  }

  private isRetryableError(error: any): boolean {
    const retryableStatuses = [429, 500, 502, 503, 504];
    return retryableStatuses.includes(error.response?.status);
  }

  private async cleanupContainers(
    containerIds: string[],
    accessToken: string,
  ): Promise<void> {
    const cleanupPromises = containerIds.map((id) =>
      this.deleteScheduledPost(id, accessToken).catch(() => {
        this.logger.warn('Failed to cleanup container', { containerId: id });
      }),
    );

    await Promise.allSettled(cleanupPromises);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async deleteScheduledPost(
    containerId: string,
    accessToken: string,
  ): Promise<boolean> {
    try {
      await this.makeApiRequest(
        () =>
          firstValueFrom(
            this.http.delete(`${this.GRAPH_API_URL}/${containerId}`, {
              params: { access_token: accessToken },
            }),
          ),
        'delete container',
      );

      this.logger.log('Container deleted', { containerId });
      return true;
    } catch (error) {
      this.logger.error('Delete failed', { containerId, error: error.message });
      return false;
    }
  }


  async validateCredentials(
    instagramBusinessId: string,
    accessToken: string,
  ): Promise<boolean> {
    try {
      const response = await firstValueFrom(
        this.http.get(`${this.GRAPH_API_URL}/${instagramBusinessId}`, {
          params: { access_token: accessToken, fields: 'id,username' },
        }),
      );

      this.logger.log('Credentials validated', {
        username: response.data.username,
        id: response.data.id,
      });

      return true;
    } catch (error) {
      this.logger.error('Credential validation failed', {
        error: error.message,
      });
      return false;
    }
  }
}
