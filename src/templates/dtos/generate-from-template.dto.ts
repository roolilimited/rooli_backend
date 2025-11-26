import { Platform } from '@generated/enums';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsObject,
  IsOptional,
  IsBoolean,
  IsEnum,
} from 'class-validator';

export class GenerateFromTemplateDto {
  @ApiProperty({
    type: Object,
    description: 'Variables to replace in the template',
    example: {
      product: 'Sneakers',
      discount: '20%',
      url: 'https://shop.com',
    },
  })
  @IsObject()
  variables: Record<string, any>;

  @ApiPropertyOptional({
    type: Object,
    description: 'Additional options for generation',
    example: {
      includeHashtags: true,
      includeCTA: true,
      enhanceWithAI: true,
      tone: 'FRIENDLY',
      platform: 'INSTAGRAM',
    },
  })
  @IsOptional()
  @IsObject()
  options?: {
    includeHashtags?: boolean;
    includeCTA?: boolean;
    enhanceWithAI?: boolean;
    tone?: string;
    platform?: Platform;
  };
}
