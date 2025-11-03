import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsNumber, IsString } from 'class-validator';

export enum AIProviderRateLimitPeriod {
  MINUTE = 'minute',
  HOUR = 'hour',
  DAY = 'day',
}

export class AIProviderRateLimitDto {
  @ApiProperty({
    description: 'The period of the rate limit',
    enum: AIProviderRateLimitPeriod,
  })
  @IsEnum(AIProviderRateLimitPeriod)
  period: AIProviderRateLimitPeriod;

  @ApiProperty({
    description: 'The model of the rate limit',
  })
  @IsString()
  @IsNotEmpty()
  model: string;

  @ApiProperty({
    description: 'The number of requests allowed per period',
  })
  @IsNumber()
  @IsNotEmpty()
  requests: number;

  @ApiProperty({
    description: 'The number of tokens allowed per period',
  })
  @IsNumber()
  @IsNotEmpty()
  tokens: number;
}
