import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsEnum, IsDateString, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { Platform } from '@generated/enums';

export class AnalyticsQueryDto {
  @ApiPropertyOptional({ enum: Platform, description: 'Filter by platform' })
  @IsOptional()
  @IsEnum(Platform)
  platform?: Platform;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Start date for filtering',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'End date for filtering',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ type: String, description: 'Filter by post ID' })
  @IsOptional()
  @IsString()
  postId?: string;

  @ApiPropertyOptional({
    type: Number,
    description: 'Number of results to return',
    default: 100,
  })
  @IsOptional()
  @Type(() => Number)
  limit?: number = 100;
}
