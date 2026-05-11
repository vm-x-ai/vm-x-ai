import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

/**
 * Light DTO for the Anthropic-compatible `/anthropic/messages` route.
 *
 * The endpoint is a passthrough — the converter walks the body and
 * builds an OpenAI-shaped request — so we only validate the fields VM-X
 * relies on at the boundary (`model`, `messages`, `max_tokens`). The
 * converter itself does the deeper structural mapping; if a tool
 * block is malformed, OpenAI's downstream provider returns the 400
 * (which we propagate via the existing CompletionError handler).
 *
 * Why a DTO at all (not the bare `AnthropicMessagesRequest` type):
 * Nest's global `ValidationPipe` runs on classes with class-validator
 * decorators. Without one, any JSON body — including missing `model`
 * or non-array `messages` — would slip through to the converter and
 * surface as a runtime error from `req.messages.map(...)` rather than
 * a clean 400 with field-level error context.
 *
 * For the wider, content-block-level fields (`cache_control` markers
 * inside content, `thinking` blocks in assistant turns, server tool
 * definitions, etc.) we deliberately keep the DTO loose — the
 * `@anthropic-ai/sdk` types are the source of truth and the converter
 * narrows on `block.type` discriminants. Re-implementing the SDK's
 * full validation here would just add drift.
 */
export class AnthropicMessagesRequestDto {
  @IsString()
  model: string;

  @IsInt()
  @Min(1)
  max_tokens: number;

  @IsArray()
  @ArrayNotEmpty()
  messages: unknown[];

  @IsOptional()
  system?: unknown;

  @IsOptional()
  @IsArray()
  tools?: unknown[];

  @IsOptional()
  tool_choice?: unknown;

  @IsOptional()
  @IsNumber()
  temperature?: number;

  @IsOptional()
  @IsNumber()
  top_p?: number;

  @IsOptional()
  @IsNumber()
  top_k?: number;

  @IsOptional()
  @IsArray()
  stop_sequences?: string[];

  @IsOptional()
  stream?: boolean;

  @IsOptional()
  metadata?: { user_id?: string; user_metadata?: Record<string, unknown> };

  /**
   * Top-level cache breakpoint for the request envelope. Forwarded
   * to native passthrough providers; OpenAI-only providers ignore it.
   * Validated only as "object" — the converter narrows on `type`.
   */
  @IsOptional()
  cache_control?: unknown;

  /**
   * Extended thinking config — `{type:"enabled", budget_tokens}`,
   * `{type:"adaptive", display?}`, or `{type:"disabled"}`. Bedrock-Invoke
   * and the native Anthropic provider preserve this verbatim; OpenAI-Chat-
   * only providers drop it (logged warning).
   */
  @IsOptional()
  thinking?: unknown;

  /**
   * Service tier — `auto` (default) or `standard_only`. Affects latency
   * and pricing tier on Anthropic-side providers.
   */
  @IsOptional()
  @IsIn(['auto', 'standard_only'])
  service_tier?: 'auto' | 'standard_only';

  /**
   * Container config (beta). When set, indicates the conversation
   * is bound to a specific container ID for stateful tools (code
   * execution, etc.). Preserved through native passthrough.
   */
  @IsOptional()
  container?: unknown;
}
