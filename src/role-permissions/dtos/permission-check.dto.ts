
import { PermissionResource, PermissionAction } from '@generated/enums';
import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class PermissionCheckDto {
  @ApiProperty({ description: 'User ID to check permission for' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ description: 'Resource being checked (e.g. posts, analytics)' })
  @IsEnum(PermissionResource)
  resource: PermissionResource;

  @ApiProperty({ description: 'Action on the resource (e.g. create, read)' })
  @IsEnum(PermissionAction)
  action: PermissionAction;

  @ApiProperty({ required: false, description: 'Organization ID scope (if applicable)' })
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiProperty({ required: false, description: 'Social account ID scope (if applicable)' })
  @IsOptional()
  @IsString()
  socialAccountId?: string;
}

export class BatchPermissionCheckDto {
  @ApiProperty({ type: [PermissionCheckDto] })
  checks: PermissionCheckDto[];
}
