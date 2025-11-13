import { Module } from '@nestjs/common';
import { LinkedInService } from './linkedIn.service';
import { LinkedinController } from './linkedin.controller';
import { EncryptionService } from 'src/common/utility/encryption.service';

@Module({
  controllers: [LinkedinController],
  providers: [LinkedInService, EncryptionService],
})
export class LinkedinModule {}
