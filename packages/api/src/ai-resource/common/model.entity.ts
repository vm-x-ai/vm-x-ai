import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class AIResourceModelConfigEntity {
  @ApiProperty({
    description: 'The provider of the AI resource model',
    example: 'openai',
  })
  @IsString()
  @IsNotEmpty()
  provider: string;

  @ApiProperty({
    description: 'The model of the AI resource model',
    example: 'gpt-4o',
  })
  @IsString()
  @IsNotEmpty()
  model: string;

  @ApiPropertyOptional({
    description:
      'The AI connection ID of the AI resource model. Either `connectionId` or `connectionName` must be provided. When both are set, `connectionId` wins. The service stores `connectionId` after resolution — the runtime payload that reaches the dispatcher always carries a resolved UUID.',
    type: 'string',
    example: '123e4567-e89b-12d3-a456-426614174000',
    format: 'uuid',
    nullable: true,
  })
  @IsOptional()
  @IsUUID('4')
  connectionId?: string | null;

  @ApiPropertyOptional({
    description:
      'The AI connection NAME of the AI resource model — convenient when sending `vmx.resourceConfigOverrides` from a caller that does not know connection UUIDs. The gateway resolves it to a UUID against the workspace + environment scope before dispatch. Either `connectionId` or `connectionName` must be provided. When both are set, `connectionId` wins.',
    type: 'string',
    example: 'my-openai-prod',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  connectionName?: string | null;

  @ApiPropertyOptional({
    description:
      'Maximum number of SDK-internal retries the provider client should perform on transient failures (5xx, throttling). Per-model so operators can tune the chattier fallback paths separately. Defaults to `0` (no internal retry — the gateway falls through to the next model immediately).',
    type: 'integer',
    example: 2,
    minimum: 0,
    maximum: 10,
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  maxRetries?: number | null;

  @ApiPropertyOptional({
    description:
      'Per-model timeout in milliseconds. Composes with the request-level `vmx.timeoutMs` — whichever is smaller wins so a tight per-request budget is not silently widened by a generous model setting (and vice-versa). Useful when a fallback model needs a tighter deadline than the primary so it can fail fast.',
    type: 'integer',
    example: 30000,
    minimum: 100,
    maximum: 600000,
    nullable: true,
  })
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(600000)
  timeoutMs?: number | null;
}
