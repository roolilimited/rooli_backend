import { Module } from '@nestjs/common';
import { SocialIntegrationService } from './social-integration.service';
import { SocialIntegrationController } from './social-integration.controller';
import { SocialAccountModule } from 'src/social-account/social-account.module';
import { HttpModule } from '@nestjs/axios';
import { PlatformServiceFactory } from './platform-service.factory';
import { LinkedInService } from './platforms/linkedin.service';
import { XService } from './platforms/x.service';
import { EncryptionService } from 'src/common/utility/encryption.service';
import { MetaModule } from './meta/meta.module';
import { LinkedinModule } from './linkedin/linkedin.module';


@Module({
  imports: [
    SocialAccountModule,
    HttpModule,
    MetaModule,
    LinkedinModule,
  ],
  controllers: [SocialIntegrationController],
  providers: [
    SocialIntegrationService,
    PlatformServiceFactory,
    XService,
    LinkedInService,
    PlatformServiceFactory,
    XService,
    LinkedInService,
    EncryptionService,
  ],
})
export class SocialIntegrationModule {}
