import { Module } from '@nestjs/common';
import { PollingService } from './polling.service';
import { PollingController } from './polling.controller';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { LinkedinPollingService } from './linkedin-polling.service';
import { XPollingService } from './x-polling.service';
import { LinkedinApiClient } from './clients/linkedin-api.client';
import { XApiClient } from './clients/x-api.client';
import { HttpModule } from '@nestjs/axios';
import { RateLimitModule } from '@/rate-limit/rate-limit.module';
import { SocialAccountModule } from '@/social-account/social-account.module';


@Module({
  imports: [
    HttpModule,
    ScheduleModule.forRoot(),
    BullModule.registerQueue({
      name: 'engagement-processing', // Queue for engagement jobs
    }),

    SocialAccountModule,
    RateLimitModule
  ],
  controllers: [PollingController],
  providers: [PollingService, LinkedinPollingService,
    XPollingService,
    LinkedinApiClient,
    XApiClient,],
})
export class PollingModule {}
