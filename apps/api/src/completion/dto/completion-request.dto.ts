import { ApiProperty, OmitType } from '@nestjs/swagger';
import {
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import {
  ChatCompletionCreateParams,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from 'openai/resources/index.js';
import { CreateAIResourceDto } from '../../ai-resource/dto/create-ai-resource.dto';
import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import { AIResourceModelRoutingEntity } from '../../ai-resource/common/routing.entity';

export class PartialAIResourceDto extends OmitType(
  PartialType(CreateAIResourceDto),
  ['model', 'fallbackModels', 'secondaryModels', 'routing', 'capacity']
) {
  @IsOptional()
  @ValidateNested()
  @Type(() => PartialType(AIResourceModelConfigEntity))
  model?: Partial<AIResourceModelConfigEntity>;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => PartialType(AIResourceModelConfigEntity))
  fallbackModels?: Partial<AIResourceModelConfigEntity>[];

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => PartialType(AIResourceModelConfigEntity))
  secondaryModels?: Partial<AIResourceModelConfigEntity>[];

  @IsOptional()
  @ValidateNested()
  @Type(() => PartialType(AIResourceModelRoutingEntity))
  routing?: Partial<AIResourceModelRoutingEntity>;
}

export class ExtraCompletionRequestDto {
  @ApiProperty({
    description: 'The correlation ID for tracing requests',
    example: 'corr-abc-123',
  })
  @IsString()
  @IsOptional()
  correlationId?: string | null;

  @ApiProperty({
    description: 'The index of the secondary model to use',
    example: 0,
  })
  @IsNumber()
  @IsOptional()
  secondaryModelIndex?: number | null;

  @ApiProperty({
    description: 'The resource config overrides',
    example: {
      model: {
        provider: 'openai',
        model: 'gpt-4o',
        connectionId: 'conn-abc-123',
      },
    },
  })
  @ValidateNested()
  @Type(() => PartialAIResourceDto)
  resourceConfigOverrides?: PartialAIResourceDto | null;
}

export class CompletionRequestPayloadDto {
  @ApiProperty({
    description: 'The extra request data',
    type: ExtraCompletionRequestDto,
  })
  @ValidateNested()
  @Type(() => ExtraCompletionRequestDto)
  @IsOptional()
  vmx?: ExtraCompletionRequestDto | null;
}

export type CompletionRequestDto = ChatCompletionCreateParams &
  CompletionRequestPayloadDto;

export type CompletionNonStreamingRequestDto =
  ChatCompletionCreateParamsNonStreaming & CompletionRequestPayloadDto;

export type CompletionStreamingRequestDto =
  ChatCompletionCreateParamsStreaming & CompletionRequestPayloadDto;
