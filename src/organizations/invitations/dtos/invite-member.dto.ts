
import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrganizationRole } from '@generated/enums';

export class InviteMemberDto {
  @ApiProperty({
    example: 'jane.doe@example.com',
    description: 'Email address of the user to invite',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    enum: OrganizationRole,
    example: OrganizationRole.MEMBER,
    description: 'Role to assign to the invited member',
  })
  @IsEnum(OrganizationRole)
  role: OrganizationRole;

  @ApiPropertyOptional({
    example: 'Welcome to our team! Excited to collaborate with you.',
    description: 'Optional custom message included in the invitation email',
  })
  @IsOptional()
  @IsString()
  message?: string;

    @ApiPropertyOptional({
    example: { canEditPosts: true, canDeletePosts: false },
    description: 'Optional permissions for the member as key-value pairs',
  })
  @IsOptional()
  permissions?: Record<string, boolean>;
}