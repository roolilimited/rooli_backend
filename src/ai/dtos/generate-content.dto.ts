import { IsEnum, IsString, IsOptional, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Platform, ContentType, ToneType } from '@generated/enums';

export class GenerateContentDto {
  @ApiProperty({ enum: Platform, example: Platform.INSTAGRAM })
  @IsEnum(Platform)
  platform: Platform;

  @ApiProperty({ enum: ContentType, example: ContentType.POST })
  @IsEnum(ContentType)
  contentType: ContentType;

  @ApiProperty({ example: 'Sustainable fashion' })
  @IsString()
  topic: string;

  @ApiProperty({ enum: ToneType, example: ToneType.CASUAL })
  @IsEnum(ToneType)
  tone: ToneType;

  @ApiPropertyOptional({ example: 'Write it in a storytelling format' })
  @IsOptional()
  @IsString()
  customPrompt?: string;

  @ApiPropertyOptional({ type: [String], example: ['eco', 'green fashion'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[];
}
