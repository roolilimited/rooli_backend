import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PermissionService } from './role-permission.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CreatePermissionDto } from './dtos/create-permission.dto';
import {
  PermissionCheckDto,
  BatchPermissionCheckDto,
} from './dtos/permission-check.dto';
import { Permission } from '@generated/client';
import { PermissionScope } from '@generated/enums';

@ApiTags('Permissions')
@Controller('permissions')
export class PermissionController {
  constructor(private readonly permissionService: PermissionService) {}

  @Get('user/:userId/org/:organizationId')
  @ApiOperation({
    summary: 'Get all permissions for a user in an organization',
  })
  @ApiResponse({ status: 200, description: 'User permission context returned' })
  async getUserPermissions(
    @Param('userId') userId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.permissionService.getUserPermissions(userId, organizationId);
  }

  @Post('check')
  @ApiOperation({ summary: 'Check if a user has a specific permission' })
  @ApiResponse({ status: 200, description: 'Boolean result' })
  async hasPermission(@Body() dto: PermissionCheckDto) {
    return this.permissionService.hasPermission(dto);
  }

  @Post('check/batch')
  @ApiOperation({ summary: 'Batch permission check' })
  @ApiResponse({
    status: 200,
    description: 'Map of permission name to boolean',
  })
  async hasPermissions(@Body() dto: BatchPermissionCheckDto) {
    return this.permissionService.hasPermissions(dto.checks);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new permission' })
  @ApiResponse({ status: 201, description: 'Permission created successfully' })
  async createPermission(
    @Body() dto: CreatePermissionDto,
  ): Promise<Permission> {
    return this.permissionService.createPermission(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all permissions' })
  @ApiResponse({ status: 200, description: 'List of all permissions' })
  async getAllPermissions(): Promise<Permission[]> {
    return this.permissionService.getAllPermissions();
  }

  @Get('scope/:scope')
  @ApiOperation({ summary: 'Get permissions by scope' })
  @ApiResponse({
    status: 200,
    description: 'List of permissions in given scope',
  })
  async getPermissionsByScope(
    @Param('scope') scope: PermissionScope,
  ): Promise<Permission[]> {
    return this.permissionService.getPermissionsByScope(scope);
  }

  @Get('user/:userId/social-account/:socialAccountId')
  @ApiOperation({
    summary: 'Get user permissions for a specific social account',
  })
  @ApiResponse({ status: 200, description: 'List of effective permissions' })
  async getUserSocialAccountPermissions(
    @Param('userId') userId: string,
    @Param('socialAccountId') socialAccountId: string,
  ): Promise<Permission[]> {
    return this.permissionService.getUserSocialAccountPermissions(
      userId,
      socialAccountId,
    );
  }

  @Get('can-manage/:actorUserId/:targetUserId/org/:organizationId')
  @ApiOperation({
    summary:
      'Check if a user can manage another user (based on role hierarchy)',
  })
  @ApiResponse({ status: 200, description: 'Boolean result' })
  async canManageUser(
    @Param('actorUserId') actorUserId: string,
    @Param('targetUserId') targetUserId: string,
    @Param('organizationId') organizationId: string,
  ): Promise<boolean> {
    return this.permissionService.canManageUser(
      actorUserId,
      targetUserId,
      organizationId,
    );
  }
}
