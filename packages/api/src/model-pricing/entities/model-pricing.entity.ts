import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export const MODEL_PRICING_SOURCES = ['SYSTEM', 'USER'] as const;
export type ModelPricingSource = (typeof MODEL_PRICING_SOURCES)[number];

export class ModelPricingEntity {
  @ApiProperty({
    description: 'Pricing entry identifier (UUID)',
    format: 'uuid',
  })
  @IsUUID('4')
  @IsNotEmpty()
  pricingId: string;

  @ApiProperty({
    description: 'AI provider identifier',
    example: 'openai',
  })
  @IsString()
  @IsNotEmpty()
  provider: string;

  @ApiProperty({
    description: 'Model name (exact match)',
    example: 'gpt-4o',
  })
  @IsString()
  @IsNotEmpty()
  model: string;

  @ApiProperty({
    description: 'Cost per input/prompt token (USD)',
    example: 0.0000025,
  })
  @IsNumber()
  @Min(0)
  inputCostPerToken: number;

  @ApiProperty({
    description: 'Cost per output/completion token (USD)',
    example: 0.00001,
  })
  @IsNumber()
  @Min(0)
  outputCostPerToken: number;

  @ApiProperty({
    type: 'number',
    description: 'Cost per cached input token (USD)',
    example: 0.00000125,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  cachedInputCostPerToken?: number | null;

  @ApiProperty({
    type: 'number',
    description: 'Cost per reasoning token (USD)',
    example: 0,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  reasoningCostPerToken?: number | null;

  @ApiProperty({
    description:
      "Origin of this row. 'SYSTEM' rows are managed by the pricing sync (refreshed from the canonical JSON on a schedule). 'USER' rows are operator overrides via this API and are never overwritten by the sync.",
    enum: MODEL_PRICING_SOURCES,
    example: 'SYSTEM',
  })
  @IsIn(MODEL_PRICING_SOURCES)
  source: ModelPricingSource;

  @ApiProperty({ format: 'date-time' })
  @IsDateString()
  createdAt: Date;

  @ApiProperty({ format: 'date-time' })
  @IsDateString()
  updatedAt: Date;

  @ApiProperty()
  @IsString()
  createdBy: string;

  @ApiProperty()
  @IsString()
  updatedBy: string;
}
