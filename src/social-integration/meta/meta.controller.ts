import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Param,
  UseGuards,
  Req,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { MetaService } from './meta.service';
import { ConnectMetaPagesDto } from './dto/connect-pages.dto';

@ApiTags('Meta Integration')
@ApiBearerAuth()
@Controller('social/meta')
export class MetaController {
  constructor(private readonly metaService: MetaService) {}

  @Get('auth/url')
  @ApiOperation({
    summary: 'Generate Meta Business Login URL',
    description:
      'Generates the Meta (Facebook) Business Login URL that the user should be redirected to for OAuth authentication.',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns the login URL and state token.',
  })
  getAuthUrl(@Query('organizationId') organizationId: string, @Req() req) {
    return this.metaService.generateAuthUrl(organizationId, req.user.id);
  }

  @Get('auth/callback')
  @ApiOperation({
    summary: 'Handle Meta OAuth callback',
    description:
      'Handles the OAuth redirect from Facebook, exchanging the authorization code for a user access token.',
  })
  @ApiQuery({ name: 'code', required: true })
  @ApiQuery({ name: 'encryptedState', required: true })
  @ApiResponse({
    status: 200,
    description: 'Returns access token and expiry info.',
  })
  async handleOAuthCallback(
    @Query('code') code: string,
    @Query('encryptedState') encryptedState: string,
  ) {
    return this.metaService.handleOAuthCallback(
      code,
      decodeURIComponent(encryptedState),
    );
  }

  @Post('pages/connect')
  @ApiOperation({
    summary: 'Connect selected Meta pages to the social account',
  })
  async connectPages(@Body() body: ConnectMetaPagesDto) {
    return this.metaService.connectSelectedPages(
      body.socialAccountId,
      body.pageIds,
    );
  }

  // -------------------------------------------------------------------------
  // USER PROFILE & VERIFICATION
  // -------------------------------------------------------------------------

  @Post('verify')
  @ApiOperation({
    summary: 'Verify Meta user access token',
    description:
      'Verifies if a provided Meta user access token is valid and retrieves user ID, scopes, and expiration.',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns token validation details.',
  })
  async verifyToken(@Body('accessToken') accessToken: string) {
    if (!accessToken) throw new BadRequestException('accessToken is required');
    return this.metaService.verifyUserAccessToken(accessToken);
  }

  @Post('me')
  @ApiOperation({
    summary: 'Get Meta user profile',
    description:
      'Fetches the Meta user profile (name, email, profile picture) using the provided user access token.',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns Facebook user profile data.',
  })
  async getProfile(@Body('accessToken') accessToken: string) {
    if (!accessToken) throw new BadRequestException('accessToken is required');
    return this.metaService.getUserProfile(accessToken);
  }

  // -------------------------------------------------------------------------
  // DISCONNECT / TOKEN MANAGEMENT
  // -------------------------------------------------------------------------

  @Post('disconnect')
  @ApiOperation({
    summary: 'Revoke Facebook app permissions',
    description:
      'Revokes app permissions from the user’s Facebook account, effectively disconnecting the app.',
  })
  @ApiResponse({ status: 200, description: 'Revocation successful.' })
  async revokeAccess(@Body('accessToken') accessToken: string) {
    if (!accessToken) throw new BadRequestException('accessToken is required');
    return this.metaService.revokeToken(accessToken);
  }

  @Post('validate')
  @ApiOperation({
    summary: 'Validate Facebook access token',
    description:
      'Quickly validates whether a Facebook access token is still active and usable.',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns true if valid, false otherwise.',
  })
  async validateToken(@Body('accessToken') accessToken: string) {
    return this.metaService.validateAccessToken(accessToken);
  }
}
