import { Platform } from '@generated/enums';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsDate } from 'class-validator';

export enum ExportFormat {
  EXCEL = 'excel',
  PDF = 'pdf',
  CSV = 'csv',
}

export class ExportOptionsDto {
  @ApiProperty({ description: 'Organization ID for which report is generated' })
  organizationId: string;

  @ApiProperty({ enum: ExportFormat, description: 'Format of export' })
  @IsEnum(ExportFormat)
  format: ExportFormat;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Start date of analytics data',
  })
  @IsOptional()
  @IsDate()
  startDate?: Date;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'End date of analytics data',
  })
  @IsOptional()
  @IsDate()
  endDate?: Date;

  @ApiPropertyOptional({
    enum: Platform,
    description: 'Filter analytics by platform',
  })
  @IsOptional()
  @IsEnum(Platform)
  platform?: Platform;
}
