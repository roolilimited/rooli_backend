import { PostStatus } from '@generated/enums';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsArray, IsDateString } from 'class-validator';

export class UpdatePostDto {
  @ApiPropertyOptional({
    description: 'Updated post content',
    example: 'We’ve just rolled out new updates for our platform!',
  })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiPropertyOptional({
    description: 'Updated list of media URLs (replaces old media)',
    example: [
      'https://res.cloudinary.com/demo/image/upload/v1234567890/updated1.jpg',
      'https://res.cloudinary.com/demo/image/upload/v1234567890/updated2.jpg',
    ],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mediaUrls?: string[];

  @ApiPropertyOptional({
    description: 'Reschedule the post to a new datetime (ISO 8601)',
    example: '2025-09-01T12:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @ApiPropertyOptional({
    description:
      'Status of the post (e.g., DRAFT, SCHEDULED, PUBLISHED, FAILED)',
    example: 'SCHEDULED',
  })
  @IsOptional()
  @IsString()
  status?: PostStatus;

  @ApiPropertyOptional({ description: 'Updated media file IDs' })
  @IsOptional()
  @IsArray()
  mediaFileIds?: string[];
}
