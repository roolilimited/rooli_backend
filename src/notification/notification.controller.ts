import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { NotificationService } from './notification.service';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { CreateNotificationDto } from './dtos/create-notification.dto';
import { MarkAllReadDto } from './dtos/mark-all-read.dto';
import { MarkReadDto } from './dtos/mark-read.dto';
import { NotificationEntity } from '@generated/client';

@ApiTags('Notifications')
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new notification' })
  async create(@Body() dto: CreateNotificationDto): Promise<NotificationEntity> {
    return this.notificationService.createUserNotification(dto);
  }

  @Get(':userId/:organizationId')
  @ApiOperation({ summary: 'Get user notifications in an organization' })
  @ApiQuery({ name: 'unreadOnly', type: Boolean, required: false })
  async getUserNotifications(
    @Param('userId') userId: string,
    @Param('organizationId') organizationId: string,
    @Query('unreadOnly') unreadOnly?: string,
  ): Promise<NotificationEntity[]> {
    return this.notificationService.getUserNotifications(
      userId,
      organizationId,
      {
        unreadOnly: unreadOnly === 'true',
      },
    );
  }

  @Patch('read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  async markAsRead(@Body() dto: MarkReadDto) {
    return this.notificationService.markAsRead(
      dto.notificationId,
      'TODO-userId',
    ); // Replace with auth
  }

  @Patch('read-all')
  @ApiOperation({
    summary: 'Mark all notifications as read for a user in an organization',
  })
  async markAllAsRead(@Body() dto: MarkAllReadDto) {
    return this.notificationService.markAllAsRead(
      'TODO-userId',
      dto.organizationId,
    ); // Replace with auth
  }

  @Patch('cleanup')
  @ApiOperation({ summary: 'Clean expired notifications (admin/cron)' })
  async cleanupExpired() {
    return this.notificationService.cleanupExpiredNotifications();
  }
}
