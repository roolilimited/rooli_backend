import { AuthProvider } from '@generated/enums';
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';

export class OAuthLoginDto {
  @ApiProperty({
    enum: AuthProvider,
    example: AuthProvider.GOOGLE,
    description:
      'OAuth provider used for authentication (e.g., GOOGLE, FACEBOOK, GITHUB).',
  })
  @IsEnum(AuthProvider)
  provider: AuthProvider;

  @ApiProperty({
    example: '11223344556677889900',
    description: 'Unique user identifier from the OAuth provider.',
  })
  @IsString()
  id: string;

  @ApiProperty({
    example: 'jane.doe@example.com',
    description: 'Email address returned by the OAuth provider.',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    required: false,
    example: 'Jane',
    description: 'First name of the user (if provided by the OAuth provider).',
  })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiProperty({
    required: false,
    example: 'Doe',
    description: 'Last name of the user (if provided by the OAuth provider).',
  })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiProperty({
    required: false,
    example: 'https://lh3.googleusercontent.com/a-/AOh14Gh12345xyz',
    description: 'Profile picture URL from the OAuth provider.',
  })
  @IsOptional()
  @IsString()
  avatar?: string;
}
