import { Module } from '@nestjs/common';
import { LinkedInService } from './linkedIn.service';
import { LinkedinController } from './linkedin.controller';
import { HttpModule } from '@nestjs/axios';
import { EncryptionService } from '@/common/utility/encryption.service';

@Module({
  imports: [HttpModule],
  controllers: [LinkedinController],
  providers: [LinkedInService, EncryptionService],
})
export class LinkedinModule {}
