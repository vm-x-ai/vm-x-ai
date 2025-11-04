import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CapacityEntity } from '../../capacity/capacity.entity';

/**
 * Create a new API key.
 */
export class CreateApiKeyDto {
  @ApiProperty({
    description: 'The name of the API key',
    example: 'My API Key',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'The description of the API key',
    example: 'This is my API key',
  })
  @IsString()
  @IsOptional()
  description?: string | null;

  @ApiProperty({
    description: 'Whether the API key is enabled',
    example: true,
  })
  @IsBoolean()
  @IsNotEmpty()
  enabled: boolean;

  @ApiProperty({
    description: 'The resources that the API key is associated with',
    example: ['resource-1', 'resource-2'],
  })
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  resources: string[];

  @ApiProperty({
    description: 'The labels that the API key is associated with',
    example: ['label-1', 'label-2'],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  labels?: string[] | null;

  @ApiProperty({
    description: 'Whether capacity is enforced for requests to the API key',
    example: false,
  })
  @IsBoolean()
  @IsNotEmpty()
  enforceCapacity: boolean;

  @ApiProperty({
    description: 'The capacities of the API key (JSON array)',
    type: [CapacityEntity],
  })
  @IsArray()
  @Type(() => CapacityEntity)
  @IsOptional()
  capacity?: CapacityEntity[] | null;
}
