import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import {
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
      this.validateFacebookPost(post, true, true);

      const contentType = post.contentType as ContentType;

      if (contentType === ContentType.REEL) {
        return this.handleReel(post, accessToken, pageId, true);
      }

      // Check for Video (Single)
      const mediaType = this.detectMediaType(post.mediaUrls?.[0]);
      if (mediaType === 'video') {
        return this.handleVideo(post, accessToken, pageId, true);
      }

      return this.handleFeedPost(post, accessToken, pageId, true);
    }, 'schedule Facebook post');
  }

  /** Publish immediately to Facebook */
  async publishImmediately(post: MetaScheduledPost): Promise<PublishingResult> {
    return this.makeApiRequest(async () => {
      const { accessToken, pageId } = post;
      this.validateFacebookPost(post, true, false);

      const contentType = post.contentType as ContentType;

      if (contentType === ContentType.REEL) {
        return this.handleReel(post, accessToken, pageId, false);
      }

      const mediaType = this.detectMediaType(post.mediaUrls?.[0]);
      if (mediaType === 'video') {
        return this.handleVideo(post, accessToken, pageId, false);
      }

      return this.handleFeedPost(post, accessToken, pageId, false);
    }, 'publish immediately to Facebook');
  }

  // ===========================================================================
  // HANDLERS (Unified Logic for Scheduled & Immediate)
  // ===========================================================================

  /**
   * HANDLER A: Feed Post (Text + Photos Only)
   * It is strictly for Photos/Text.
   */
  private async handleFeedPost(
    post: any,
    accessToken: string,
    pageId: string,
    isScheduled: boolean,
  ) {
    const attachedMedia = [];

    // Upload Photos to Staging (Photos Only)
    if (post.mediaUrls?.length) {
      this.logger.log(`Uploading ${post.mediaUrls.length} photos...`);
      for (const url of post.mediaUrls) {
        const id = await this.uploadStagingPhoto(pageId, url, accessToken);
        attachedMedia.push({ media_fbid: id });
      }
    }

    const params: any = {
      message: post.content,
      access_token: accessToken,
      published: !isScheduled,
    };

    if (attachedMedia.length > 0) {
      params.attached_media = JSON.stringify(attachedMedia);
    }

    if (isScheduled) {
      params.scheduled_publish_time = Math.floor(
        new Date(post.scheduledAt).getTime() / 1000,
      );
    }

    const response = await firstValueFrom(
      this.http.post(`${this.baseUrl}/${pageId}/feed`, null, { params }),
    );

    return {
      success: true,
      platformPostId: response.data.id,
      metadata: response.data,
    };
  }

  private async handleVideo(
    post: any,
    accessToken: string,
    pageId: string,
    isScheduled: boolean,
  ) {
    const videoUrl = post.mediaUrls?.[0];
    if (!videoUrl) throw new Error('Video URL missing');

    const params: any = {
      description: post.content, // Acts as the caption
      title: post.content ? post.content.substring(0, 50) : 'Video',
      access_token: accessToken,
      file_url: videoUrl,
      published: !isScheduled, // If false, it creates a "Scheduled" video object
    };

    if (isScheduled) {
      params.scheduled_publish_time = Math.floor(
        new Date(post.scheduledAt).getTime() / 1000,
      );
    }

    this.logger.log(`Posting Video to ${pageId}...`);

    const response = await firstValueFrom(
      this.http.post(`${this.baseUrl}/${pageId}/videos`, null, {
        params,
        timeout: this.uploadTimeout,
      }),
    );
    return {
      success: true,
      platformPostId: response.data.id,
      metadata: response.data,
    };
  }

  private async handleReel(
    post: any,
    accessToken: string,
    pageId: string,
    isScheduled: boolean,
  ) {
    const videoUrl = post.mediaUrls?.[0];
    if (!videoUrl) throw new Error('Reel URL missing');

    const initParams = { access_token: accessToken, upload_phase: 'start' };
    const initRes = await firstValueFrom(
      this.http.post(`${this.baseUrl}/${pageId}/video_reels`, null, {
        params: initParams,
      }),
    );

    const { video_id, upload_url } = initRes.data;

    this.logger.log(`Streaming Reel to Facebook: ${videoUrl}`);
    await this.streamUrlToFacebook(videoUrl, upload_url);

    const finishParams: any = {
      access_token: accessToken,
      upload_phase: 'finish',
      video_id,
      description: post.content,
      video_state: isScheduled ? 'SCHEDULED' : 'PUBLISHED',
    };

    if (isScheduled) {
      finishParams.scheduled_publish_time = Math.floor(
        new Date(post.scheduledAt).getTime() / 1000,
      );
    }

    const finishRes = await firstValueFrom(
      this.http.post(`${this.baseUrl}/${pageId}/video_reels`, null, {
        params: finishParams,
      }),
    );

    return {
      success: true,
      platformPostId: finishRes.data.post_id || video_id,
      metadata: finishRes.data,
    };
  }

  private async uploadStagingPhoto(
    pageId: string,
    url: string,
    accessToken: string,
  ): Promise<string> {
    const params = {
      url: url,
      published: false,
      access_token: accessToken,
      temporary: true,
    };
    const res = await firstValueFrom(
      this.http.post(`${this.baseUrl}/${pageId}/photos`, null, { params }),
    );
    return res.data.id;
  }

  /**
   * CRITICAL: Streams a file from a URL directly to Facebook's upload endpoint.
   * This avoids loading the whole file into memory.
   */
  private async streamUrlToFacebook(
    fileUrl: string,
    uploadEndpoint: string,
  ): Promise<void> {
    // 1. Get the Read Stream from your CDN
    const fileStream = await this.http.axiosRef({
      url: fileUrl,
      method: 'GET',
      responseType: 'stream',
    });

    const totalLength = fileStream.headers['content-length'];

    // 2. Pipe it to Facebook
    // Note: The upload_url provided by Facebook usually contains the auth signature.
    // We strictly send the binary data as the body.
    await this.http.axiosRef({
      url: uploadEndpoint,
      method: 'POST',
      data: fileStream.data,
      headers: {
        Authorization: `OAuth ${fileStream.config.headers['Authorization'] || ''}`, // usually empty/not needed for upload_url
        'Content-Type': 'application/octet-stream',
        'Content-Length': totalLength,
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
  }

  private detectMediaType(url: string = ''): 'video' | 'photo' {
    const isVideo = url.match(/\.(mp4|mov|avi|mkv)$/i) || url.includes('video');
    return isVideo ? 'video' : 'photo';
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

  /** Validate Facebook post data */
  private validateFacebookPost(
    post: MetaScheduledPost,
    requirePageId = false,
    isScheduling = false,
  ): void {
    if (!post) throw new Error('Post data is required');
    if (requirePageId && !post.pageId?.trim())
      throw new Error('Page ID required');
    if (!post.accessToken?.trim()) throw new Error('Access token required');

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

    // 2. Media Validation Logic
    if (post.mediaUrls?.length) {
      // Check invalid URLs
      const invalidUrls = post.mediaUrls.filter((url) => !this.isValidUrl(url));
      if (invalidUrls.length > 0) {
        throw new Error(`Invalid media URL format: ${invalidUrls.join(', ')}`);
      }

      // --- NEW: Check Media Mix ---
      let videoCount = 0;
      let photoCount = 0;

      for (const url of post.mediaUrls) {
        if (this.detectMediaType(url) === 'video') {
          videoCount++;
        } else {
          photoCount++;
        }
      }

      // Rule A: No Mixed Media
      if (videoCount > 0 && photoCount > 0) {
        throw new Error(
          'Facebook does not support mixing Photos and Videos in the same post.',
        );
      }

      // Rule B: Max 1 Video
      if (videoCount > 1) {
        throw new Error('Facebook supports only ONE video per post.');
      }
    }

    if (isScheduling) {
      const scheduleDate = new Date(post.scheduledAt);
      const now = new Date();
      const diffMinutes = (scheduleDate.getTime() - now.getTime()) / 1000 / 60;

      if (diffMinutes < 10) {
        throw new Error(
          'Facebook Native Scheduling requires at least 10 minutes buffer.',
        );
      }
    }
  }

  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }
}
