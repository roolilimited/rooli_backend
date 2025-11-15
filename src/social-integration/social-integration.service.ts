import { BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Platform } from '@prisma/client';
import { SocialAccountService } from 'src/social-account/social-account.service';
import { PlatformServiceFactory } from './platform-service.factory';
import {
  OAuthState,
  //PlatformUser,
} from './interfaces/platform-service.interface';
import { EncryptionService } from 'src/common/utility/encryption.service';
import axios from 'axios';
import { RedisService } from 'src/redis/redis.service';
import { XService } from './platforms/x.service';

@Injectable()
export class SocialIntegrationService {
  private readonly logger = new Logger(SocialIntegrationService.name);

  constructor(
    private readonly encryptionService: EncryptionService,
    private readonly platformServiceFactory: PlatformServiceFactory,
    private readonly socialAccountService: SocialAccountService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Generate OAuth URL for a platform
   */
  async getAuthUrl(
    platform: Platform,
    organizationId: string,
    userId: string,
    redirectUri?: string,
  ): Promise<string> {
    // Check account limit before initiating OAuth
    const hasReachedLimit =
      await this.socialAccountService.hasReachedAccountLimit(organizationId);
    if (hasReachedLimit) {
      throw new BadRequestException(
        'Organization has reached maximum social account limit'
      );
    }

    // Create state token to prevent CSRF
    const state: OAuthState = { organizationId, userId };
    const encryptedState = await this.encryptionService.encrypt(
      JSON.stringify(state),
    );

    return this.buildAuthUrl(platform, encryptedState);
  }

  /**
   * Handle OAuth callback and store credentials
   */
  async handleOAuthCallback(
    platform: Platform,
    code: string,
    encryptedState: string,
  ): Promise<{ success: boolean; account: any; redirectUri?: string }> {
    // Decrypt and verify state
    const stateData = await this.decryptAndValidateState(encryptedState);
    const { organizationId, userId } = stateData;

    this.logger.log(`Processing OAuth callback for ${platform}`, {
      organizationId,
      userId,
    });

    try {
      const { tokens, userProfile } = await this.processOAuthCallback(
        platform,
        code,
        encryptedState,
      );

      // Encrypt tokens before storing
      const encryptedTokens = await this.encryptTokens(tokens);

      // Calculate token expiration
      const tokenExpiresAt = this.calculateTokenExpiration(tokens);

      const accountData = {
        organizationId,
        platform,
        platformAccountId: userProfile.id,
        username: userProfile.username,
        name: userProfile.name,
        profilePicture: userProfile.profilePicture,
        accessToken: encryptedTokens.accessToken,
        refreshToken: encryptedTokens.refreshToken,
        tokenExpiresAt: tokenExpiresAt.toISOString(),
        scopes: this.normalizeScopes(tokens.scope, platform),
        metadata: userProfile.metadata,
      };

      // Store or update social account
      const socialAccount =
        await this.socialAccountService.upsertSocialAccount(accountData);

      this.logger.log(
        `Successfully connected ${platform} account ${userProfile.username}`,
        { accountId: socialAccount.id, organizationId }
      );

      return {
        success: true,
        account: socialAccount,
      };
    } catch (error) {
      this.logger.error(`OAuth callback failed for ${platform}:`, error);
      throw new UnauthorizedException(
        `Failed to connect ${platform} account: ${error.message}`
      );
    }
  }

  /**
   * Get user profile for a connected account
   */
  async getUserProfile(accountId: string): Promise<any> {
    const account = await this.socialAccountService.findById(accountId);
    if (!account) {
      throw new NotFoundException('Social account not found');
    }

    const decryptedToken = await this.encryptionService.decrypt(
      account.accessToken,
    );

    const platformService = this.platformServiceFactory.getService(
      account.platform,
    );

    try {
      const profile = await platformService.getUserProfile(decryptedToken);

      this.logger.log(
        `Fetched profile for ${account.platform} account ${account.username}`,
      );

      return profile;
    } catch (error) {
      this.logger.error(`Failed to fetch profile for account ${accountId}:`, error);
      throw new BadRequestException(
        'Failed to fetch profile. Token may be invalid.'
      );
    }
  }

  /**
   * Get all connected accounts for an organization
   */
  async getConnectedAccounts(organizationId: string): Promise<any[]> {
    const accounts =
      await this.socialAccountService.findByOrganization(organizationId);

    return accounts.map((account) => ({
      id: account.id,
      platform: account.platform,
      accountId: account.platformAccountId,
      username: account.username,
      name: account.name,
      profilePicture: account.profileImage,
      tokenExpiresAt: account.tokenExpiresAt,
      scopes: account.scopes,
      createdAt: account.createdAt,
      needsReauth: this.needsReauth(account),
    }));
  }

  /**
   * Disconnect a social account
   */
  async disconnectAccount(
    accountId: string,
    organizationId: string,
  ): Promise<void> {
    const account = await this.socialAccountService.findById(accountId);

    if (!account || account.organizationId !== organizationId) {
      throw new NotFoundException('Social account not found');
    }

    // Attempt to revoke tokens on the platform side
    await this.revokeTokens(account);

    // Soft delete the account
    await this.socialAccountService.disconnect(accountId);

    this.logger.log(
      `Disconnected ${account.platform} account ${account.username}`,
      { organizationId }
    );
  }

  /**
   * Get a valid access token for an account (with automatic refresh)
   */
  async getValidAccessToken(accountId: string): Promise<string> {
    const account = await this.socialAccountService.findById(accountId);

    if (!account) {
      throw new NotFoundException('Social account not found');
    }

    // Check if token needs refresh
    if (this.needsTokenRefresh(account)) {
      this.logger.log(`Refreshing expired token for account ${accountId}`);
      return await this.refreshAccessToken(accountId);
    }

    // Decrypt the token before returning it
    try {
      return await this.encryptionService.decrypt(account.accessToken);
    } catch (error) {
      this.logger.error(
        `Failed to decrypt token for account ${accountId}:`,
        error,
      );
      throw new UnauthorizedException(
        'Token decryption failed. Please reconnect your account.'
      );
    }
  }

  // ==================== PRIVATE METHODS ====================

  /**
   * Decrypt and validate OAuth state
   */
  private async decryptAndValidateState(
    encryptedState: string,
  ): Promise<OAuthState> {
    try {
      const decryptedState =
        await this.encryptionService.decrypt(encryptedState);
      const stateData: OAuthState = JSON.parse(decryptedState);

      if (!stateData.organizationId || !stateData.userId) {
        throw new Error('Invalid state data');
      }

      return stateData;
    } catch (error) {
      this.logger.error('Failed to decrypt OAuth state:', error);
      throw new UnauthorizedException('Invalid or expired OAuth state');
    }
  }

  /**
   * Process OAuth callback based on platform
   */
  private async processOAuthCallback(
    platform: Platform,
    code: string,
    encryptedState: string,
  ): Promise<{ tokens: any; userProfile: any }> {
    if (platform === Platform.X) {
      return await this.handleXOAuthCallback(code, encryptedState);
    }

    // Standard OAuth flow for other platforms
    const tokens = await this.exchangeCodeForTokens(platform, code, encryptedState);
    const platformService = this.platformServiceFactory.getService(platform);
    const userProfile = await platformService.getUserProfile(
      tokens.access_token,
    );

    return {
      tokens: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        scope: tokens.scope,
      },
      userProfile,
    };
  }

  /**
   * Handle X (Twitter) OAuth callback with PKCE
   */
  private async handleXOAuthCallback(
    code: string,
    encryptedState: string,
  ): Promise<{ tokens: any; userProfile: any }> {
    const xService = this.platformServiceFactory.getService(
      Platform.X,
    ) as XService;

    // Retrieve PKCE verifier
    const codeVerifier = await this.redisService.get(
      `x_pkce:${encryptedState}`,
    );
    if (!codeVerifier) {
      throw new UnauthorizedException(
        'OAuth session expired. Please try again.'
      );
    }

    const redirectUri = this.getRedirectUri(Platform.X);

    try {
      // Exchange code for tokens using PKCE
      const oauthResult = await xService.handleOAuthCallback(
        code,
        codeVerifier,
        redirectUri,
      );

      // Get user profile using the authenticated client
      const userProfile = await oauthResult.client.v2.me({
        'user.fields': ['username', 'name', 'profile_image_url'],
      });

      return {
        tokens: {
          accessToken: oauthResult.accessToken,
          refreshToken: oauthResult.refreshToken,
          expiresIn: oauthResult.expiresIn,
        },
        userProfile: {
          id: userProfile.data.id,
          username: userProfile.data.username,
          name: userProfile.data.name,
          profilePicture: userProfile.data.profile_image_url,
          metadata: userProfile.data,
        },
      };
    } finally {
      // Always clean up the verifier
      await this.redisService.del(`x_pkce:${encryptedState}`);
    }
  }

  /**
   * Build standard OAuth URL for other platforms
   */
  private async buildAuthUrl(
    platform: Platform,
    encryptedState: string,
  ): Promise<string> {
    const baseUrls = {
      [Platform.INSTAGRAM]: 'https://www.facebook.com/v19.0/dialog/oauth',
      [Platform.FACEBOOK]: 'https://www.facebook.com/v19.0/dialog/oauth',
      [Platform.LINKEDIN]: 'https://www.linkedin.com/oauth/v2/authorization',
    };

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.getClientId(platform),
      redirect_uri: this.getRedirectUri(platform),
      scope: this.getPlatformScopes(platform),
      state: encryptedState,
    });

    // Meta-specific parameters
    if (
      (platform === Platform.INSTAGRAM || platform === Platform.FACEBOOK) &&
      process.env.META_APP_CONFIG_ID
    ) {
      params.append('config_id', process.env.META_APP_CONFIG_ID);
    }

    const authUrl = `${baseUrls[platform]}?${params.toString()}`;
    this.logger.debug(`Built OAuth URL for ${platform}`);
    return authUrl;
  }

  /**
   * Exchange authorization code for access tokens
   */
  private async exchangeCodeForTokens(
    platform: Platform,
    code: string,
    state?: string,
  ): Promise<any> {
    const tokenUrl = this.getTokenUrl(platform);
    const clientId = this.getClientId(platform);
    const clientSecret = this.getClientSecret(platform);
    const redirectUri = this.getRedirectUri(platform);

    const bodyParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    };

    // Platform-specific token exchange
    if (platform === Platform.X) {

      // bodyParams.append('code_verifier', verifier);
      bodyParams.append('client_id', clientId);

      // Basic auth for X
      const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
        'base64',
      );
      headers['Authorization'] = `Basic ${credentials}`;
    } else {
      bodyParams.append('client_id', clientId);
      bodyParams.append('client_secret', clientSecret);
    }

    try {
      const response = await axios.post(tokenUrl, bodyParams, {
        headers,
        timeout: 30000,
      });

      this.logger.debug(`Token exchange successful for ${platform}`);

      // Normalize Meta platform responses
      if (platform === Platform.INSTAGRAM || platform === Platform.FACEBOOK) {
        return {
          access_token: response.data.access_token,
          refresh_token: response.data.refresh_token,
          expires_in: response.data.expires_in,
          scope: response.data.scope || this.getPlatformScopes(platform),
          token_type: response.data.token_type,
        };
      }

      return response.data;
    } catch (error) {
      this.logger.error(`Token exchange failed for ${platform}:`, error);
      
      if (axios.isAxiosError(error)) {
        const errorData = error.response?.data;
        
        // Handle platform-specific errors
        if (platform === Platform.INSTAGRAM || platform === Platform.FACEBOOK) {
          const errorCode = errorData?.error?.code;
          if (errorCode === 190) {
            throw new UnauthorizedException('Session expired. Please reconnect.');
          }
          if (errorCode === 100) {
            throw new BadRequestException(
              'Missing required permissions. Please grant all requested scopes.'
            );
          }
          if (errorCode === 10) {
            throw new UnauthorizedException(
              'Application not authorized. Please check app permissions.'
            );
          }
        }

        const errorMsg =
          errorData?.error?.message ||
          errorData?.error_description ||
          error.message;
        throw new UnauthorizedException(`Token exchange failed: ${errorMsg}`);
      }

      throw error;
    }
  }

  /**
   * Refresh access token with platform-specific handling
   */
  private async refreshAccessToken(accountId: string): Promise<string> {
    const account = await this.socialAccountService.findById(accountId);

    if (!account.refreshToken) {
      throw new UnauthorizedException('No refresh token available');
    }

    try {
      // Decrypt refresh token
      const decryptedRefreshToken = await this.encryptionService.decrypt(
        account.refreshToken,
      );

      // Platform-specific token refresh
      let newTokens: any;
      if (account.platform === Platform.X) {
        const xService = this.platformServiceFactory.getService(
          Platform.X,
        ) as XService;
        newTokens = await xService.refreshToken(decryptedRefreshToken);
      } else {
        newTokens = await this.refreshTokens(
          account.platform,
          decryptedRefreshToken,
        );
      }

      // Encrypt new tokens
      const encryptedTokens = await this.encryptTokens(newTokens);

      // Calculate new expiration
      const tokenExpiresAt = this.calculateTokenExpiration(newTokens);

      // Update account with new tokens
      await this.socialAccountService.update(accountId, {
        accessToken: encryptedTokens.accessToken,
        refreshToken: encryptedTokens.refreshToken || account.refreshToken,
        tokenExpiresAt: tokenExpiresAt.toISOString(),
      });

      this.logger.log(`Successfully refreshed token for ${account.platform}`);

      // Return decrypted access token for immediate use
      return newTokens.accessToken || newTokens.access_token;
    } catch (error) {
      this.logger.error(
        `Failed to refresh token for account ${accountId}:`,
        error,
      );

      // Mark account as needing reauthentication
      await this.socialAccountService.disconnect(accountId);
      throw new UnauthorizedException(
        'Token refresh failed. Please reconnect your account.'
      );
    }
  }

  /**
   * Refresh tokens for non-X platforms
   */
  private async refreshTokens(
    platform: Platform,
    refreshToken: string,
  ): Promise<any> {
    const tokenUrl = this.getTokenUrl(platform);
    const clientId = this.getClientId(platform);
    const clientSecret = this.getClientSecret(platform);

    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(
        errorData?.error?.message ||
        errorData?.error_description ||
        'Token refresh failed'
      );
    }

    return await response.json();
  }

  /**
   * Revoke platform tokens
   */
  private async revokeTokens(account: any): Promise<void> {
    try {
      const decryptedToken = await this.encryptionService.decrypt(
        account.accessToken,
      );
      const platformService = this.platformServiceFactory.getService(
        account.platform,
      );
      await platformService.revokeToken(decryptedToken);
      this.logger.log(`Revoked token for ${account.platform}`);
    } catch (error) {
      this.logger.warn(
        `Failed to revoke token for ${account.platform}:`,
        error.message,
      );
      // Don't throw - account will be disconnected anyway
    }
  }

  /**
   * Encrypt token data
   */
  private async encryptTokens(tokens: any): Promise<{
    accessToken: string;
    refreshToken: string | null;
  }> {
    const encryptedAccessToken = await this.encryptionService.encrypt(
      tokens.accessToken || tokens.access_token,
    );

    const refreshToken = tokens.refreshToken || tokens.refresh_token;
    const encryptedRefreshToken = refreshToken
      ? await this.encryptionService.encrypt(refreshToken)
      : null;

    return {
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
    };
  }

  /**
   * Calculate token expiration date
   */
  private calculateTokenExpiration(tokens: any): Date | undefined {
    if (tokens.expiresIn || tokens.expires_in) {
      const expiresIn = tokens.expiresIn || tokens.expires_in;
      return new Date(Date.now() + expiresIn * 1000);
    }

    if (tokens.expires_at) {
      return new Date(tokens.expires_at * 1000);
    }

    return undefined;
  }

  /**
   * Normalize token scopes
   */
  private normalizeScopes(scope: string | undefined, platform: Platform): string[] {
    if (!scope) {
      return this.getPlatformScopes(platform).split(/[,\s]+/);
    }

    // Split by comma or space depending on platform
    const delimiter = platform === Platform.X || platform === Platform.LINKEDIN ? ' ' : ',';
    return scope.split(delimiter).map(s => s.trim()).filter(Boolean);
  }

  /**
   * Check if account needs reauthentication
   */
  private needsReauth(account: any): boolean {
    return account.tokenExpiresAt && account.tokenExpiresAt < new Date();
  }

  /**
   * Check if token needs refresh
   */
  private needsTokenRefresh(account: any): boolean {
    return (
      account.tokenExpiresAt &&
      account.tokenExpiresAt < new Date() &&
      !!account.refreshToken
    );
  }

  /**
   * Get platform-specific scopes
   */
  private getPlatformScopes(platform: Platform): string {
    const scopes = {
      [Platform.INSTAGRAM]: [
        'business_management',
        'pages_show_list',
        'pages_read_engagement',
        'instagram_basic',
        'instagram_content_publish',
        'instagram_manage_messages',
        'pages_manage_posts',
        'pages_manage_metadata',
      ].join(','),

      [Platform.FACEBOOK]: [
        'business_management',
        'pages_show_list',
        'pages_read_engagement',
        'pages_manage_posts',
        'pages_manage_metadata',
        'instagram_basic',
        'instagram_content_publish',
        'instagram_manage_messages',
      ].join(','),

      [Platform.X]: [
        'tweet.read',
        'tweet.write',
        'users.read',
        'offline.access',
      ].join(' '),

      [Platform.LINKEDIN]: [
        'w_member_social',
        'r_liteprofile',
        'r_organization_social',
      ].join(' '),
    };
    return scopes[platform];
  }

  private getClientId(platform: Platform): string {
    const envVars = {
      [Platform.INSTAGRAM]: process.env.META_CLIENT_ID,
      [Platform.FACEBOOK]: process.env.META_CLIENT_ID,
      [Platform.X]: process.env.X_CLIENT_ID,
      [Platform.LINKEDIN]: process.env.LINKEDIN_CLIENT_ID,
    };
    
    const clientId = envVars[platform];
    if (!clientId) {
      throw new Error(`Missing client ID for platform: ${platform}`);
    }
    return clientId;
  }

  private getRedirectUri(platform: Platform): string {
    return `${process.env.API_URL}/social/${platform.toLowerCase()}/callback`;
  }

  private getClientSecret(platform: Platform): string {
    const envVars = {
      [Platform.INSTAGRAM]: process.env.META_CLIENT_SECRET,
      [Platform.FACEBOOK]: process.env.META_CLIENT_SECRET,
      [Platform.X]: process.env.X_CLIENT_SECRET,
      [Platform.LINKEDIN]: process.env.LINKEDIN_CLIENT_SECRET,
    };
    
    const clientSecret = envVars[platform];
    if (!clientSecret) {
      throw new Error(`Missing client secret for platform: ${platform}`);
    }
    return clientSecret;
  }

  private getTokenUrl(platform: Platform): string {
    const urls = {
      [Platform.INSTAGRAM]:
        'https://graph.facebook.com/v19.0/oauth/access_token',
      [Platform.FACEBOOK]:
        'https://graph.facebook.com/v19.0/oauth/access_token',
      [Platform.X]: 'https://api.x.com/2/oauth2/token',
      [Platform.LINKEDIN]: 'https://www.linkedin.com/oauth/v2/accessToken',
    };
    return urls[platform];
  }
}
