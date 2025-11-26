import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

import {
  ScheduledPost,
  PublishingResult,
  LinkedInScheduledPost,
} from '../interfaces/social-scheduler.interface';
import { BasePlatformService } from './base-platform.service';

@Injectable()
export class LinkedInPlatformService extends BasePlatformService {
  readonly platform = 'LINKEDIN';
  protected readonly logger = new Logger(LinkedInPlatformService.name);

  private readonly API_BASE_URL = 'https://api.linkedin.com/v2';
  private readonly RESTLI_VERSION = '2.0.0';

  constructor(http: HttpService) {
    super(http);
  }

  async schedulePost(post: LinkedInScheduledPost): Promise<PublishingResult> {
    return {
      success: false,
      error: 'LinkedIn native scheduling is not supported. Use BullMQ scheduling.',
    };
  }

  async publishImmediately(post: LinkedInScheduledPost): Promise<PublishingResult> {
    const context = { postId: post.id, platform: this.platform };

    try {
      this.validateRequiredFields(post, ['accessToken', 'authorUrn']);

      const { accessToken, authorUrn, visibility } = post;

      const text = post.content || '';

      // For now: simple text post only
      // Endpoint: UGC posts (marketing developer path)
      const url = `${this.API_BASE_URL}/ugcPosts`;

      const body: any = {
        author: authorUrn, // urn:li:person:xxx or urn:li:organization:xxx
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: {
              text,
            },
            shareMediaCategory: 'NONE', // TODO: IMAGE, VIDEO, ARTICLE if you add media
          },
        },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility':
            visibility || 'PUBLIC',
        },
      };

      const headers = {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': this.RESTLI_VERSION,
        'Content-Type': 'application/json',
      };

      const response = await firstValueFrom(
        this.http.post(url, body, { headers }),
      );

      const postUrn: string = response.data?.id;

      this.logger.log('LinkedIn post published', { ...context, postUrn });

      return {
        success: true,
        platformPostId: postUrn,
        metadata: {
          postUrn,
          authorUrn,
        },
      };
    } catch (error) {
      this.logger.error('LinkedIn publish failed', {
        ...context,
        error: this.extractErrorMessage(error),
        data: error.response?.data,
      });

      return this.handleError(error, 'LinkedIn publishImmediately', context);
    }
  }

  /**
   * Delete a previously published LinkedIn UGC post.
   * Only works if the author owns the post and permissions allow it.
   */
  async deleteScheduledPost(
    postUrn: string,
    accessToken: string,
  ): Promise<boolean> {
    const context = { postUrn };

    try {
      const headers = {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': this.RESTLI_VERSION,
      };

      // UGC posts use URNs as ids, e.g. urn:li:ugcPost:xxxx
      const url = `${this.API_BASE_URL}/ugcPosts/${encodeURIComponent(
        postUrn,
      )}`;

      await firstValueFrom(this.http.delete(url, { headers }));

      this.logger.log('LinkedIn post deleted', context);
      return true;
    } catch (error) {
      this.logger.error('Failed to delete LinkedIn post', {
        ...context,
        error: this.extractErrorMessage(error),
        data: error.response?.data,
      });

      return false;
    }
  }
}
