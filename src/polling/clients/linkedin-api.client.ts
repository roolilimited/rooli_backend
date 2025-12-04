// src/polling/clients/linkedin-api.client.ts
import { HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosError, AxiosResponse } from 'axios';
import { UnauthorizedException } from '@nestjs/common';

interface LinkedInEngagement {
  id: string;
  type: 'LIKE' | 'COMMENT' | 'SHARE';
  actor: {
    id: string;
    firstName?: string;
    lastName?: string;
  };
  message?: string;
  createdTime: number;
  postId: string;
  postUrl: string;
}

interface LinkedInApiResponse {
  elements: any[];
  paging?: {
    count: number;
    start: number;
    links: Array<{ rel: string; href: string }>;
  };
}

@Injectable()
export class LinkedinApiClient {
  private readonly logger = new Logger(LinkedinApiClient.name);
  private readonly apiBaseUrl = 'https://api.linkedin.com/v2';

  constructor(private readonly httpService: HttpService) {}

  /**
   * Get engagements for a specific post or user
   */
  async getEngagements(
    accessToken: string,
    userUrn: string, // e.g., "urn:li:organization:123456"
    since: Date,
  ): Promise<LinkedInEngagement[]> {
    const sinceTimestamp = since.getTime();
    const engagements: LinkedInEngagement[] = [];

    try {
      // 1. First, get recent posts to get their IDs
      const posts = await this.getRecentPosts(accessToken, userUrn, since);
      
      // 2. For each post, get its engagements
      for (const post of posts) {
        const postEngagements = await this.getPostEngagements(
          accessToken,
          post.id,
          sinceTimestamp,
        );
        engagements.push(...postEngagements);
      }

      this.logger.debug(`Found ${engagements.length} LinkedIn engagements since ${since.toISOString()}`);
      return engagements;

    } catch (error) {
      this.handleApiError(error, 'Failed to fetch LinkedIn engagements');
    }
  }

  /**
   * Get recent posts for a user/organization
   */
  private async getRecentPosts(
    accessToken: string,
    userUrn: string,
    since: Date,
  ): Promise<Array<{ id: string; createdTime: number }>> {
    try {
      // This is a simplified example - actual LinkedIn API might use different endpoints
      const response: AxiosResponse<LinkedInApiResponse> = await firstValueFrom(
        this.httpService.get(`${this.apiBaseUrl}/ugcPosts?author=${userUrn}`, {
          headers: this.getHeaders(accessToken),
          params: {
            start: 0,
            count: 50, // Adjust based on rate limits
            // LinkedIn might not support time-based filtering easily
          },
        }),
      );

      return response.data.elements
        .filter((post: any) => new Date(post.createdAt).getTime() >= since.getTime())
        .map((post: any) => ({
          id: post.id,
          createdTime: new Date(post.createdAt).getTime(),
        }));

    } catch (error) {
      this.handleApiError(error, 'Failed to fetch LinkedIn posts');
    }
  }

  /**
   * Get engagements for a specific post
   */
  private async getPostEngagements(
    accessToken: string,
    postId: string,
    sinceTimestamp: number,
  ): Promise<LinkedInEngagement[]> {
    try {
      const response: AxiosResponse<LinkedInApiResponse> = await firstValueFrom(
        this.httpService.get(`${this.apiBaseUrl}/socialActions/${postId}/comments`, {
          headers: this.getHeaders(accessToken),
        }),
      );

      return response.data.elements
        .filter((engagement: any) => engagement.createdAt >= sinceTimestamp)
        .map((engagement: any) => this.normalizeEngagement(engagement, postId));

    } catch (error) {
      // If endpoint doesn't exist, return empty array instead of failing
      if ((error as AxiosError).response?.status === 404) {
        this.logger.warn(`Engagements endpoint not available for post ${postId}`);
        return [];
      }
      this.handleApiError(error, 'Failed to fetch post engagements');
    }
  }

  /**
   * Normalize LinkedIn API response to common format
   */
  private normalizeEngagement(apiEngagement: any, postId: string): LinkedInEngagement {
    return {
      id: apiEngagement.id,
      type: this.mapEngagementType(apiEngagement.type),
      actor: {
        id: apiEngagement.actor,
        firstName: apiEngagement.firstName,
        lastName: apiEngagement.lastName,
      },
      message: apiEngagement.message?.text,
      createdTime: apiEngagement.createdAt,
      postId,
      postUrl: `https://www.linkedin.com/feed/update/${postId}/`,
    };
  }

  private mapEngagementType(apiType: string): 'LIKE' | 'COMMENT' | 'SHARE' {
    const typeMap: Record<string, 'LIKE' | 'COMMENT' | 'SHARE'> = {
      'LIKE': 'LIKE',
      'COMMENT': 'COMMENT',
      'SHARE': 'SHARE',
      'REACTION': 'LIKE',
    };
    return typeMap[apiType] || 'LIKE';
  }

  private getHeaders(accessToken: string) {
    return {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    };
  }

  private handleApiError(error: any, context: string): never {
    this.logger.error(`${context}: ${error.message}`, error.stack);

    if (error instanceof AxiosError) {
      const status = error.response?.status;
      const message = error.response?.data?.message || error.message;

      switch (status) {
        case 401:
          throw new UnauthorizedException('LinkedIn access token expired or invalid');
        case 403:
          throw new UnauthorizedException('LinkedIn API permissions insufficient');
        case 429:
          throw new HttpException('LinkedIn API rate limit exceeded', 429);
        case 404:
          throw new NotFoundException('LinkedIn resource not found');
        default:
          throw new Error(`LinkedIn API error: ${message}`);
      }
    }

    throw new Error(`${context}: ${error.message}`);
  }
}