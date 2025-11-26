import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CreateNotificationDto } from './dtos/create-notification.dto';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@/prisma/prisma.service';
import { NotificationEntity } from '@generated/client';
import { NotificationPriority } from '@generated/enums';
@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Create a notification for a single user
   */
  async createUserNotification(
    dto: CreateNotificationDto,
  ): Promise<NotificationEntity> {
    const notification = await this.prisma.notificationEntity.create({
      data: {
        userId: dto.userId,
        organizationId: dto.organizationId,
        socialAccountId: dto.socialAccountId,
        type: dto.type,
        title: dto.title,
        content: dto.message,
        data: dto.data,
        priority: dto.priority ?? NotificationPriority.NORMAL,
        messageId: dto.messageId,
        postId: dto.postId,
      },
    });

    // Emit event for real-time delivery via gateway
    this.eventEmitter.emit('notification.created', notification);
    return notification;
  }

  /**
   * Create notifications for multiple users efficiently
   */
  async createBulkNotifications(
    dtos: CreateNotificationDto[],
  ): Promise<number> {
    if (!dtos.length) return 0;

    const result = await this.prisma.notificationEntity.createMany({
      data: dtos.map((dto) => ({
        userId: dto.userId,
        organizationId: dto.organizationId,
        socialAccountId: dto.socialAccountId,
        type: dto.type,
        title: dto.title,
        content: dto.message,
        data: dto.data,
        priority: dto.priority ?? NotificationPriority.NORMAL,
        messageId: dto.messageId,
        postId: dto.postId,
        createdAt: new Date(),
      })),
      skipDuplicates: true, // avoid duplicates
    });

    // Optionally emit real-time events for each notification
    dtos.forEach((dto) => this.eventEmitter.emit('notification.created', dto));

    return result.count;
  }

  async getUserNotifications(
    userId: string,
    organizationId: string,
    options?: { unreadOnly?: boolean },
  ): Promise<NotificationEntity[]> {
    return this.prisma.notificationEntity.findMany({
      where: {
        userId,
        organizationId,
        ...(options?.unreadOnly ? { readAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async markAsRead(
    notificationId: string,
    userId: string,
  ): Promise<NotificationEntity> {
    const notification = await this.prisma.notificationEntity.findFirst({
      where: { id: notificationId, userId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    return this.prisma.notificationEntity.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    });
  }

  async markAllAsRead(userId: string, organizationId: string): Promise<number> {
    const result = await this.prisma.notificationEntity.updateMany({
      where: {
        userId,
        organizationId,
        readAt: null,
      },
      data: { readAt: new Date() },
    });

    return result.count;
  }

  // ------------------------
  // CLEANUP (Expired notifications)
  // ------------------------

  async cleanupExpiredNotifications(): Promise<number> {
    const now = new Date();
    const result = await this.prisma.notificationEntity.deleteMany({
      where: {
        expiresAt: { lte: now },
      },
    });
    return result.count;
  }

  /**
   * Run cleanup automatically every day at midnight
   * (You can adjust CronExpression)
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleCronCleanup() {
    const deleted = await this.cleanupExpiredNotifications();
    if (deleted > 0) {
      console.log(`🧹 Cleaned up ${deleted} expired notifications`);
    }
  }

  /**
   * Fetch audience (user IDs) based on permission
   **/

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
      .map((member) => member.user.id);
  }
}
