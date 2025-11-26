;import { Injectable} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Permission } from '@generated/client';
import { PermissionResource, PermissionAction, PermissionScope } from '@generated/enums';

export interface PermissionCheck {
  userId: string;
  organizationId?: string;
  socialAccountId?: string;
  resource: PermissionResource;
  action: PermissionAction;
}

export interface UserPermissionContext {
  userId: string;
  organizationId?: string;
  socialAccountId?: string;
  organizationPermissions: string[];
  socialAccountPermissions: string[];
}

@Injectable()
export class PermissionService {
  constructor(private prisma: PrismaService) {}

  // Get all permissions for a user in an organization
  async getUserPermissions(userId: string, organizationId: string): Promise<UserPermissionContext> {
    // Get organization-level permissions
    const orgMember = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
      include: {
        role: {
          include: {
            permissions: {
              include: {
                permission: true,
              },
            },
          },
        },
      },
    });

    // Get social account permissions for all accounts user has access to
    const socialAccountMembers = await this.prisma.socialAccountMember.findMany({
      where: {
        userId,
        isActive: true,
        socialAccount: {
          organizationId,
        },
      },
      include: {
        role: {
          include: {
            permissions: {
              include: {
                permission: true,
              },
            },
          },
        },
        socialAccount: true,
      },
    });

    const organizationPermissions = orgMember?.role?.permissions?.map(rp => 
      this.formatPermissionName(rp.permission)
    ) || [];

    const socialAccountPermissions = socialAccountMembers.flatMap(sam =>
      sam.role?.permissions?.map(rp => 
        `${sam.socialAccount.id}:${this.formatPermissionName(rp.permission)}`
      ) || []
    );

    return {
      userId,
      organizationId,
      organizationPermissions,
      socialAccountPermissions,
    };
  }

  // Check if user has specific permission
  async hasPermission(check: PermissionCheck): Promise<boolean> {
    const permissionName = `${check.resource}:${check.action}`;

    if (check.socialAccountId) {
      // Check social account-specific permission
      const member = await this.prisma.socialAccountMember.findUnique({
        where: {
          socialAccountId_userId: {
            socialAccountId: check.socialAccountId,
            userId: check.userId,
          },
        },
        include: {
          role: {
            include: {
              permissions: {
                include: {
                  permission: true,
                },
              },
            },
          },
        },
      });

      if (member?.role?.permissions) {
        const hasAccountPermission = member.role.permissions.some(rp =>
          this.formatPermissionName(rp.permission) === permissionName &&
          rp.permission.scope === PermissionScope.SOCIAL_ACCOUNT
        );

        if (hasAccountPermission) return true;
      }
    }

    if (check.organizationId) {
      // Check organization-level permission
      const member = await this.prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: check.organizationId,
            userId: check.userId,
          },
        },
        include: {
          role: {
            include: {
              permissions: {
                include: {
                  permission: true,
                },
              },
            },
          },
        },
      });

      if (member?.role?.permissions) {
        const hasOrgPermission = member.role.permissions.some(rp =>
          this.formatPermissionName(rp.permission) === permissionName &&
          (rp.permission.scope === PermissionScope.ORGANIZATION || 
           rp.permission.scope === PermissionScope.SOCIAL_ACCOUNT)
        );

        return hasOrgPermission;
      }
    }

    return false;
  }

  // Batch permission check
  async hasPermissions(checks: PermissionCheck[]): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};

    for (const check of checks) {
      const key = `${check.resource}:${check.action}`;
      results[key] = await this.hasPermission(check);
    }

    return results;
  }

  // Create new permission
  async createPermission(data: {
    name: string;
    description?: string;
    scope: PermissionScope;
    resource: PermissionResource;
    action: PermissionAction;
  }): Promise<Permission> {
    return this.prisma.permission.create({
      data,
    });
  }

  // Get all permissions
  async getAllPermissions(): Promise<Permission[]> {
    return this.prisma.permission.findMany({
      orderBy: [
        { scope: 'asc' },
        { resource: 'asc' },
        { action: 'asc' },
      ],
    });
  }

  // Get permissions by scope
  async getPermissionsByScope(scope: PermissionScope): Promise<Permission[]> {
    return this.prisma.permission.findMany({
      where: { scope },
      orderBy: [
        { resource: 'asc' },
        { action: 'asc' },
      ],
    });
  }

  // Get user's effective permissions for a social account
  async getUserSocialAccountPermissions(
    userId: string,
    socialAccountId: string
  ): Promise<Permission[]> {
    const member = await this.prisma.socialAccountMember.findUnique({
      where: {
        socialAccountId_userId: {
          socialAccountId,
          userId,
        },
      },
      include: {
        role: {
          include: {
            permissions: {
              include: {
                permission: true,
              },
            },
          },
        },
        socialAccount: {
          include: {
            organization: {
              include: {
                members: {
                  where: {
                    userId,
                  },
                  include: {
                    role: {
                      include: {
                        permissions: {
                          include: {
                            permission: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!member) return [];

    // Combine social account permissions with organization permissions
    const socialAccountPermissions = member.role?.permissions?.map(rp => rp.permission) || [];
    
    const organizationPermissions = member.socialAccount.organization.members[0]?.role?.permissions
      ?.map(rp => rp.permission)
      .filter(permission => 
        permission.scope === PermissionScope.ORGANIZATION ||
        permission.scope === PermissionScope.SOCIAL_ACCOUNT
      ) || [];

    // Remove duplicates
    const allPermissions = [...socialAccountPermissions, ...organizationPermissions];
    const uniquePermissions = allPermissions.filter((permission, index, arr) =>
      arr.findIndex(p => p.id === permission.id) === index
    );

    return uniquePermissions;
  }

  // Helper method to format permission name
  private formatPermissionName(permission: Permission): string {
    return `${permission.resource}:${permission.action}`;
  }

  // Check if user can manage another user (based on role hierarchy)
  async canManageUser(
    actorUserId: string,
    targetUserId: string,
    organizationId: string
  ): Promise<boolean> {
    const actorMember = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: actorUserId,
        },
      },
      include: { role: true },
    });

    const targetMember = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: targetUserId,
        },
      },
      include: { role: true },
    });

    if (!actorMember || !targetMember) return false;

    // Owner can manage everyone, members can't manage owners
    if (actorMember.role.name === 'owner') return true;
    if (targetMember.role.name === 'owner') return false;
    
    // Editors can manage analysts
    if (actorMember.role.name === 'editor' && targetMember.role.name === 'analyst') return true;
    
    return false;
  }
}