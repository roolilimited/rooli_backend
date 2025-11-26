import { PermissionResource, PermissionAction } from '@generated/enums';
import { SetMetadata } from '@nestjs/common';


export interface RequiredPermission {
  resource: PermissionResource;
  action: PermissionAction;
  requireSocialAccount?: boolean; // If true, must check social account permission
}

export const PERMISSIONS_KEY = 'permissions';

export const RequirePermissions = (...permissions: RequiredPermission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

// Convenience decorators for common permissions
export const RequireOrgPermission = (resource: PermissionResource, action: PermissionAction) =>
  RequirePermissions({ resource, action, requireSocialAccount: false });

export const RequireSocialAccountPermission = (resource: PermissionResource, action: PermissionAction) =>
  RequirePermissions({ resource, action, requireSocialAccount: true });

// src/rbac/decorators/current-user.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthenticatedUser {
  id: string;
  email: string;
  organizationId?: string;
  socialAccountId?: string;
  permissions?: string[];
}

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);