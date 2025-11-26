import { Module } from '@nestjs/common';
import { OpenAiProvider } from './providers/openai.service';
import { AiContentService } from './services/ai-content.service';
import { AiImageService } from './services/ai-image.service';
import { AiUsageService } from './services/ai-usage.service';
import { AiController } from './ai.controller';
import { StableDiffusionProvider } from './providers/stable-diffusion.service';
import { HuggingFaceService} from './providers/huggingface.provider';
import { BrandKitModule } from '@/brand-kit/brand-kit.module';
import { MediaModule } from '@/media/media.module';
import { RateLimitModule } from '@/rate-limit/rate-limit.module';


@Module({
  imports: [BrandKitModule, RateLimitModule, MediaModule],
  controllers: [AiController],
  providers: [AiContentService,
    AiImageService,
    AiUsageService,
    OpenAiProvider,
    StableDiffusionProvider,
    HuggingFaceService],
  exports: [AiContentService, AiImageService, AiUsageService],
})
export class AiModule {}
