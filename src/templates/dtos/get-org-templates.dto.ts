import { PaginationDto } from '@/common/dtos/pagination.dto';
import { Platform, ContentType, TemplateCategory, TemplateStatus } from '@generated/enums';
import { ApiPropertyOptional } from '@nestjs/swagger';

import { IsOptional, IsEnum, IsString } from 'class-validator';


export class TemplateFilterDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: Platform,
    description:
      'Filter templates by target platform (e.g., INSTAGRAM, FACEBOOK)',
    example: 'INSTAGRAM',
  })
  @IsOptional()
  @IsEnum(Platform)
  platform?: Platform;

  @ApiPropertyOptional({
    enum: ContentType,
    description: 'Filter templates by content type (e.g., POST, STORY, TWEET)',
    example: 'POST',
  })
  @IsOptional()
  @IsEnum(ContentType)
  contentType?: ContentType;

  @ApiPropertyOptional({
    enum: TemplateCategory,
    description:
      'Filter templates by category (e.g., PROMOTIONAL, ANNOUNCEMENT, HIRING)',
    example: 'PROMOTIONAL',
  })
  @IsOptional()
  @IsEnum(TemplateCategory)
  category?: TemplateCategory;

  @ApiPropertyOptional({
    enum: TemplateStatus,
    description:
      'Filter templates by status (e.g., DRAFT, PUBLISHED, ARCHIVED)',
    example: 'DRAFT',
  })
  @IsOptional()
  @IsEnum(TemplateStatus)
  status?: TemplateStatus;

  @ApiPropertyOptional({
    description: 'Search term for template name or description',
    example: 'summer sale',
  })
  @IsOptional()
  @IsString()
  search?: string;
}
