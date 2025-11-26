import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { TwitterApi, ApiResponseError } from 'twitter-api-v2';

import { BasePlatformService } from './base-platform.service';
import {
  ScheduledPost,
  PublishingResult,
  TwitterScheduledPost,
} from '../interfaces/social-scheduler.interface';

@Injectable()
export class TwitterPlatformService extends BasePlatformService {
  readonly platform = 'TWITTER';
  protected readonly logger = new Logger(TwitterPlatformService.name);

  // If you need app-level credentials for some flows, inject via env/config
  constructor(http: HttpService) {
    super(http);
  }

  /**
   * For Twitter there’s no real “native scheduling” API exposed like Facebook.
   * In your architecture, Twitter posts are scheduled via BullMQ and then
   * `publishImmediately` is called at the right time.
   *
   * But we still implement this to satisfy the interface.
   */
  async schedulePost(post: TwitterScheduledPost): Promise<PublishingResult> {
    this.logger.warn(
      `schedulePost called for Twitter – falling back to immediate publish. postId=${post.id}`,
    );
    return this.publishImmediately(post);
  }

  /**
   * Publish a tweet immediately.
   * Expects:
   *  - post.content       → tweet text
   *  - post.mediaUrls     → URLs to images/videos (optional)
   *  - post.metadata.accessToken → user OAuth2 access token for Twitter
   *
   * NOTE: In your scheduler, this will be called via prepareGenericPlatformPost,
   * which sets:
   *   metadata: { accessToken, platformAccountId }
   */
  async publishImmediately(post: TwitterScheduledPost): Promise<PublishingResult> {
    const context = { postId: post.id, platform: this.platform };

    try {
      this.validateRequiredFields(post, ['accessToken']);

      const { accessToken } = post;
      const client = this.createUserClient(accessToken);

      const text = (post.content || '').trim();
      if (!text && (!post.mediaUrls || post.mediaUrls.length === 0)) {
        throw new Error('Twitter post requires text or at least one media URL');
      }

      // Upload media if present
      let mediaIds: string[] | undefined;
      if (post.mediaUrls && post.mediaUrls.length > 0) {
        mediaIds = await this.uploadMediaForTweet(client, post.mediaUrls, context);
      }

      this.logger.log('Publishing tweet', {
        ...context,
        hasMedia: !!mediaIds?.length,
      });

      // twitter-api-v2 v2.tweet takes args: text + options
      const response = await this.makeApiRequest(
  () =>
    client.v2.tweet(text, {
      ...(mediaIds?.length
        ? { media: { media_ids: this.toMediaIdsTuple(mediaIds) } }
        : {}),
    }),
  'publish tweet',
);
      const tweetId = response.data.id;

      return {
        success: true,
        platformPostId: tweetId,
        metadata: {
          url: `https://twitter.com/i/web/status/${tweetId}`,
          mediaIds: mediaIds ?? [],
        },
      };
    } catch (error) {
      return this.handleError(error, 'Twitter publish', context);
    }
  }

  /**
   * Delete a tweet by its ID.
   * This is used by your scheduler when cancelling or cleaning up.
   */
  async deleteScheduledPost(
    postId: string,
    accessToken: string,
  ): Promise<boolean> {
    const client = this.createUserClient(accessToken);

    try {
      await this.makeApiRequest(
        () => client.v2.deleteTweet(postId),
        'delete tweet',
      );

      this.logger.log('Deleted tweet', { tweetId: postId });
      return true;
    } catch (error) {
      this.logger.error('Failed to delete tweet', {
        tweetId: postId,
        error: this.extractErrorMessage(error),
      });
      return false;
    }
  }

  /**
   * Optional helper: verify that the stored token is valid and we can access the account.
   * You could use this when connecting a Twitter account or refreshing it.
   */
  async validateCredentials(accessToken: string): Promise<boolean> {
    try {
      const client = this.createUserClient(accessToken);
      const me = await this.makeApiRequest(() => client.v2.me(), 'validate credentials');

      this.logger.log('Twitter credentials valid', {
        userId: me.data.id,
        username: me.data.username,
      });

      return true;
    } catch (error) {
      this.logger.warn('Twitter credentials validation failed', {
        error: this.extractErrorMessage(error),
      });
      return false;
    }
  }

  // ============================================================
  // INTERNAL HELPERS
  // ============================================================

  /**
   * Create a client authenticated as a user via OAuth2 access token.
   * You must have obtained this token via your own OAuth flow and stored it
   * in `socialAccount.accessToken`.
   *
   * For typical OAuth2 user context, twitter-api-v2 supports:
   *   new TwitterApi(userAccessToken)
   */
  private createUserClient(accessToken: string): TwitterApi {
    return new TwitterApi(accessToken);
  }

  /**
   * Download media from URLs and upload to Twitter.
   * Returns an array of `media_id`s to send with the tweet.
   */
  private async uploadMediaForTweet(
    client: TwitterApi,
    mediaUrls: string[],
    context: any,
  ): Promise<string[]> {
    const mediaIds: string[] = [];

    for (const url of mediaUrls) {
      try {
        const buffer = await this.downloadMedia(url);
        const mediaType = this.detectMediaTypeFromUrl(url);

        this.logger.debug('Uploading media for tweet', {
          ...context,
          url,
          mediaType,
        });

        // twitter-api-v2 uses v1 endpoint for uploads
        const mediaId = await client.v1.uploadMedia(buffer, {
          type: mediaType,
        });

        mediaIds.push(mediaId);
      } catch (error) {
        this.logger.error('Failed to upload media for tweet', {
          ...context,
          url,
          error: this.extractErrorMessage(error),
        });
        // You can decide whether to fail the whole tweet or continue without this media
        // For now we just skip that media and continue.
      }
    }

    return mediaIds;
  }

  /**
   * Download a file as Buffer from a URL using HttpService.
   */
  private async downloadMedia(url: string): Promise<Buffer> {
    const response = await firstValueFrom(
      this.http.get(url, { responseType: 'arraybuffer' }),
    );
    return Buffer.from(response.data);
  }

  /**
   * Very simple media type detector based on file extension.
   * twitter-api-v2 uploadMedia expects a limited set of types:
   *   { type: 'png' | 'jpg' | 'gif' | 'mp4' }
   */
  private detectMediaTypeFromUrl(url: string): 'png' | 'jpg' | 'gif' | 'mp4' {
    const lower = url.toLowerCase();

    if (lower.endsWith('.mp4') || lower.includes('video')) return 'mp4';
    if (lower.endsWith('.gif')) return 'gif';
    if (lower.endsWith('.png')) return 'png';
    return 'jpg'; // default fallback
  }

  /**
   * Override BasePlatformService.extractErrorMessage to handle Twitter errors
   * a bit more nicely (optional but handy).
   */
protected extractErrorMessage(error: any): string {
    // ApiResponseError holds structured Twitter API error responses
    if (error instanceof ApiResponseError) {
      if (error.data?.errors?.length) {
        return error.data.errors.map((e: any) => e.message).join('; ');
      }

    return error.message || 'Twitter API error';
  }

  return super.extractErrorMessage(error);
}
  private toMediaIdsTuple(
  mediaIds: string[],
): [string] | [string, string] | [string, string, string] | [string, string, string, string] {
  const ids = mediaIds.slice(0, 4); // Twitter max 4

  if (ids.length === 0) {
    throw new Error('mediaIds must have at least one id');
  }
  if (ids.length === 1) return [ids[0]];
  if (ids.length === 2) return [ids[0], ids[1]];
  if (ids.length === 3) return [ids[0], ids[1], ids[2]];
  return [ids[0], ids[1], ids[2], ids[3]];
}
}
