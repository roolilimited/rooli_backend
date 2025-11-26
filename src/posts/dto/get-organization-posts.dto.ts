import { IsOptional, IsString, IsInt, Min, IsDate } from 'class-validator';
import { Type } from 'class-transformer';
import { PostStatus, Platform } from '@generated/enums';

export class GetOrganizationPostsDto {
  @IsOptional()
  @IsString()
  status?: PostStatus;

  @IsOptional()
  @IsString()
  platform?: Platform;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startDate?: Date; // You could use Date if you want to transform it

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endDate?: Date; // You could use Date if you want to transform it

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit: number = 10;
}
