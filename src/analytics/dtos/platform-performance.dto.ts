import { ApiProperty } from '@nestjs/swagger';
import { AnalyticsSummary } from './analytics-summary.dto';
import { Platform } from '@generated/enums';
export class PlatformPerformance {
  @ApiProperty({ enum: Platform, description: 'Platform name' })
  platform: Platform;

  @ApiProperty({ type: AnalyticsSummary, description: 'Analytics metrics for the platform' })
  metrics: AnalyticsSummary;

  @ApiProperty({ description: 'Percentage of this platform relative to total engagement' })
  percentageChange: number;
}
