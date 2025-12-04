// src/polling/clients/x-api.client.ts
import { HttpException, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosError, AxiosResponse } from 'axios';
import {  UnauthorizedException } from '@nestjs/common';

interface XEngagement {
  id: string;
  type: 'LIKE' | 'RETWEET' | 'REPLY' | 'QUOTE';
  actor: {
    id: string;
    username: string;
    name: string;
  };
  message?: string;
  createdTime: string;
  tweetId: string;
  tweetUrl: string;
}

interface XApiResponse {
  data: any[];
  meta?: {
    result_count: number;
    newest_id?: string;
    oldest_id?: string;
    next_token?: string;
  };
}

@Injectable()
export class XApiClient {
  private readonly logger = new Logger(XApiClient.name);
  private readonly apiBaseUrl = 'https://api.twitter.com/2';

  constructor(private readonly httpService: HttpService) {}

  /**
   * Get engagements for a user's tweets
   */
  async getEngagements(
    accessToken: string,
    userId: string,
    since: Date,
  ): Promise<XEngagement[]> {
    const engagements: XEngagement[] = [];
    let nextToken: string | undefined;

    try {
      // 1. Get user's recent tweets
      const tweets = await this.getUserTweets(accessToken, userId, since, 50);
      
      // 2. For each tweet, get its engagements
      for (const tweet of tweets) {
        const tweetEngagements = await this.getTweetEngagements(
          accessToken,
          tweet.id,
          since,
        );
        engagements.push(...tweetEngagements);
      }

      this.logger.debug(`Found ${engagements.length} X engagements since ${since.toISOString()}`);
      return engagements;

    } catch (error) {
      this.handleApiError(error, 'Failed to fetch X engagements');
    }
  }

  /**
   * Get user's recent tweets
   */
  private async getUserTweets(
    accessToken: string,
    userId: string,
    since: Date,
    maxResults: number = 50,
  ): Promise<Array<{ id: string; text: string; created_at: string }>> {
    try {
      const response: AxiosResponse<XApiResponse> = await firstValueFrom(
        this.httpService.get(`${this.apiBaseUrl}/users/${userId}/tweets`, {
          headers: this.getHeaders(accessToken),
          params: {
            max_results: maxResults,
            start_time: since.toISOString(),
            exclude: 'retweets,replies', // Get original tweets
            'tweet.fields': 'created_at,author_id',
          },
        }),
      );

      return response.data.data || [];

    } catch (error) {
      this.handleApiError(error, 'Failed to fetch user tweets');
    }
  }

  /**
   * Get engagements for a specific tweet
   */
  private async getTweetEngagements(
    accessToken: string,
    tweetId: string,
    since: Date,
  ): Promise<XEngagement[]> {
    const engagements: XEngagement[] = [];
    
    try {
      // Get likes
      const likes = await this.getTweetLikes(accessToken, tweetId, since);
      engagements.push(...likes);

      // Get retweets
      const retweets = await this.getRetweets(accessToken, tweetId, since);
      engagements.push(...retweets);

      // Get replies
      const replies = await this.getReplies(accessToken, tweetId, since);
      engagements.push(...replies);

      return engagements;

    } catch (error) {
      this.handleApiError(error, `Failed to fetch engagements for tweet ${tweetId}`);
    }
  }

  private async getTweetLikes(
    accessToken: string,
    tweetId: string,
    since: Date,
  ): Promise<XEngagement[]> {
    try {
      const response: AxiosResponse<XApiResponse> = await firstValueFrom(
        this.httpService.get(`${this.apiBaseUrl}/tweets/${tweetId}/liking_users`, {
          headers: this.getHeaders(accessToken),
          params: {
            'user.fields': 'name,username',
          },
        }),
      );

      return (response.data.data || []).map((user: any) => ({
        id: `like_${tweetId}_${user.id}`,
        type: 'LIKE',
        actor: {
          id: user.id,
          username: user.username,
          name: user.name,
        },
        createdTime: new Date().toISOString(), // X doesn't provide like timestamps in this endpoint
        tweetId,
        tweetUrl: `https://twitter.com/${user.username}/status/${tweetId}`,
      }));

    } catch (error) {
      this.logger.warn(`Failed to get likes for tweet ${tweetId}: ${error.message}`);
      return [];
    }
  }

  private async getRetweets(
    accessToken: string,
    tweetId: string,
    since: Date,
  ): Promise<XEngagement[]> {
    try {
      const response: AxiosResponse<XApiResponse> = await firstValueFrom(
        this.httpService.get(`${this.apiBaseUrl}/tweets/${tweetId}/retweeted_by`, {
          headers: this.getHeaders(accessToken),
          params: {
            'user.fields': 'name,username',
          },
        }),
      );

      return (response.data.data || []).map((user: any) => ({
        id: `retweet_${tweetId}_${user.id}`,
        type: 'RETWEET',
        actor: {
          id: user.id,
          username: user.username,
          name: user.name,
        },
        createdTime: new Date().toISOString(), // X doesn't provide retweet timestamps here
        tweetId,
        tweetUrl: `https://twitter.com/${user.username}/status/${tweetId}`,
      }));

    } catch (error) {
      this.logger.warn(`Failed to get retweets for tweet ${tweetId}: ${error.message}`);
      return [];
    }
  }

  private async getReplies(
    accessToken: string,
    tweetId: string,
    since: Date,
  ): Promise<XEngagement[]> {
    try {
      const response: AxiosResponse<XApiResponse> = await firstValueFrom(
        this.httpService.get(`${this.apiBaseUrl}/tweets/search/recent`, {
          headers: this.getHeaders(accessToken),
          params: {
            query: `conversation_id:${tweetId}`,
            start_time: since.toISOString(),
            'tweet.fields': 'created_at,author_id',
            'user.fields': 'name,username',
            max_results: 50,
          },
        }),
      );

      return (response.data.data || []).map((tweet: any) => ({
        id: tweet.id,
        type: 'REPLY',
        actor: {
          id: tweet.author_id,
          username: tweet.author_id, // Would need user lookup for username
          name: tweet.author_id,     // Would need user lookup for name
        },
        message: tweet.text,
        createdTime: tweet.created_at,
        tweetId,
        tweetUrl: `https://twitter.com/i/status/${tweet.id}`,
      }));

    } catch (error) {
      this.logger.warn(`Failed to get replies for tweet ${tweetId}: ${error.message}`);
      return [];
    }
  }

  private getHeaders(accessToken: string) {
    return {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    };
  }

  private handleApiError(error: any, context: string): never {
    this.logger.error(`${context}: ${error.message}`, error.stack);

    if (error instanceof AxiosError) {
      const status = error.response?.status;
      const message = error.response?.data?.detail || error.message;

      switch (status) {
        case 401:
          throw new UnauthorizedException('X access token expired or invalid');
        case 403:
          throw new UnauthorizedException('X API permissions insufficient');
        case 429:
          throw new HttpException('X API rate limit exceeded', 429);
        default:
          throw new Error(`X API error: ${message}`);
      }
    }

    throw new Error(`${context}: ${error.message}`);
  }
}