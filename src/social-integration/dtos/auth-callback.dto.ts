import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class OAuthCallbackDto {
  @ApiProperty({ description: 'Authorization code from OAuth flow' })
  @IsString()
  code: string;

  @ApiProperty({ description: 'Encrypted state from OAuth flow' })
  @IsString()
  encryptedState: string;
}
