import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class TwitterCallbackQueryDto {
  @ApiProperty({
    description:
      'Temporary OAuth request token provided by Twitter in the callback query string',
    example: 'JtE9gAAAAAA...',
  })
  @IsNotEmpty()
  @IsString()
  oauth_token: string;

  @ApiProperty({
    description:
      'OAuth verifier provided by Twitter in the callback query string',
    example: 'kP0nQfq9s8X9Y...',
  })
  @IsNotEmpty()
  @IsString()
  oauth_verifier: string;
}
