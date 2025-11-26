import { PrismaService } from '@/prisma/prisma.service';
import { Injectable } from '@nestjs/common';

@Injectable()
export class NotificationAudienceService {
  constructor(private readonly prisma: PrismaService) {}
  async getSocialAccountAudience(
    organizationId: string,
    socialAccountId: string,
    requiredPermission: string,
  ): Promise<string[]> {
    const members = await this.prisma.socialAccountMember.findMany({
      where: {
        socialAccountId,
        isActive: true,
        socialAccount: {
          organizationId,
          isActive: true,
        },
      },
      include: {
        user: true,
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

    return members
    .filter((member) =>
      member.role?.permissions.some(
        (rp) => rp.permission.name === requiredPermission,
      ),
    )
    .map((m) => m.user.id);
  }

  async getOrganizationAudience(
    organizationId: string,
    requiredPermission: string,
  ): Promise<string[]> {
    const members = await this.prisma.organizationMember.findMany({
      where: {
        organizationId,
        isActive: true,
      },
      include: {
        user: true,
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

    return members
    .filter((member) =>
      member.role?.permissions.some(
        (rp) => rp.permission.name === requiredPermission,
      ),
    )
    .map((m) => m.user.id);
  }

  //  async getNotificationAudience(params: {
  //   organizationId: string;
  //   socialAccountId?: string;
  //   requiredPermission: string;
  //   excludeUserIds?: string[];
  // }): Promise<string[]> {
  //   return this.rolePermissionService.getUsersWithPermission({
  //     organizationId: params.organizationId,
  //     socialAccountId: params.socialAccountId,
  //     permissionName: params.requiredPermission,
  //     excludeUserIds: params.excludeUserIds
  //   });
  // }

  // async canUserReceiveNotification(params: {
  //   userId: string;
  //   organizationId: string;
  //   socialAccountId?: string;
  //   requiredPermission: string;
  // }): Promise<boolean> {
  //   return this.rolePermissionService.hasPermission({
  //     userId: params.userId,
  //     organizationId: params.organizationId,
  //     socialAccountId: params.socialAccountId,
  //     permissionName: params.requiredPermission
  //   });
  // }
}
