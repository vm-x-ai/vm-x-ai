import { ApiProperty } from '@nestjs/swagger';
import {
  IsDate,
  IsNotEmpty,
  IsNumber,
  IsString,
  IsUUID,
} from 'class-validator';

export class CompletionPayloadMetricDto {
  @ApiProperty({
    description: 'The workspace ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  @IsUUID('4')
  @IsNotEmpty()
  workspaceId: string;

  @ApiProperty({
    description: 'The environment ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  @IsUUID('4')
  @IsNotEmpty()
  environmentId: string;

  @ApiProperty({
    description: 'The resource',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  @IsUUID('4')
  @IsNotEmpty()
  resourceId: string;

  @ApiProperty({
    description: 'The AI connection ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
  })
  @IsUUID('4')
  @IsNotEmpty()
  connectionId: string;

  @ApiProperty({
    description: 'The model',
    example: 'gpt-4o',
  })
  @IsString()
  @IsNotEmpty()
  model: string;

  @ApiProperty({
    description: 'The request timestamp',
    example: '2021-01-01T00:00:00.000Z',
  })
  @IsDate()
  @IsNotEmpty()
  timestamp: Date;

  @ApiProperty({
    description: 'The status code',
    example: 200,
  })
  @IsNumber()
  @IsNotEmpty()
  statusCode: number;
}
