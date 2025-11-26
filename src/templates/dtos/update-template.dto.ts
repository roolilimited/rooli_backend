import {
  IsOptional,
  IsString,
  IsEnum,
  IsArray,
  IsBoolean,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TemplateContent } from '../interfaces/index.interface';
import { Platform, ContentType, TemplateCategory, TemplateStatus } from '@generated/enums';
export class UpdateTemplateDto {
  @ApiPropertyOptional({ description: 'New template name' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Updated description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: Platform, description: 'Target platform' })
  @IsOptional()
  @IsEnum(Platform)
  platform?: Platform;

  @ApiPropertyOptional({ enum: ContentType, description: 'Type of content' })
  @IsOptional()
  @IsEnum(ContentType)
  contentType?: ContentType;

  @ApiPropertyOptional({
    enum: TemplateCategory,
    description: 'Template category',
  })
  @IsOptional()
  @IsEnum(TemplateCategory)
  category?: TemplateCategory;

  @ApiPropertyOptional({ type: [String], description: 'Updated tags' })
  @IsOptional()
  @IsArray()
  tags?: string[];

  @ApiPropertyOptional({
    type: Object,
    description: 'Updated content structure',
  })
  @IsOptional()
  content?: TemplateContent;

  @ApiPropertyOptional({ enum: TemplateStatus, description: 'Template status' })
  @IsOptional()
  @IsEnum(TemplateStatus)
  status?: TemplateStatus;

  @ApiPropertyOptional({ description: 'Change associated brand kit' })
  @IsOptional()
  @IsString()
  brandKitId?: string;

  @ApiPropertyOptional({
    description: 'Set to true to make the template public',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}
