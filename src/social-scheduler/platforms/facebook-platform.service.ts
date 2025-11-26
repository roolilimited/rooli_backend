import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import {
  ScheduledPost,
  PublishingResult,
  MetaScheduledPost,
} from '../interfaces/social-scheduler.interface';
import { BasePlatformService } from './base-platform.service';
import { Platform, ContentType } from '@generated/enums';

@Injectable()
export class FacebookPlatformService extends BasePlatformService {
  readonly platform = Platform.FACEBOOK;
  private readonly baseUrl = 'https://graph.facebook.com/v24.0';
  private readonly maxContentLength = 63206;
  private readonly concurrencyLimit = 3;
  private readonly uploadTimeout = 60000;
  private readonly requestTimeout = 30000;
  protected readonly logger = new Logger(FacebookPlatformService.name);

  constructor(http: HttpService) {
    super(http);
  }

  /** Schedule a Facebook post */
  async schedulePost(post: MetaScheduledPost): Promise<PublishingResult> {
    return this.makeApiRequest(async () => {
      const { accessToken, pageId } = post;
      this.validateFacebookPost(post, true);
      console.log(post);
      // Check content type first, then fall back to media detection
      const contentType = post.contentType as ContentType;
      console.log('Content type for scheduling:', contentType);

      if (contentType === ContentType.REEL) {
        return this.scheduleReelPost(post, accessToken, pageId);
      }

      const mediaType = this.detectMediaType(post.mediaUrls?.[0] || '');

      if (mediaType === 'video') {
        return this.scheduleVideoPost(post, accessToken, pageId);
      }

      if (mediaType === 'photo') {
        return this.schedulePhotoPost(post, accessToken, pageId);
      }
    }, 'schedule Facebook post');
  }

  /** Publish immediately to Facebook */
  async publishImmediately(post: MetaScheduledPost): Promise<PublishingResult> {
    return this.makeApiRequest(async () => {
      const { accessToken, pageId } = post;
      this.validateFacebookPost(post, true);

      // Check content type first, then fall back to media detection
      const contentType = post.contentType as ContentType;

      if (contentType === ContentType.REEL) {
        return this.publishReelImmediately(post, accessToken, pageId);
      }

      const mediaType = this.detectMediaType(post.mediaUrls?.[0] || '');

      if (mediaType === 'video') {
        return this.publishVideoImmediately(post, accessToken, pageId);
      }

      if (mediaType === 'photo') {
        return this.publishPhotoImmediately(post, accessToken, pageId);
      }
    }, 'publish immediately to Facebook');
  }

  /** Schedule a Facebook video post */
  private async scheduleVideoPost(
    post: ScheduledPost,
    accessToken: string,
    pageId: string,
  ): Promise<PublishingResult> {
    const videoUrl = post.mediaUrls?.[0];
    if (!videoUrl) throw new Error('Video URL is required for video posts');

    const uploadUrl = `${this.baseUrl}/${pageId}/videos`;
    const utcSeconds = Math.floor(new Date(post.scheduledAt).getTime() / 1000);

    const params = {
      file_url: videoUrl,
      published: false,
      scheduled_publish_time: utcSeconds,
      description: post.content || '',
      access_token: accessToken,
    };

    this.logger.log(
      `Scheduling Facebook video for page ${pageId} at ${utcSeconds}`,
    );

    const response = await firstValueFrom(
      this.http.post(uploadUrl, null, {
        params,
        timeout: this.uploadTimeout,
      }),
    );

    this.logger.log(`Scheduled video upload response: ${response.data}`);

    return {
      success: true,
      platformPostId: response.data.id,
      metadata: response.data,
    };
  }

  /** Schedule photo post */
  private async schedulePhotoPost(
    post: ScheduledPost,
    accessToken: string,
    pageId: string,
  ): Promise<PublishingResult> {
    const mediaAttachments = await this.handleMediaUpload(
      pageId,
      post.mediaUrls,
      accessToken,
    );

    const params = this.buildPostScheduleParams(
      post,
      accessToken,
      mediaAttachments,
    );

    const url = `${this.baseUrl}/${pageId}/feed`;

    const response = await firstValueFrom(
      this.http.post(url, null, { params, timeout: this.requestTimeout }),
    );

    return {
      success: true,
      platformPostId: response.data.id,
      metadata: response.data,
    };
  }

  /** Schedule a Facebook Reel */
private async scheduleReelPost(
  post: ScheduledPost,
  accessToken: string,
  pageId: string,
): Promise<PublishingResult> {
  const videoUrl = post.mediaUrls?.[0];
  if (!videoUrl) throw new Error('Video URL is required for Reel posts');

  const { videoId, uploadUrl } = await this.initiateReelUpload(pageId, accessToken);
  await this.uploadVideoFileFromUrl(uploadUrl, videoUrl, accessToken);

  const utcSeconds = Math.floor(new Date(post.scheduledAt).getTime() / 1000);

  const params = {
    upload_phase: 'finish',
    video_id: videoId,
    description: post.content || '',
    video_state: 'SCHEDULED',
    scheduled_publish_time: utcSeconds,
    access_token: accessToken,
  };

  const finishUrl = `${this.baseUrl}/${pageId}/video_reels`;

  this.logger.log(`Scheduling Facebook Reel for page ${pageId} at ${utcSeconds}`);

  const response = await firstValueFrom(
    this.http.post(finishUrl, null, {
      params,
      timeout: this.uploadTimeout,
    }),
  );

  return {
    success: true,
    platformPostId: response.data.post_id,
    metadata: response.data,
  };
}


  /** Publish a Facebook video immediately */
  private async publishVideoImmediately(
    post: ScheduledPost,
    accessToken: string,
    pageId: string,
  ): Promise<PublishingResult> {
    const videoUrl = post.mediaUrls?.[0];
    if (!videoUrl) throw new Error('Video URL is required for video posts');

    const uploadUrl = `${this.baseUrl}/${pageId}/videos`;

    const params = {
      file_url: videoUrl,
      published: true,
      description: post.content || '',
      access_token: accessToken,
    };

    this.logger.log(`Publishing video immediately for page ${pageId}`);

    const response = await firstValueFrom(
      this.http.post(uploadUrl, null, {
        params,
        timeout: this.uploadTimeout,
      }),
    );

    console.log('response:', response.data);
    //this.logger.log(`Video publish response: ${response.data}`);

    return {
      success: true,
      platformPostId: response.data.id,
      publishedAt: new Date(),
      metadata: response.data,
    };
  }

  /** Publish a Facebook photo immediately */
  private async publishPhotoImmediately(
    post: ScheduledPost,
    accessToken: string,
    pageId: string,
  ): Promise<PublishingResult> {
    const mediaAttachments = await this.handleMediaUpload(
      pageId,
      post.mediaUrls,
      accessToken,
    );

    const params = this.buildPublishParams(post, accessToken, mediaAttachments);

    const url = `${this.baseUrl}/${pageId}/feed`;

    this.logger.log(`Publishing photo immediately for page ${pageId}`);

    const response = await firstValueFrom(
      this.http.post(url, null, { params, timeout: this.requestTimeout }),
    );

    console.log('Photo immediately publish response:', response.data);

    return {
      success: true,
      platformPostId: response.data.id,
      publishedAt: new Date(),
      metadata: response.data,
    };
  }

  /** Publish a Facebook Reel immediately */
  private async publishReelImmediately(
    post: ScheduledPost,
    accessToken: string,
    pageId: string,
  ): Promise<PublishingResult> {
    const videoUrl = post.mediaUrls?.[0];
    if (!videoUrl) throw new Error('Video URL is required for Reel posts');

    const { videoId, uploadUrl } = await this.initiateReelUpload(
      pageId,
      accessToken,
    );

    await this.uploadVideoFileFromUrl(uploadUrl, videoUrl, accessToken);

    const params = {
      upload_phase: 'finish',
      video_id: videoId,
      video_state: 'PUBLISHED',
      description: post.content || '',
      access_token: accessToken,
    };

    this.logger.log(`Publishing Reel immediately for page ${pageId}`);

    const response = await firstValueFrom(
      this.http.post(uploadUrl, null, {
        params,
        timeout: this.uploadTimeout,
      }),
    );

    this.logger.log(`Reel publish response: ${response.data}`);

    return {
      success: true,
      platformPostId: response.data.post_id,
      publishedAt: new Date(),
      metadata: response.data,
    };
  }

  /** Delete a scheduled Facebook post */
  async deleteScheduledPost(
    postId: string,
    accessToken: string,
  ): Promise<boolean> {
    return this.makeApiRequest(async () => {
      if (!postId?.trim()) {
        throw new Error('Post ID is required');
      }
      if (!accessToken?.trim()) {
        throw new Error('Access token is required');
      }

      const url = `${this.baseUrl}/${postId}`;
      await firstValueFrom(
        this.http.delete(url, {
          params: { access_token: accessToken },
          timeout: this.requestTimeout,
        }),
      );

      this.logger.log(`Successfully deleted scheduled post: ${postId}`);
      return true;
    }, 'delete Facebook scheduled post');
  }

  /** Validate that the provided token and page are correct */
  async validateCredentials(accessToken: string): Promise<boolean> {
    try {
      if (!accessToken?.trim()) {
        return false;
      }

      const response = await firstValueFrom(
        this.http.get(`${this.baseUrl}/me`, {
          params: { access_token: accessToken, fields: 'id,name' },
          timeout: this.requestTimeout,
        }),
      );

      const isValid = !!response.data?.id;
      this.logger.log(`Facebook credential validation: ${isValid}`);
      return isValid;
    } catch (error) {
      this.logger.warn('Facebook credential validation failed:', error.message);
      return false;
    }
  }

  /** Handle media upload with proper validation */
  private async handleMediaUpload(
    pageId: string,
    mediaUrls: string[] | undefined,
    accessToken: string,
  ): Promise<string[]> {
    if (!mediaUrls?.length) {
      return [];
    }

    this.logger.log(
      `Uploading ${mediaUrls.length} media files to Facebook for page ${pageId}`,
    );

    const uploadedFbIds: string[] = [];
    const batches = this.createBatches(mediaUrls, this.concurrencyLimit);

    for (const [batchIndex, batch] of batches.entries()) {
      const results = await Promise.allSettled(
        batch.map((url, index) =>
          this.uploadSingleMediaFile(pageId, url, accessToken),
        ),
      );

      results.forEach((result, index) => {
        const mediaUrl = batch[index];
        if (result.status === 'fulfilled' && result.value) {
          uploadedFbIds.push(result.value);
          this.logger.log(
            `Successfully uploaded media: ${mediaUrl} -> ${result.value}`,
          );
        } else if (result.status === 'rejected') {
          this.logger.warn(
            `Failed to upload media in batch ${batchIndex}, item ${index}: ${mediaUrl}`,
            result.reason,
          );
        }
      });
    }

    this.logger.log(
      `Successfully uploaded ${uploadedFbIds.length}/${mediaUrls.length} media files`,
    );
    return uploadedFbIds;
  }

  /** Handle single media upload (image, video, or reel) */
  private async uploadSingleMediaFile(
    pageId: string,
    mediaUrl: string,
    accessToken: string,
  ): Promise<string | null> {
    try {
      const mediaType = this.detectMediaType(mediaUrl);
      const endpoint = this.getEndpointForMediaType(mediaType);
      const uploadUrl = `${this.baseUrl}/${pageId}/${endpoint}`;
      const params = this.buildMediaUploadParams(
        mediaUrl,
        mediaType,
        accessToken,
      );

      this.logger.log(`Uploading ${mediaType} to Facebook for page ${pageId}`);

      const response = await firstValueFrom(
        this.http.post(uploadUrl, null, {
          params,
          timeout: this.uploadTimeout,
        }),
      );

      const mediaId = response.data?.id;
      if (!mediaId) {
        throw new Error('No media ID returned from Facebook');
      }

      this.logger.log(`Successfully uploaded media with ID: ${mediaId}`);
      return mediaId;
    } catch (error) {
      this.logger.error(
        `Failed to upload media to Facebook: ${mediaUrl}`,
        error.stack || error.message,
      );
      throw error; // Re-throw to let caller handle
    }
  }

  private buildPostScheduleParams(
    post: ScheduledPost,
    accessToken: string,
    mediaAttachments: string[],
  ): Record<string, any> {
    const utcSeconds = Math.floor(new Date(post.scheduledAt).getTime() / 1000);

    this.logger.log(`Scheduling Facebook post at UTC time: ${utcSeconds}`);

    const params: Record<string, any> = {
      message: post.content,
      scheduled_publish_time: utcSeconds,
      published: false,
      access_token: accessToken,
    };

    if (mediaAttachments.length > 0) {
      params.attached_media = JSON.stringify(
        mediaAttachments.map((id) => ({ media_fbid: id })),
      );
    }

    return params;
  }

  /** Build params for immediate publish */
  private buildPublishParams(
    post: ScheduledPost,
    accessToken: string,
    mediaAttachments: string[],
  ): Record<string, any> {
    const params: Record<string, any> = {
      message: post.content,
      access_token: accessToken,
    };

    if (mediaAttachments.length > 0) {
      params.attached_media = JSON.stringify(
        mediaAttachments.map((id) => ({ media_fbid: id })),
      );
    }

    return params;
  }

  /** Build parameters for Facebook media upload */
  private buildMediaUploadParams(
    mediaUrl: string,
    mediaType: 'photo' | 'video' | 'reel',
    accessToken: string,
  ): Record<string, any> {
    const baseParams = {
      access_token: accessToken,
      published: false,
    };

    switch (mediaType) {
      case 'photo':
        return { ...baseParams, url: mediaUrl };
      case 'video':
        return { ...baseParams, file_url: mediaUrl };
      case 'reel':
        return { ...baseParams, video_url: mediaUrl };
      default:
        throw new Error(`Unsupported media type: ${mediaType}`);
    }
  }

  /** Detect media type from URL */
  private detectMediaType(url: string): 'photo' | 'video' | 'reel' {
    if (!url) return 'photo';

    const lowerUrl = url.toLowerCase();

    if (lowerUrl.includes('reel')) {
      return 'reel';
    }

    const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
    if (videoExtensions.some((ext) => lowerUrl.includes(ext))) {
      return 'video';
    }

    return 'photo';
  }

  /** Get API endpoint for media type */
  private getEndpointForMediaType(
    mediaType: 'photo' | 'video' | 'reel',
  ): string {
    const endpoints = {
      photo: 'photos',
      video: 'videos',
      reel: 'video_reels',
    };

    if (!endpoints[mediaType]) {
      throw new Error(`Unsupported media type: ${mediaType}`);
    }

    return endpoints[mediaType];
  }

  /** Create batches from array */
  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  /** Validate URL format */
  private isValidUrl(url: string): boolean {
    if (!url?.trim()) {
      return false;
    }
    try {
      const urlObj = new URL(url);
      return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
    } catch {
      return false;
    }
  }

  /** Validate Facebook post data */
  private validateFacebookPost(
    post: MetaScheduledPost,
    requirePageId = false,
  ): void {
    if (!post) {
      throw new Error('Post data is required');
    }

    if (requirePageId && !post.pageId?.trim()) {
      throw new Error('Page ID is required for Facebook page operations');
    }

    if (!post.accessToken?.trim()) {
      throw new Error('Access token is required');
    }

    if (post.content && post.content.length > this.maxContentLength) {
      throw new Error(
        `Facebook post content exceeds ${this.maxContentLength} character limit`,
      );
    }

    if (post.mediaUrls?.length) {
      const invalidUrls = post.mediaUrls.filter((url) => !this.isValidUrl(url));
      if (invalidUrls.length > 0) {
        throw new Error(`Invalid media URL format: ${invalidUrls.join(', ')}`);
      }
    }
  }

  private async initiateReelUpload(
    pageId: string,
    token: string,
  ): Promise<{ videoId: string; uploadUrl: string }> {
    const url = `${this.baseUrl}/${pageId}/video_reels`;
    const params = {
      upload_phase: 'start',
      access_token: token,
    };

    const response = await firstValueFrom(
      this.http.post(url, null, {
        params,
        timeout: this.uploadTimeout,
      }),
    );

    this.logger.log('Reel upload initiation response:', response.data);

    const { video_id, upload_url } = response.data || {};

    if (!video_id || !upload_url) {
      throw new Error(
        `Reel initialization failed: missing video_id or upload_url. Response: ${JSON.stringify(
          response.data,
        )}`,
      );
    }

    return { videoId: video_id, uploadUrl: upload_url };
  }

  // Add this missing method
  private async uploadVideoFileFromUrl(
    uploadUrl: string, // use the upload_url from start phase
    videoUrl: string, // your CDN URL
    accessToken: string, // page access token
  ): Promise<void> {
    const headers: Record<string, string> = {
      Authorization: `OAuth ${accessToken}`,
      file_url: videoUrl,
    };

    const response = await firstValueFrom(
      this.http.post(uploadUrl, null, {
        headers,
        timeout: this.uploadTimeout,
      }),
    );

    this.logger.log('Hosted video file upload response:', response.data);

    if (!response.data?.success) {
      throw new Error(
        `Video file upload failed: ${JSON.stringify(response.data)}`,
      );
    }
  }
}
