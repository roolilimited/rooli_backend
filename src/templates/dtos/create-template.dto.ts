import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TemplateContentDto } from './template-content.dto';

import { IsBoolean, IsEnum, IsOptional, IsString, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Platform, ContentType, TemplateCategory } from '@generated/enums';

export class CreateTemplateDto {
  @ApiProperty({ example: 'Summer Sale Post', description: 'Template name' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'A catchy template for summer discounts' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: Platform, example: 'INSTAGRAM' })
  @IsEnum(Platform)
  platform: Platform;

  @ApiProperty({ enum: ContentType, example: 'POST' })
  @IsEnum(ContentType)
  contentType: ContentType;

  @ApiProperty({ enum: TemplateCategory, example: 'PROMOTIONAL' })
  @IsEnum(TemplateCategory)
  category: TemplateCategory;

  @ApiPropertyOptional({
    type: [String],
    example: ['summer', 'discounts'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiProperty({
    type: TemplateContentDto,
    description: 'Content structure of the template',
  })
  @ValidateNested()
  @Type(() => TemplateContentDto)
  content: TemplateContentDto;

  @ApiPropertyOptional({
    description: 'Set to true to make the template public',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @ApiPropertyOptional({
    description: 'Associated Brand Kit ID (must belong to the organization)',
  })
  @IsOptional()
  @IsString()
  brandKitId?: string;

  @ApiPropertyOptional({
    description: 'Organization ID (if creating a template for an organization)',
  })
  @IsOptional()
  @IsString()
  organizationId?: string;
}

