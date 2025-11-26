import { Module } from '@nestjs/common';
import { ContentTemplatesService } from './templates.service';
import { ContentTemplatesController } from './templates.controller';
import { AiModule } from '@/ai/ai.module';
import { BrandKitModule } from '@/brand-kit/brand-kit.module';


@Module({
  imports: [AiModule, BrandKitModule],
  controllers: [ContentTemplatesController],
  providers: [ContentTemplatesService ],
})
export class TemplatesModule {}
