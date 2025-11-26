import { PaginationDto } from '@/common/dtos/pagination.dto';
import { Platform, TemplateCategory } from '@generated/enums';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsEnum, IsBoolean } from 'class-validator';

export class GetSystemTemplatesDto extends PaginationDto  {
  @ApiPropertyOptional({
    description:
      'The platform for which the templates belong (e.g., Facebook, Instagram, Twitter)',
    enum: Platform,
    example: Platform.FACEBOOK,
  })
  @IsOptional()
  @IsEnum(Platform)
  platform?: Platform;

  @ApiPropertyOptional({
    description:
      'The category of templates (e.g., marketing, personal, business)',
    enum: TemplateCategory,
    example: TemplateCategory.EVENT,
  })
  @IsOptional()
  @IsEnum(TemplateCategory)
  category?: TemplateCategory;

  @ApiPropertyOptional({
    description: 'Whether to return only featured templates',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  featured?: boolean;
}
