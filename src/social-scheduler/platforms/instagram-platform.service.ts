import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { BasePlatformService } from './base-platform.service';
import {
  PublishingResult,
  MetaScheduledPost,
  InstagramPublishingResult,
} from '../interfaces/social-scheduler.interface';
import { ContentType } from '@generated/enums';

@Injectable()
export class InstagramPlatformService extends BasePlatformService {
  readonly platform = 'INSTAGRAM';
  private readonly GRAPH_API_URL = 'https://graph.facebook.com/v24.0';
  private readonly MAX_CAROUSEL_ITEMS = 10;
  private readonly POLLING_CONFIG = {
  MAX_ATTEMPTS: 20, 
  DELAY_MS: 3000,
  BACKOFF_FACTOR: 1.5
};

  constructor(http: HttpService) {
    super(http);
  }

  async schedulePost(
    post: MetaScheduledPost,
  ): Promise<InstagramPublishingResult> {
    return this.handlePost(post);
  }

  async publishImmediately(
    post: MetaScheduledPost,
  ): Promise<InstagramPublishingResult> {
    const result = await this.handlePost(post);

    if (result.success && result.containerId) {
      return this.publishContainer(
        post.instagramBusinessId,
        result.containerId,
        post.accessToken,
      );
    }
    return result;
  }

  async deleteScheduledPost(
    containerId: string,
    accessToken: string,
  ): Promise<boolean> {
    return this.makeApiRequest(async () => {
      if (!containerId || !accessToken) throw new Error('Missing ID or Token');

      this.logger.log(`Deleting Instagram Container: ${containerId}`);

      await firstValueFrom(
        this.http.delete(`${this.GRAPH_API_URL}/${containerId}`, {
          params: { access_token: accessToken },
        }),
      );

      return true;
    }, 'delete Instagram container');
  }

  // ===========================================================================
  // THE ORCHESTRATOR
  // ===========================================================================

  private async handlePost(
    post: MetaScheduledPost,
  ): Promise<InstagramPublishingResult> {
    try {
      this.validateRequiredFields(post, ['accessToken', 'instagramBusinessId']);
      this.validateMediaUrls(post.mediaUrls);

      const { accessToken, instagramBusinessId, contentType } = post;

      // 1. REELS
      if (contentType === ContentType.REEL) {
        return await this.handleReel(post, instagramBusinessId, accessToken);
      }

      // 2. CAROUSEL (Mixed Media or Multi-Image)
      if (post.mediaUrls.length > 1) {
        return await this.handleCarousel(
          post,
          instagramBusinessId,
          accessToken,
        );
      }

      // 3. SINGLE MEDIA (Default)
      return await this.handleSingleMedia(
        post,
        instagramBusinessId,
        accessToken,
      );
    } catch (error) {
      return this.handleError(error, 'Instagram Container Creation', {
        postId: post.id,
      });
    }
  }

  // ===========================================================================
  // STRATEGIES
  // ===========================================================================

  private async handleSingleMedia(
    post: MetaScheduledPost,
    igId: string,
    token: string,
  ): Promise<InstagramPublishingResult> {
    const url = post.mediaUrls[0];
    const isVideo = await this.detectMediaType(url);

    const mediaType = isVideo ? 'REELS' : 'IMAGE';

    const params: any = {
      media_type: mediaType,
      caption: post.content || '',
      [isVideo ? 'video_url' : 'image_url']: url,
    };

    if (mediaType === 'REELS') {
      params.share_to_feed = true;
      // If you have cover image metadata, add it here:
      if (post.metadata?.coverUrl) params.cover_url = post.metadata.coverUrl;
    }

    Object.assign(params, this.extractMetadataParams(post.metadata, !isVideo));

    // CREATE CONTAINER
    const containerId = await this.createIGContainer(igId, token, params);

    //WAIT FOR PROCESSING (Crucial for Video/Reels)
    if (isVideo) {
      await this.pollMediaProcessing(containerId, token);
    }

    return {
      success: true,
      containerId,
      mediaType: isVideo ? 'VIDEO' : 'IMAGE',
      containerStatus: 'READY',
    };
  }

 private async handleCarousel(
    post: MetaScheduledPost,
    igId: string,
    token: string,
  ): Promise<InstagramPublishingResult> {
    this.logger.log(`Creating Carousel (${post.mediaUrls.length} items)`);

    // 1. Create Children
    const childPromises = post.mediaUrls.map(async (url) => {
      const isVideo = await this.detectMediaType(url);
      return this.createIGContainer(igId, token, {
        is_carousel_item: true,
        media_type: isVideo ? 'VIDEO' : 'IMAGE',
        [isVideo ? 'video_url' : 'image_url']: url,
      });
    });

    const childIds = await Promise.all(childPromises);

    // 2. Poll Children (Wait for them to be READY)
    await this.pollMultipleContainers(childIds, token);

    // 3. Create Parent
    const containerId = await this.createIGContainer(igId, token, {
      media_type: 'CAROUSEL',
      caption: post.content,
      children: childIds.join(','),
      ...this.extractMetadataParams(post.metadata, false),
    });

    // 4. Poll Parent (Wait for IT to be READY)
    await this.pollMediaProcessing(containerId, token);


    return {
      success: true,
      containerId,
      mediaType: 'CAROUSEL',
      containerStatus: 'READY',
    };
  }

  private async handleReel(
    post: MetaScheduledPost,
    igId: string,
    token: string,
  ): Promise<InstagramPublishingResult> {
    if (post.mediaUrls.length !== 1)
      throw new Error('Reels support exactly 1 video');

    const containerId = await this.createIGContainer(igId, token, {
      media_type: 'REELS',
      video_url: post.mediaUrls[0],
      caption: post.content,
      share_to_feed: post.metadata?.shareToFeed ?? true,
      cover_url: post.metadata?.coverUrl,
      audio_name: post.metadata?.audioName,
      ...this.extractMetadataParams(post.metadata, false),
    });

    await this.pollMediaProcessing(containerId, token);

    return {
      success: true,
      containerId,
      mediaType: 'REEL',
      containerStatus: 'READY',
    };
  }

  // ===========================================================================
  // THE PRIMITIVE (The Unified Creator)
  // ===========================================================================

  /**
   * One method to rule them all.
   * Handles creating Single, Reel, Carousel, and Carousel Items.
   */
  private async createIGContainer(
    igUserId: string,
    accessToken: string,
    params: Record<string, any>,
  ): Promise<string> {
    Object.keys(params).forEach(
      (key) => params[key] === undefined && delete params[key],
    );

    params.access_token = accessToken;

    this.logger.debug(`Creating Container with Body:`, params);

    const response = await this.makeApiRequest(
      () =>
        firstValueFrom(
          this.http.post(`${this.GRAPH_API_URL}/${igUserId}/media`, params),
        ),
      `create container (${params.media_type || 'ITEM'})`,
    );

    return response.data.id;
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private async publishContainer(
    igId: string,
    containerId: string,
    token: string,
  ): Promise<PublishingResult> {
    this.logger.log(`Publishing Container: ${containerId}`);
    const res = await this.makeApiRequest(
      () =>
        firstValueFrom(
          this.http.post(`${this.GRAPH_API_URL}/${igId}/media_publish`, null, {
            params: { access_token: token, creation_id: containerId },
          }),
        ),
      'publish media',
    );
    return { success: true, platformPostId: res.data.id };
  }

  /**
   * Extracts common metadata like Location and User Tags
   */
  private extractMetadataParams(metadata: any, allowUserTags: boolean) {
    if (!metadata) return {};

    const params: any = {};
    if (metadata.locationId) params.location_id = metadata.locationId;
    if (allowUserTags && metadata.userTags)
      params.user_tags = JSON.stringify(metadata.userTags);

    return params;
  }

  private async pollMediaProcessing(containerId: string, token: string) {
    let attempts = 0;
    let delay = this.POLLING_CONFIG.DELAY_MS;

    while (attempts < this.POLLING_CONFIG.MAX_ATTEMPTS) {
      const res = await firstValueFrom(
        this.http.get(`${this.GRAPH_API_URL}/${containerId}`, {
          params: { access_token: token, fields: 'status_code' },
        }),
      );

      const status = res.data.status_code;
      if (status === 'FINISHED') return;
      if (status === 'ERROR')
        throw new Error('Instagram failed to process media');

      attempts++;
      // Exponential backoff
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * this.POLLING_CONFIG.BACKOFF_FACTOR, 10000);
    }
    throw new Error('Media processing timed out');
  }

  private async pollMultipleContainers(ids: string[], token: string) {
    await Promise.all(ids.map((id) => this.pollMediaProcessing(id, token)));
  }

  private validateMediaUrls(urls?: string[]) {
    if (!urls?.length) throw new Error('No media URLs provided');
    if (urls.length > this.MAX_CAROUSEL_ITEMS)
      throw new Error(`Max ${this.MAX_CAROUSEL_ITEMS} items`);
  }

  private async detectMediaType(url: string): Promise<boolean> {
    return url.match(/\.(mp4|mov|avi|mkv)$/i) !== null || url.includes('video');
  }
}
