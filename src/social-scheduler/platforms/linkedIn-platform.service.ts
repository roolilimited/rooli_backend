import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

import {
  ScheduledPost,
  PublishingResult,
  LinkedInScheduledPost,
} from '../interfaces/social-scheduler.interface';
import { BasePlatformService } from './base-platform.service';
import * as https from 'https';

@Injectable()
export class LinkedInPlatformService extends BasePlatformService {
  readonly platform = 'LINKEDIN';
  private readonly API_VERSION = '202501'; // Use a recent version
  private readonly BASE_URL = 'https://api.linkedin.com/rest';

  private readonly httpsAgent = new https.Agent({
    family: 4, // FORCE IPv4
    keepAlive: true,
    timeout: 30000,
  });

  constructor(http: HttpService) {
    super(http);
  }

  // ===========================================================================
  // PUBLIC METHODS
  // ===========================================================================

  /**
   * We essentially just validate the token here.
   * We do NOT pre-upload assets because LinkedIn assets can expire if unused.
   */
  async schedulePost(post: LinkedInScheduledPost): Promise<PublishingResult> {
    return this.makeApiRequest(async () => {
      this.validatePost(post);
      // We return success to tell the Scheduler "Go ahead and queue this in BullMQ"
      // We don't return a containerId because we build it Just-In-Time.
      return { success: true };
    }, 'validate LinkedIn post');
  }

  async publishImmediately(
    post: LinkedInScheduledPost,
  ): Promise<PublishingResult> {
    return this.makeApiRequest(async () => {
      this.validatePost(post);
      const { accessToken, accountId, content, mediaUrls } = post;

      const authorUrn = this.formatAuthorUrn(accountId);

      // Upload Assets (Images/Videos)
      const assets: string[] = [];
      if (mediaUrls?.length) {
        this.logger.log(`Uploading ${mediaUrls.length} assets to LinkedIn...`);
        for (const url of mediaUrls) {
          const assetUrn = await this.handleMediaUpload(
            url,
            accessToken,
            authorUrn,
          );
          if (assetUrn) assets.push(assetUrn);
        }
      }

      // Create the Post
      return await this.createPost(authorUrn, content, assets, accessToken);
    }, 'publish immediately to LinkedIn');
  }

  //this deletes the live post
  async deleteScheduledPost(
    postId: string,
    accessToken: string,
  ): Promise<boolean> {
    return this.makeApiRequest(async () => {
      if (!postId) throw new Error('Post ID (URN) is required');

      const urn = this.formatPostUrn(postId);
      const encodedUrn = encodeURIComponent(urn);

      await firstValueFrom(
        this.http.delete(`${this.BASE_URL}/posts/${encodedUrn}`, {
          httpsAgent: this.httpsAgent,
          headers: this.getHeaders(accessToken),
        }),
      );

      this.logger.log(`Deleted LinkedIn Post: ${postId}`);
      return true;
    }, 'delete LinkedIn post');
  }

  // ===========================================================================
  // POST CREATION LOGIC
  // ===========================================================================

  private async createPost(
    authorUrn: string,
    text: string,
    assetUrns: string[], // e.g. ["urn:li:image:...", "urn:li:video:..."]
    accessToken: string,
  ): Promise<PublishingResult> {
    // 1. VALIDATE MEDIA TYPES
    const hasVideo = assetUrns.some((urn) => urn.includes(':video:'));
    const hasImage = assetUrns.some((urn) => urn.includes(':image:'));

    if (hasVideo && hasImage) {
      throw new Error(
        'LinkedIn does not support mixing Photos and Videos in the same post.',
      );
    }

    if (hasVideo && assetUrns.length > 1) {
      throw new Error('LinkedIn supports only ONE video per post.');
    }

    const postBody: any = {
      author: authorUrn,
      commentary: text || '',
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };

    // Attach Media
    if (assetUrns.length > 0) {
      if (assetUrns.length === 1) {
        // Single Media
        const urn = assetUrns[0];
        if (urn.includes(':image:')) {
          postBody.content = { media: { id: urn } }; // Single Image
        } else if (urn.includes(':video:')) {
          postBody.content = { media: { id: urn } }; // Single Video
        }
      } else {
        // Multi-Image (Carousel is slightly different, but Multi-Image is standard)
        // Note: LinkedIn API v2 'posts' endpoint handles multi-image via 'multiImage' type
        postBody.content = {
          multiImage: {
            images: assetUrns.map((urn) => ({ id: urn })),
          },
        };
      }
    }

    this.logger.log(`Creating LinkedIn Post for ${authorUrn}`);

    const response = await firstValueFrom(
      this.http.post(`${this.BASE_URL}/posts`, postBody, {
        httpsAgent: this.httpsAgent,
        headers: this.getHeaders(accessToken),
      }),
    );

    // LinkedIn returns the ID in the 'x-linkedin-id' header or the body depending on version
    // Usually response.headers['x-restli-id'] or response.data.id
    const platformPostId = response.headers['x-restli-id'] || response.data?.id;

    if (!platformPostId) {
      throw new Error('Post created but no ID returned from LinkedIn');
    }

    return {
      success: true,
      platformPostId: platformPostId,
      publishedAt: new Date(),
      metadata: response.data,
    };
  }

  // ===========================================================================
  // MEDIA UPLOAD WORKFLOW (3-Step Process)
  // ===========================================================================

  private async handleMediaUpload(
    url: string,
    accessToken: string,
    authorUrn: string,
  ): Promise<string> {
    const mediaType = this.detectMediaType(url);
    const isVideo = mediaType === 'video';

    const recipe = isVideo
      ? 'urn:li:digitalmediaRecipe:feedshare-video'
      : 'urn:li:digitalmediaRecipe:feedshare-image';

    // 1. Get File Size
    let fileSize = 0;
    if (isVideo) {
      try {
        const head = await this.http.axiosRef.head(url, {
          httpsAgent: this.httpsAgent,
        });
        fileSize = parseInt(head.headers['content-length'], 10);
      } catch (e) {
        this.logger.warn(`Could not determine file size.`);
      }
    }

    // 2. Register
    const { uploadUrl, asset, uploadToken } = await this.registerUpload(
      authorUrn,
      recipe,
      accessToken,
      fileSize,
    );

    // 3. Upload & Capture ETag
    const etag = await this.uploadBinary(uploadUrl, url);

    // 4. Video Specific Steps
    if (isVideo) {
      // STRICT CHECK REMOVED: uploadToken is allowed to be empty
      if (!etag) {
        throw new Error(
          `Cannot finalize video. Missing ETag from upload response.`,
        );
      }

      // A. Finalize (Pass the empty token if that's what we got)
      await this.finalizeUpload(asset, uploadToken || '', etag, accessToken);

      // B. Wait for Processing
      await this.waitForProcessing(asset, accessToken);
    }

    return asset;
  }

  private async registerUpload(
    ownerUrn: string,
    recipe: string,
    accessToken: string,
    fileSize?: number,
  ): Promise<{ uploadUrl: string; asset: string; uploadToken?: string }> {
    const isVideo = recipe.includes('video');
    const endpoint = isVideo
      ? `${this.BASE_URL}/videos?action=initializeUpload`
      : `${this.BASE_URL}/images?action=initializeUpload`;

    const initializeUploadRequest: any = {
      owner: ownerUrn,
    };

    if (isVideo) {
      if (!fileSize)
        throw new Error(
          'File size is required for LinkedIn Video initialization',
        );
      initializeUploadRequest.fileSizeBytes = fileSize;
      initializeUploadRequest.uploadCaptions = false;
      initializeUploadRequest.uploadThumbnail = false;
    }

    const body = { initializeUploadRequest };

    const response = await firstValueFrom(
      this.http.post(endpoint, body, {
        headers: this.getHeaders(accessToken),
        httpsAgent: this.httpsAgent,
        timeout: 30000,
      }),
    );

    const data = response.data.value;

    const uploadUrl = data.uploadUrl || data.uploadInstructions?.[0]?.uploadUrl;
    const asset = data.image || data.video || data.asset;

    // Check both locations, but default to empty string if missing (Valid for Single-Put)
    const uploadToken =
      data.uploadToken || data.uploadInstructions?.[0]?.uploadToken || '';

    if (!uploadUrl || !asset) {
      throw new Error(
        'Failed to register upload with LinkedIn (Missing URL or Asset URN)',
      );
    }

    return { uploadUrl, asset, uploadToken };
  }
  /**
   * Streams file from CDN to LinkedIn Upload URL
   */
  private async uploadBinary(
    uploadUrl: string,
    fileUrl: string,
  ): Promise<string> {
    this.logger.log(`[2/3] Streaming binary to LinkedIn Upload URL...`);

    // 1. Get Stream
    const fileStream = await this.http.axiosRef({
      url: fileUrl,
      method: 'GET',
      responseType: 'stream',
      httpsAgent: this.httpsAgent,
      timeout: 30000,
    });

    // 2. Upload Stream
    const response = await this.http.axiosRef({
      url: uploadUrl,
      method: 'PUT',
      data: fileStream.data,
      headers: {
        'Content-Type': 'application/octet-stream',
      },
      httpsAgent: this.httpsAgent,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 60000 * 10, // 10 minutes for slow uploads
    });

    // 3. Extract ETag (Case Insensitive Check)
    // Axios headers are usually lowercase, but we check both to be safe.
    const etag = response.headers['etag'] || response.headers['ETag'];

    this.logger.debug(
      `[Upload Complete] Status: ${response.status} | ETag: ${etag}`,
    );

    if (!etag) {
      this.logger.error(
        'Full Upload Headers:',
        JSON.stringify(response.headers),
      );
      // We return empty string instead of throwing, so handleMediaUpload can throw the specific error
      return '';
    }

    return etag;
  }

  private async finalizeUpload(
    videoUrn: string,
    uploadToken: string,
    etag: string,
    accessToken: string,
  ): Promise<void> {
    this.logger.log(
      `Finalizing LinkedIn Video ${videoUrn} (Token: ${uploadToken || 'EMPTY'})...`,
    );

    const body = {
      finalizeUploadRequest: {
        video: videoUrn,
        uploadToken: uploadToken, // Send specific token or empty string
        uploadedPartIds: [etag],
      },
    };

    await firstValueFrom(
      this.http.post(`${this.BASE_URL}/videos?action=finalizeUpload`, body, {
        headers: this.getHeaders(accessToken),
        httpsAgent: this.httpsAgent,
      }),
    );
  }

  private async waitForProcessing(
    videoUrn: string,
    accessToken: string,
  ): Promise<void> {
    let status = 'PROCESSING';
    let attempts = 0;
    const maxAttempts = 20;

    this.logger.log(`[3/3] Waiting for video processing: ${videoUrn}`);

    const encodedUrn = encodeURIComponent(videoUrn);

    while (status !== 'AVAILABLE' && attempts < maxAttempts) {
      await new Promise((r) => setTimeout(r, 4000));

      const response = await firstValueFrom(
        this.http.get(`${this.BASE_URL}/videos/${encodedUrn}`, {
          headers: this.getHeaders(accessToken),
          httpsAgent: this.httpsAgent,
        }),
      );

      status = response.data.status;
      this.logger.debug(`Video Status: ${status} (Attempt ${attempts + 1})`);

      if (status === 'FAILED')
        throw new Error('LinkedIn Video Processing Failed');
      attempts++;
    }

    if (status !== 'AVAILABLE') throw new Error('Video upload timed out.');
  }
  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private getHeaders(accessToken: string) {
    return {
      Authorization: `Bearer ${accessToken}`,
      'LinkedIn-Version': this.API_VERSION,
      'X-Restli-Protocol-Version': '2.0.0',
      'Content-Type': 'application/json',
    };
  }

  private validatePost(post: any) {
    if (!post.accessToken) throw new Error('Access Token required');
    if (!post.accountId) throw new Error('LinkedIn Account ID (URN) required');
  }

  private formatPostUrn(id: string): string {
    if (id.startsWith('urn:li:share:') || id.startsWith('urn:li:ugcPost:'))
      return id;
    return `urn:li:share:${id}`; // Default fallback
  }

  private detectMediaType(url: string): 'video' | 'image' {
    const isVideo = url.match(/\.(mp4|mov|avi|mkv)$/i) || url.includes('video');
    return isVideo ? 'video' : 'image';
  }

  private formatAuthorUrn(id: string): string {
    // 1. If it already starts with 'urn:li:', trust the database (It's a Page)
    if (id.startsWith('urn:li:')) {
      return id;
    }

    // 2. If it's a raw ID, assume it is a Person (Profile)
    return `urn:li:person:${id}`;
  }
}
