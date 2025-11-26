import { OrganizationRole } from '@generated/enums';
import { SetMetadata } from '@nestjs/common';

export const ORGANIZATION_ROLES_KEY = 'organizationRoles';
export const OrganizationRoles = (...roles: OrganizationRole[]) =>
  SetMetadata(ORGANIZATION_ROLES_KEY, roles);
