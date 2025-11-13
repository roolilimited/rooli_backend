import { HttpService } from '@nestjs/axios';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/prisma/prisma.service';
import { OAuthState } from '../interfaces/platform-service.interface';
import { EncryptionService } from 'src/common/utility/encryption.service';

@Injectable()
export class LinkedInService {
  private readonly logger = new Logger(LinkedInService.name);
  private readonly authUrl = 'https://www.linkedin.com/oauth/v2';
  private readonly baseUrl = 'https://api.linkedin.com/v2';
  private readonly redirectUri: string;
  private readonly clientId: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly encryptionService: EncryptionService,
  ) {
    this.clientId = this.configService.get<string>('LINKEDIN_CLIENT_ID');
    this.redirectUri =
      this.configService.get<string>('LINKEDIN_REDIRECT_URI') ??
      this.configService.get<string>('API_URL') + '/auth/linkedin/callback';
  }

  async getAuthUrl(organizationId: string, userId: string): Promise<string> {
    const state: OAuthState = {
      organizationId,
      userId,
      timestamp: Date.now(),
    };

    const encryptedState = await this.encryptionService.encrypt(
      JSON.stringify(state),
    );

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      state: encryptedState,
      scope: this.getScopes().join(' '),
    });

    return `${this.authUrl}/authorization?${params.toString()}`;
  }

  // get scopes
  private getScopes(): string[] {
    return [
      'r_liteprofile',
      'r_emailaddress',
      'w_member_social', //Allows your application to post updates and share content on behalf of the member.
      'rw_organization_admin', //Manage pages and retrieve reporting data
      'w_organization_social', //Create, modify, and delete posts on your organization's behalf
      'r_organization_social', //Retrieve your organization's posts and engagement data
      'w_member_social', //Create posts on user's personal profile
      'r_member_postAnalytics', //Get detailed post performance data
      'r_organization_social_feed', //Get comments and reactions on organization posts
      'r_basicprofile', //Get user's name, photo
    ];
  }

  async handleCallback(encryptedState: string, code: string): Promise<any> {
    const state = await this.decryptAndValidateState(encryptedState);
  }

  private async decryptAndValidateState(
    encryptedState: string,
    maxAgeMs = 1000 * 60 * 15,
  ): Promise<OAuthState> {
    try {
      const plain = await this.encryptionService.decrypt(encryptedState);
      const parsed: OAuthState = JSON.parse(plain);
      if (!parsed || !parsed.timestamp)
        throw new Error('Invalid state payload');
      if (Date.now() - parsed.timestamp > maxAgeMs)
        throw new Error('State token expired');

      // Validate required fields
      if (!parsed.organizationId || !parsed.userId) {
        throw new Error('Invalid state data: missing required fields');
      }

      return parsed;
    } catch (err) {
      this.logger.warn('State validation failed: ' + (err?.message ?? err));
      throw new BadRequestException('Invalid or expired state token');
    }
  }

}
