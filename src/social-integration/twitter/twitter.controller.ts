import { Controller, Get, Query, Req } from '@nestjs/common';
import { TwitterService } from './twitter.service';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { TwitterCallbackQueryDto } from './dto/index.dto';

@ApiTags('Twitter - Auth')
@ApiBearerAuth()
@Controller('x/auth')
export class TwitterController {
  constructor(private readonly service: TwitterService) {}

  @Get('connect')
  @ApiOperation({
    summary: 'Start Twitter OAuth 1.0a flow',
    description:
      'Generates a Twitter authorization URL and a temporary request token. ' +
      'The user should be redirected to this URL to authorize the app.',
  })
  async connectProfile()
  {
    return this.service.startAuth();
  }

  @Get('callback')
 @ApiOperation({
    summary: 'Handle Twitter OAuth 1.0a callback',
    description:
      'Exchanges the temporary OAuth request token and verifier for a permanent access token and secret.',
  })
  async callback(@Query() query: TwitterCallbackQueryDto) {
    const { oauth_token, oauth_verifier } = query;

   return this.service.getAccessToken(
      oauth_token,
      oauth_verifier,
    );
  }
}
