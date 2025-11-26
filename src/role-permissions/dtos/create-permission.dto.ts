import { PermissionScope, PermissionResource, PermissionAction } from '@generated/enums';
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreatePermissionDto {
  @ApiProperty({ description: 'Unique permission name (e.g. posts:create)' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Optional description of the permission' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: PermissionScope })
  @IsEnum(PermissionScope)
  scope: PermissionScope;

  @ApiProperty({ enum: PermissionResource })
  @IsEnum(PermissionResource)
  resource: PermissionResource;

  @ApiProperty({ enum: PermissionAction })
  @IsEnum(PermissionAction)
  action: PermissionAction;
}
