import { Module } from '@nestjs/common';
import { MetaService } from './meta.service';
import { MetaController } from './meta.controller';
import { EncryptionService } from '@/common/utility/encryption.service';
import { SocialAccountModule } from '@/social-account/social-account.module';


@Module({
  imports: [SocialAccountModule],
  controllers: [MetaController],
  providers: [MetaService, EncryptionService],
  exports: [MetaModule],
})
export class MetaModule {}
