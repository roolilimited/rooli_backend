import {  Module } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import { ApprovalsController } from './approvals.controller';
import { NotificationModule } from '@/notification/notification.module';
import { SocialSchedulerModule } from '@/social-scheduler/social-scheduler.module';


@Module({
  imports: [
    NotificationModule,
     SocialSchedulerModule
  ],
  controllers: [ApprovalsController],
  providers: [ApprovalsService],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
