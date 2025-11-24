import { ApiProperty, getSchemaPath } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import { $enum } from 'ts-enum-util';

export enum CapacityPeriod {
  MINUTE = 'minute',
  HOUR = 'hour',
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
  LIFETIME = 'lifetime',
}

export const capacityPeriod = $enum(CapacityPeriod).getValues();

export enum CapacityDimension {
  SOURCE_IP = 'source-ip',
}

export const capacityDimension = $enum(CapacityDimension).getValues();

export class CapacityEntity {
  @ApiProperty({
    description: 'The period of the capacity',
    enumName: 'CapacityPeriod',
    enum: capacityPeriod,
    example: CapacityPeriod.MINUTE,
  })
  @IsEnum(CapacityPeriod)
  @IsNotEmpty()
  period: CapacityPeriod;

  @ApiProperty({
    required: false,
    type: 'number',
    nullable: true,
    description: 'The number of requests allowed per period',
    example: 100,
  })
  @IsNumber()
  @IsOptional()
  requests?: number | null;

  @ApiProperty({
    required: false,
    type: 'number',
    nullable: true,
    description: 'The number of tokens allowed per period',
    example: 100000,
  })
  @IsNumber()
  @IsOptional()
  tokens?: number | null;

  @ApiProperty({
    required: false,
    type: 'boolean',
    nullable: true,
    description: 'Whether the capacity is enabled',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  enabled?: boolean | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'The dimension of the capacity',
    enumName: 'CapacityDimension',
    enum: capacityDimension,
    example: CapacityDimension.SOURCE_IP,
  })
  @IsEnum(CapacityDimension)
  @IsOptional()
  dimension?: CapacityDimension | null;
}

export class DiscoveredCapacityEntry {
  @ApiProperty({
    description: 'The date and time the discovered capacity was last updated',
    example: '2021-01-01T00:00:00.000Z',
  })
  @IsDateString()
  @IsNotEmpty()
  updatedAt: string;

  @ApiProperty({
    description: 'The capacities of the discovered capacity (JSON array)',
    type: [CapacityEntity],
  })
  @IsArray()
  @IsNotEmpty()
  @Type(() => CapacityEntity)
  capacity: CapacityEntity[];

  @ApiProperty({
    type: 'string',
    nullable: true,
    required: false,
    description: 'The error message of the discovered capacity',
    example: 'Error discovering capacity',
  })
  @IsString()
  @IsOptional()
  errorMessage?: string | null;
}

export class DiscoveredCapacityEntity {
  @ApiProperty({
    description: 'The models of the discovered capacity (JSON object)',
    type: 'object',
    additionalProperties: {
      $ref: getSchemaPath(DiscoveredCapacityEntry),
    },
    example: {
      'gpt-4o': {
        updatedAt: '2021-01-01T00:00:00.000Z',
        capacity: [
          {
            period: CapacityPeriod.MINUTE,
            requests: 100,
            tokens: 100000,
            enabled: true,
            dimension: CapacityDimension.SOURCE_IP,
          },
        ],
        errorMessage: 'Error discovering capacity',
      },
    },
  })
  @IsObject()
  @IsNotEmpty()
  models: Record<string, DiscoveredCapacityEntry>;
}
