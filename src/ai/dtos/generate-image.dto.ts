import { IsString, IsOptional, IsEnum, maxLength, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Platform } from '@generated/enums';

export class GenerateImageDto {
  @ApiProperty({
    description: 'The prompt or idea for the AI to generate an image',
    example: 'A futuristic city skyline at sunset',
  })
  @IsString()
   @MaxLength(1000, { message: 'Prompt is too long. Maximum length is 1000 characters.' })
  prompt: string;

  @ApiPropertyOptional({
    description: 'Target platform for which the image is intended',
    enum: Platform,
    example: Platform.INSTAGRAM,
  })
  @IsOptional()
  @IsEnum(Platform)
  platform?: Platform;

  @ApiPropertyOptional({
    description: 'Visual style for the AI image',
    example: 'photorealistic',
    enum: ['photorealistic', 'illustration', '3d'],
  })
  @IsOptional()
  @IsString()
  style?: string;

  @ApiPropertyOptional({
    description: 'Aspect ratio of the generated image',
    example: '1:1',
    enum: ['1:1', '16:9', '4:5'],
  })
  @IsOptional()
  @IsString()
  aspectRatio?: string;

  @ApiPropertyOptional({
    description: 'Optional model ID to use for image generation (defaults to stable-diffusion)',
    example: 'stabilityai/stable-diffusion-xl-base-1.0',
  })
  @IsOptional()
  @IsString()
  model?: string;
}
