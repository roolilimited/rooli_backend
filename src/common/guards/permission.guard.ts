import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedUser, PERMISSIONS_KEY, RequiredPermission } from '../decorators/permissions.decorator';
import { PermissionService } from '@/role-permissions/role-permission.service';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private permissionService: PermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<RequiredPermission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions) {
      return true; // No permissions required
    }

    const request = context.switchToHttp().getRequest();
    const user: AuthenticatedUser = request.user;

    if (!user) {
      throw new UnauthorizedException('User not authenticated');
    }

    // Extract organization and social account IDs from request
    const organizationId = request.params.organizationId || request.body.organizationId || user.organizationId;
    const socialAccountId = request.params.socialAccountId || request.body.socialAccountId || user.socialAccountId;

    // Check each required permission
    for (const permission of requiredPermissions) {
      const hasPermission = await this.permissionService.hasPermission({
        userId: user.id,
        organizationId: permission.requireSocialAccount ? undefined : organizationId,
        socialAccountId: permission.requireSocialAccount ? socialAccountId : undefined,
        resource: permission.resource,
        action: permission.action,
      });

      if (!hasPermission) {
        throw new ForbiddenException(
          `Insufficient permissions: ${permission.resource}:${permission.action}`
        );
      }
    }

    return true;
  }
}
