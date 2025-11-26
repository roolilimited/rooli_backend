import { NotificationType, NotificationPriority } from '@generated/enums';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsEnum,
  IsOptional,
  IsObject,
  IsDateString,
} from 'class-validator';

export class CreateNotificationDto {
  @ApiProperty({ description: 'User who receives the notification' })
  @IsString()
  userId: string;

  @ApiProperty({
    description: 'Organization ID where the notification belongs',
  })
  @IsString()
  organizationId: string;

  @ApiProperty({ enum: NotificationType, description: 'Type of notification' })
  @IsEnum(NotificationType)
  type: NotificationType;

  @ApiProperty({ description: 'Notification title' })
  @IsString()
  title: string;

  @ApiProperty({ description: 'Notification message content' })
  @IsString()
  message: string;

  @ApiPropertyOptional({ type: Object, description: 'Additional metadata' })
  @IsOptional()
  @IsObject()
  data?: Record<string, any>;

  @ApiPropertyOptional({
    enum: NotificationPriority,
    description: 'Priority of the notification',
  })
  @IsOptional()
  @IsEnum(NotificationPriority)
  priority?: NotificationPriority;

  @ApiPropertyOptional({
    description: 'Message ID if linked to a conversation',
  })
  @IsOptional()
  @IsString()
  messageId?: string;

  @ApiPropertyOptional({ description: 'Post ID if linked to a post' })
  @IsOptional()
  @IsString()
  postId?: string;

  @ApiPropertyOptional({ description: 'Social Account ID if applicable' })
  @IsString()
  socialAccountId: string;

  // @ApiPropertyOptional({ description: 'Expiration date' })
  // @IsOptional()
  // @IsDateString()
  // expiresAt?: string;
}
