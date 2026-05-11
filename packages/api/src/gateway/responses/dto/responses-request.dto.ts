import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type {
  ResponseCreateParams,
  ResponseInputItem,
  Tool,
  ResponseTextConfig,
} from 'openai/resources/responses/responses';
import { ExtraCompletionRequestDto } from '../../dto/completion-request.dto';

/**
 * VM-X Responses API request payload.
 *
 * Targets the Responses API subset our customer (and most LiteLLM users)
 * exercise: text + tool_calls + reasoning. The structural validation is
 * intentionally loose — `input`, `tools`, `text`, `reasoning` are passed
 * to the converter which will reject unsupported shapes there. This avoids
 * re-implementing OpenAI's giant union as nested Nest validators.
 */
export class ResponsesRequestDto {
  @ApiProperty({
    description:
      'Model name. Use the AI Resource name, "default", or "<connection_name>/<model_name>".',
    example: 'default',
  })
  @IsString()
  model: string;

  @ApiProperty({
    description:
      'Input — either a string (treated as a single user turn) or an array of Responses-API input items (messages, function_calls, function_call_outputs, reasoning).',
    oneOf: [
      { type: 'string' },
      { type: 'array', items: { type: 'object', additionalProperties: true } },
    ],
  })
  input: string | ResponseInputItem[];

  @ApiProperty({
    description:
      'System / developer instructions. Prepended to the message list.',
    required: false,
    nullable: true,
    type: 'string',
  })
  @IsOptional()
  @IsString()
  instructions?: string | null;

  @ApiProperty({
    description: 'Sampling temperature (0..2)',
    required: false,
    nullable: true,
    type: 'number',
  })
  @IsOptional()
  @IsNumber()
  temperature?: number | null;

  @ApiProperty({
    description: 'Top-p nucleus sampling',
    required: false,
    nullable: true,
    type: 'number',
  })
  @IsOptional()
  @IsNumber()
  top_p?: number | null;

  @ApiProperty({
    description: 'Maximum number of output tokens',
    required: false,
    nullable: true,
    type: 'number',
  })
  @IsOptional()
  @IsNumber()
  max_output_tokens?: number | null;

  @ApiProperty({
    description: 'Stop sequences',
    required: false,
    nullable: true,
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
  })
  @IsOptional()
  stop?: string | string[] | null;

  @ApiProperty({
    description:
      'Response text/format config. Use {format: {type:"json_schema", name, schema}} or {format:{type:"json_object"}}.',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsObject()
  text?: ResponseTextConfig | null;

  @ApiProperty({
    description:
      'Reasoning config: {effort: "low"|"medium"|"high", summary?: "auto"|"concise"|"detailed"}.',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsObject()
  reasoning?: ResponseCreateParams['reasoning'];

  @ApiProperty({
    description: 'Tools (function tools only currently supported).',
    required: false,
    nullable: true,
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  @IsOptional()
  @IsArray()
  tools?: Tool[] | null;

  @ApiProperty({
    description: 'Tool choice control',
    required: false,
    nullable: true,
  })
  @IsOptional()
  tool_choice?: ResponseCreateParams['tool_choice'];

  @ApiProperty({
    description: 'Stream the response as Server-Sent Events',
    required: false,
    nullable: true,
    type: 'boolean',
  })
  @IsOptional()
  @IsBoolean()
  stream?: boolean | null;

  @ApiProperty({
    description: 'Request timeout (ms)',
    required: false,
    nullable: true,
    type: 'number',
  })
  @IsOptional()
  @IsNumber()
  timeout?: number | null;

  @ApiProperty({
    description: 'Whether OpenAI should store the response. Ignored by VM-X.',
    required: false,
    nullable: true,
    type: 'boolean',
  })
  @IsOptional()
  @IsBoolean()
  store?: boolean | null;

  @ApiProperty({
    description:
      'ID of a previous response to continue from (Responses API conversational state). Forwarded as a passthrough hint to providers that support it.',
    required: false,
    nullable: true,
    type: 'string',
  })
  @IsOptional()
  @IsString()
  previous_response_id?: string | null;

  @ApiProperty({
    description:
      'Free-form metadata key/value pairs. Forwarded to providers and included on the audit row.',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, string> | null;

  @ApiProperty({
    description: 'Allow parallel tool invocations. Defaults to true.',
    required: false,
    nullable: true,
    type: 'boolean',
  })
  @IsOptional()
  @IsBoolean()
  parallel_tool_calls?: boolean | null;

  @ApiProperty({
    description:
      'Cache key — drives the Responses API prompt cache. Forwarded to providers that honour it.',
    required: false,
    nullable: true,
    type: 'string',
  })
  @IsOptional()
  @IsString()
  prompt_cache_key?: string | null;

  @ApiProperty({
    description: 'Conversation truncation strategy. Defaults to "disabled".',
    required: false,
    nullable: true,
    type: 'string',
  })
  @IsOptional()
  @IsString()
  truncation?: 'auto' | 'disabled' | null;

  @ApiProperty({
    description:
      'Service tier — `auto`, `default`, `flex`, `priority`, or `scale`. Forwarded to providers.',
    required: false,
    nullable: true,
    type: 'string',
  })
  @IsOptional()
  @IsString()
  service_tier?: string | null;

  @ApiProperty({
    description: 'VM-X-specific options (correlationId, metadata, overrides).',
    type: ExtraCompletionRequestDto,
    required: false,
    nullable: true,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ExtraCompletionRequestDto)
  vmx?: ExtraCompletionRequestDto | null;
}

export type ResponsesNonStreamingRequestDto = ResponsesRequestDto & {
  stream?: false | null;
};

export type ResponsesStreamingRequestDto = ResponsesRequestDto & {
  stream: true;
};
