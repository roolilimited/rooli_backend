import { Body, Controller, Delete, Get, Logger, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { SocialAccountService } from './social-account.service';
import { ApiTags, ApiOperation, ApiBody, ApiResponse, ApiParam } from '@nestjs/swagger';
import { CreateSocialAccountDto } from './dtos/create-account.dto';
import { UpdateSocialAccountDto } from './dtos/update-social-account.dto';
import { SocialAccount } from '@generated/client';
import { Platform } from '@generated/enums';

@ApiTags('Social Accounts')
@Controller('social-accounts')
export class SocialAccountController {
  private readonly logger = new Logger(SocialAccountController.name);

  constructor(private readonly socialAccountService: SocialAccountService) {}

  @Post()
  @ApiOperation({ summary: 'Upsert a social account for an organization' })
  @ApiBody({ type: CreateSocialAccountDto })
  @ApiResponse({
    status: 201,
    description: 'Social account created or updated',
  })
  async upsert(
    @Body() createDto: CreateSocialAccountDto,
  ): Promise<SocialAccount> {
    return this.socialAccountService.upsertSocialAccount(createDto);
  }

  @Get('platform/:platform')
  @ApiOperation({ summary: 'Get all active accounts for a specific platform' })
  @ApiParam({ name: 'platform', enum: Platform })
  @ApiResponse({ status: 200, description: 'List of social accounts' })
  async findAllForPlatform(
    @Param('platform') platform: Platform,
  ): Promise<SocialAccount[]> {
    return this.socialAccountService.findAllForPlatform(platform);
  }

  @Get('organization/:orgId')
  @ApiOperation({
    summary: 'Get all active social accounts for an organization',
  })
  @ApiParam({ name: 'orgId', description: 'Organization ID' })
  @ApiResponse({ status: 200, description: 'List of social accounts' })
  async findByOrganization(
    @Param('orgId') orgId: string,
  ): Promise<SocialAccount[]> {
    return this.socialAccountService.findByOrganization(orgId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific social account by ID' })
  @ApiParam({ name: 'id', description: 'Social account ID' })
  @ApiResponse({ status: 200, description: 'Social account details' })
  async findById(@Param('id') id: string): Promise<SocialAccount> {
    const account = await this.socialAccountService.findById(id);
    if (!account) throw new NotFoundException(`Social account ${id} not found`);
    return account;
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a social account' })
  @ApiParam({ name: 'id', description: 'Social account ID' })
  @ApiBody({ type: UpdateSocialAccountDto })
  @ApiResponse({ status: 200, description: 'Updated social account' })
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateSocialAccountDto,
  ): Promise<SocialAccount> {
    return this.socialAccountService.update(id, updateDto);
  }

  @Delete(':id/disconnect')
  @ApiOperation({ summary: 'Soft delete a social account (disconnect)' })
  @ApiParam({ name: 'id', description: 'Social account ID' })
  @ApiResponse({ status: 200, description: 'Social account disconnected' })
  async disconnect(@Param('id') id: string): Promise<SocialAccount> {
    return this.socialAccountService.disconnect(id);
  }
}