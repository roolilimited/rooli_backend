import { Module } from '@nestjs/common';
import { SocialIntegrationService } from './social-integration.service';
import { SocialIntegrationController } from './social-integration.controller';
import { HttpModule } from '@nestjs/axios';
import { MetaModule } from './meta/meta.module';
import { LinkedinModule } from './linkedin/linkedin.module';
import { TwitterModule } from './twitter/twitter.module';
import { EncryptionService } from '@/common/utility/encryption.service';
import { SocialAccountModule } from '@/social-account/social-account.module';


@Module({
  imports: [
    SocialAccountModule,
    HttpModule,
    MetaModule,
    LinkedinModule,
    TwitterModule,
  ],
  controllers: [SocialIntegrationController],
  providers: [
    SocialIntegrationService,
    EncryptionService,
  ],
})
export class SocialIntegrationModule {}
