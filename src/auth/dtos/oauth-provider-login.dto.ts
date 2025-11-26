import { AuthProvider } from '@generated/enums';
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString } from 'class-validator';

export class OAuthProviderLoginDto {
  @ApiProperty({
    enum: AuthProvider,
    example: AuthProvider.GOOGLE,
    description: 'The OAuth provider (e.g., GOOGLE, FACEBOOK, GITHUB).',
  })
  @IsEnum(AuthProvider)
  provider: AuthProvider;

  @ApiProperty({
    example: 'ya29.a0AfH6SMCxyz12345...',
    description:
      'The OAuth access token or ID token obtained from the provider.',
  })
  @IsString()
  token: string;
}
