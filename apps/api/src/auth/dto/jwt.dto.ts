import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class JwtDto {
  @ApiProperty({
    description: 'JWT access token',
  })
  @IsString()
  @IsNotEmpty()
  accessToken: string;
}
