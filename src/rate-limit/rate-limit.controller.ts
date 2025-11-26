import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  ParseEnumPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { RateLimitService } from './rate-limit.service';
import { Platform } from '@generated/enums';

@ApiTags('Rate Limits')
@Controller('rate-limits')
export class RateLimitController {
  constructor(private readonly rateLimitService: RateLimitService) {}

  // @Get(':platform/:accountId/quota')
  // @ApiOperation({ summary: 'Get current quota usage for an account and action' })
  // @ApiParam({ name: 'platform', enum: Platform, description: 'Target platform (e.g., X, Facebook, LinkedIn)' })
  // @ApiParam({ name: 'accountId', description: 'The social account identifier' })
  // @ApiQuery({ name: 'action', description: 'The action being checked (e.g., posts:create, analytics:read)', required: true })
  // @ApiResponse({
  //   status: 200,
  //   description: 'Quota usage details',
  //   schema: {
  //     example: {
  //       used: 5,
  //       remaining: 95,
  //       resetIn: 42,
  //     },
  //   },
  // })
  // async getQuota(
  //   @Param('platform', new ParseEnumPipe(Platform)) platform: Platform,
  //   @Param('accountId') accountId: string,
  //   @Query('action') action: string,
  // ) {
  //   return this.rateLimitService.getQuota(platform, accountId, action);
  // }

  // @Post(':platform/:accountId/check')
  // @ApiOperation({ summary: 'Consume one quota unit (check-and-increment)' })
  // @ApiParam({ name: 'platform', enum: Platform, description: 'Target platform (e.g., X, Facebook, LinkedIn)' })
  // @ApiParam({ name: 'accountId', description: 'The social account identifier' })
  // @ApiQuery({ name: 'action', description: 'The action being performed (e.g., posts:create)', required: true })
  // @ApiResponse({
  //   status: 200,
  //   description: 'Quota usage after consuming one unit',
  //   schema: {
  //     example: {
  //       used: 6,
  //       remaining: 94,
  //       resetIn: 58,
  //     },
  //   },
  // })
  // @ApiResponse({
  //   status: 429,
  //   description: 'Rate limit exceeded',
  //   schema: {
  //     example: {
  //       statusCode: 429,
  //       message: 'Rate limit exceeded for X posts:create. Try again in 120s',
  //       error: 'Too Many Requests',
  //     },
  //   },
  // })
  // async checkLimit(
  //   @Param('platform', new ParseEnumPipe(Platform)) platform: Platform,
  //   @Param('accountId') accountId: string,
  //   @Query('action') action: string,
  // ) {
  //   return this.rateLimitService.checkLimit(platform, accountId, action);
  // }
}

