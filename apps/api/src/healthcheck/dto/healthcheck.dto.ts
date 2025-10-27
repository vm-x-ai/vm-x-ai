import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class HealthcheckResponseDto {
  @ApiProperty({
    description: 'The status of the healthcheck',
    example: 'ok',
  })
  @IsString()
  status: 'ok' | 'unhealthy';
}
