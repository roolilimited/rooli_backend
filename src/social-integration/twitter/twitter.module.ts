import { Module } from '@nestjs/common';
import { TwitterService } from './twitter.service';
import { TwitterController } from './twitter.controller';
import { HttpModule } from '@nestjs/axios';
import { CacheModule } from '@nestjs/cache-manager';
import { EncryptionService } from '@/common/utility/encryption.service';

@Module({
  imports: [
    HttpModule,
    CacheModule.register({
      ttl: 600,
    }),
  ],
  controllers: [TwitterController],
  providers: [TwitterService, EncryptionService],
})
export class TwitterModule {}
