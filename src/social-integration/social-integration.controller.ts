import { Controller } from '@nestjs/common';
import { SocialIntegrationService } from './social-integration.service';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Social Integration')
@ApiBearerAuth()
@Controller('social')
export class SocialIntegrationController {
  constructor(
    private readonly socialIntegrationService: SocialIntegrationService,
  ) {}
}
