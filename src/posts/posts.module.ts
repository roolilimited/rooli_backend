import {  Module, Post } from '@nestjs/common';
import { PostsService } from './posts.service';
import { PostsController } from './posts.controller';
import { HttpModule } from '@nestjs/axios';
import { ApprovalsModule } from '@/approvals/approvals.module';
import { EncryptionService } from '@/common/utility/encryption.service';
import { MediaModule } from '@/media/media.module';
import { RateLimitModule } from '@/rate-limit/rate-limit.module';

@Module({
  imports: [
    //SchedulingModule,
    ApprovalsModule,
    MediaModule,
    RateLimitModule,
    HttpModule
  ],
  controllers: [PostsController],
  providers: [
    PostsService,
    EncryptionService,
  ],
})
export class PostsModule {}
