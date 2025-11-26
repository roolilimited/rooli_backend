import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { NotificationsListener } from './listeners/notifications.listener';
import { ChatGateway } from './chat.gateway';
import { NotificationGateway } from './notification.gateway';
import { NotificationAudienceService } from './notification-audience.service';
import { AuthModule } from '@/auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [NotificationController],
  providers: [NotificationService, NotificationsListener, NotificationGateway, ChatGateway, NotificationAudienceService],
  exports: [NotificationService, NotificationAudienceService],
})
export class NotificationModule {}
