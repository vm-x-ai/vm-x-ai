import { HttpStatus, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import {
  ContentBlock,
  ConverseCommand,
  ConverseCommandInput,
  ConverseCommandOutput,
  ConverseStreamCommand,
  ConverseStreamCommandOutput,
  ConverseStreamOutput,
  ImageFormat,
  InternalServerException,
  Message,
  ModelStreamErrorException,
  ServiceUnavailableException,
  ThrottlingException,
  TokenUsage,
  Tool,
  ValidationException,
} from '@aws-sdk/client-bedrock-runtime';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { CompletionError } from '../../gateway/completion.types';
import {
  CompletionRequestOptions,
  composeAbortSignal,
} from '../ai-provider.types';
import {
  AWSBedrockAIConnectionConfig,
  AWSBedrockBaseProvider,
} from '../aws-bedrock-base';
import { type AnthropicPassthrough } from '../passthrough.helpers';

export type { AWSBedrockAIConnectionConfig } from '../aws-bedrock-base';

/**
 * SystemContentBlock entries we actually produce — `text` for the
 * normal system prompt, `cachePoint` after a cacheable prefix. Other
 * SystemContentBlock variants (guardrail) aren't wired through the
 * gateway yet. Imported types from the SDK use a discriminated union
 * with `?: never` placeholders on inactive members; structurally the
 * blocks below match without needing the verbose union type.
 */
export type ConverseSystemBlock =
  | { text: string }
  | { cachePoint: { type: 'default'; ttl?: '5m' | '1h' } };

/**
 * Canonical empty-object JSON schema used as the default tool input
 * schema for zero-arg tools. Bedrock Converse rejects tool definitions
 * with a missing or null `inputSchema.json` (`ValidationException:
 * inputSchema.json must be present`), and a bare `{}` is also rejected
 * by stricter Claude variants ("invalid schema: must be of type
 * object"). Both Converse sibling cells (Chat Completions, Responses)
 * use this when the caller omits `parameters`.
 */
export const DEFAULT_CONVERSE_TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {},
} as const;

/**
 * Map a MIME type / data-URL header / fetch `Content-Type` / bare
 * subtype token (e.g. `'png'`) onto Bedrock's `ImageFormat` enum.
 * Bedrock requires `ImageBlock.format` to be one of jpeg/png/gif/webp
 * and rejects calls with a missing or unrecognised value. Returns
 * `undefined` for anything else so the caller can raise an explicit
 * 400 instead of emitting a malformed block.
 */
export function inferConverseImageFormat(
  hint: string | undefined
): ImageFormat | undefined {
  if (!hint) return undefined;
  const lower = hint.toLowerCase();
  const subtype = lower.includes('/')
    ? lower.split('/').pop()?.split(';')[0]?.trim()
    : lower.split(';')[0]?.trim();
  if (!subtype) return undefined;
  if (subtype === 'jpg' || subtype === 'jpeg') return ImageFormat.JPEG;
  if (subtype === 'png') return ImageFormat.PNG;
  if (subtype === 'gif') return ImageFormat.GIF;
  if (subtype === 'webp') return ImageFormat.WEBP;
  return undefined;
}

/**
 * Pull observability headers off a Converse response — `latencyMs`
 * and `trace.promptRouter.invokedModelId` (T24). Both go onto the
 * gateway's headers stream so the audit pipeline records them.
 * Returns just `x-request-id` when no trace data is present.
 */
export function extractConverseTraceHeaders(
  response: ConverseCommandOutput | undefined
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (response?.$metadata?.requestId) {
    headers['x-request-id'] = response.$metadata.requestId;
  }
  const latency = response?.metrics?.latencyMs;
  if (typeof latency === 'number') {
    headers['x-bedrock-latency-ms'] = String(latency);
  }
  const invokedModelId = (
    response?.trace as
      | { promptRouter?: { invokedModelId?: string } }
      | undefined
  )?.promptRouter?.invokedModelId;
  if (invokedModelId) {
    headers['x-bedrock-invoked-model-id'] = invokedModelId;
  }
  return headers;
}

/**
 * Convert the gateway's `__vmx_passthrough.anthropic.{cache_breakpoints,
 * system_cache_breakpoints, tool_cache_breakpoints}` envelope into
 * Bedrock Converse-native `cachePoint` content blocks injected in-place
 * into `messages[]`, `system[]`, and `tools[]`.
 *
 * This was the silent breakage the matrix audit caught — `cache_control`
 * markers used to land in `additionalModelRequestFields` (a free-form
 * blob the model ignores), so Bedrock never wrote cache entries even
 * though the gateway thought it did. The fix lives entirely in this
 * helper: emit `cachePoint` blocks at the breakpoint positions the
 * Anthropic ↔ OpenAI converter captured, and let Bedrock's per-block
 * caching machinery do the rest.
 *
 * The function mutates its inputs in place — the Converse SDK accepts
 * `cachePoint` blocks interleaved with other content blocks, so the
 * mutation is the natural shape.
 */
export function injectCachePoints(
  messages: Message[],
  system: ConverseSystemBlock[] | undefined,
  tools: Tool[] | undefined,
  passthrough: AnthropicPassthrough | undefined
): void {
  if (!passthrough) return;

  // System breakpoints — insert cachePoint AFTER the marked block.
  // Iterate descending so insertions don't shift later indices.
  if (system && passthrough.system_cache_breakpoints?.length) {
    const sortedSystem = [...passthrough.system_cache_breakpoints].sort(
      (a, b) => b.index - a.index
    );
    for (const bp of sortedSystem) {
      if (bp.index < 0 || bp.index >= system.length) continue;
      system.splice(bp.index + 1, 0, {
        cachePoint: {
          type: 'default',
          ...(bp.cache_control.ttl ? { ttl: bp.cache_control.ttl } : {}),
        },
      });
    }
  }

  // Tool breakpoints — same pattern.
  if (tools && passthrough.tool_cache_breakpoints?.length) {
    const sortedTools = [...passthrough.tool_cache_breakpoints].sort(
      (a, b) => b.index - a.index
    );
    for (const bp of sortedTools) {
      if (bp.index < 0 || bp.index >= tools.length) continue;
      tools.splice(bp.index + 1, 0, {
        cachePoint: {
          type: 'default',
          ...(bp.cache_control.ttl ? { ttl: bp.cache_control.ttl } : {}),
        },
      } as Tool);
    }
  }

  // Per-message breakpoints — collapse to a single trailing cachePoint
  // on each Converse message that any marked block landed in.
  if (passthrough.cache_breakpoints?.length) {
    const messageIndexesWithBreakpoint = new Map<
      number,
      '5m' | '1h' | undefined
    >();
    for (const bp of passthrough.cache_breakpoints) {
      const m = /^messages\[(\d+)\]/.exec(bp.path);
      if (!m) continue;
      const idx = Number(m[1]);
      // Last write wins on ttl when a single message has multiple
      // breakpoint markers — Bedrock only takes one cachePoint per
      // message anyway.
      messageIndexesWithBreakpoint.set(idx, bp.cache_control.ttl);
    }
    for (const [idx, ttl] of messageIndexesWithBreakpoint) {
      if (idx < 0 || idx >= messages.length) continue;
      const msg = messages[idx];
      if (!msg.content) continue;
      msg.content.push({
        cachePoint: {
          type: 'default',
          ...(ttl ? { ttl } : {}),
        },
      } as ContentBlock);
    }
  }
}

/**
 * Shared Bedrock Converse dispatcher. Owns the raw AWS Converse SDK
 * call (`dispatchConverseRaw`), the stream-iterator wrapper that maps
 * mid-stream AWS exceptions onto `CompletionError`, and the
 * format-agnostic usage / error mappers. The three format-specific
 * sibling files (`openai-chat-completion.provider.ts`,
 * `openai-response.provider.ts`, `anthropic-messages.provider.ts`)
 * inject this dispatcher and call `dispatchConverseRaw(input, …)` with
 * a fully-built `ConverseCommandInput`; they own the per-format
 * request shaping + response unwinding.
 */
@Injectable()
export class AWSBedrockConverseDispatcher extends AWSBedrockBaseProvider {
  constructor(logger: PinoLogger, configService: ConfigService) {
    super(logger, configService);
  }

  /**
   * Send a fully-built `ConverseCommandInput` to Bedrock and return
   * the native AWS SDK response (or a raw-stream-events iterable for
   * streaming) verbatim.
   *
   * Mid-stream AWS exceptions (`internalServerException`,
   * `validationException`, etc.) are thrown as `CompletionError`s with
   * `providerRequestPayload` attached — the audit-row invariant
   * (`Phase 11`) holds across all three direct paths.
   */
  async dispatchConverseRaw(
    input: ConverseCommandInput,
    streaming: boolean,
    connection: AIConnectionEntity<AWSBedrockAIConnectionConfig>,
    options?: CompletionRequestOptions
  ): Promise<{
    data: ConverseCommandOutput | AsyncIterable<ConverseStreamOutput>;
    headers: { 'x-request-id'?: string };
    providerRequestPayload: ConverseCommandInput;
  }> {
    const client = await this.createClient(connection);
    this.logger.info({ requestBody: input }, 'Bedrock Converse request body');
    try {
      if (streaming) {
        const stream = await client.send(new ConverseStreamCommand(input), {
          abortSignal: composeAbortSignal(options),
        });
        if (!stream.stream) {
          throw new CompletionError({
            message: 'Failed to start the Bedrock Converse stream',
            rate: false,
            retryable: false,
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            failureReason: 'Failed to start the stream',
            openAICompatibleError: {
              code: 'aws_bedrock_failed_to_start_stream',
            },
            providerRequestPayload: input,
          });
        }
        return {
          data: this.iterateConverseStream(stream, input),
          headers: { 'x-request-id': stream.$metadata.requestId },
          providerRequestPayload: input,
        };
      }
      const response = await client.send(new ConverseCommand(input), {
        abortSignal: composeAbortSignal(options),
      });
      return {
        data: response,
        headers: extractConverseTraceHeaders(response),
        providerRequestPayload: input,
      };
    } catch (error) {
      if (error instanceof CompletionError) {
        if (error.data.providerRequestPayload === undefined) {
          error.data.providerRequestPayload = input;
        }
        throw error;
      }
      this.handleError(error, input);
    }
  }

  /**
   * Wrap `ConverseStreamCommandOutput.stream` in an async generator
   * that surfaces mid-stream AWS exceptions as `CompletionError`s
   * with `providerRequestPayload` attached. The format-specific
   * Converse-stream-to-X converter consumes the yielded
   * `ConverseStreamOutput` items.
   */
  private async *iterateConverseStream(
    output: ConverseStreamCommandOutput,
    requestBody: ConverseCommandInput
  ): AsyncIterable<ConverseStreamOutput> {
    if (!output.stream) return;
    for await (const item of output.stream) {
      if (
        item.internalServerException ||
        item.serviceUnavailableException ||
        item.modelStreamErrorException ||
        item.validationException ||
        item.throttlingException
      ) {
        this.handleError(
          item.internalServerException ??
            item.serviceUnavailableException ??
            item.modelStreamErrorException ??
            item.validationException ??
            item.throttlingException,
          requestBody
        );
      }
      yield item;
    }
  }

  /**
   * Public per-format helper exposing the same usage normalisation
   * every Converse path needs — `cache_read`/`cache_write` token
   * fields land under `prompt_tokens_details` so CompletionService's
   * cost reader and audit row pick them up uniformly.
   */
  normaliseUsage(usage: TokenUsage | undefined) {
    return this.convertUsage(usage);
  }

  private convertUsage(usage?: TokenUsage) {
    if (!usage) {
      return undefined;
    }
    const promptTokensDetails: Record<string, unknown> = {
      cached_tokens: usage.cacheReadInputTokens ?? 0,
    };
    if (usage.cacheWriteInputTokens != null) {
      promptTokensDetails.cache_creation_input_tokens =
        usage.cacheWriteInputTokens;
    }
    return {
      completion_tokens: usage.outputTokens ?? 0,
      prompt_tokens: usage.inputTokens ?? 0,
      total_tokens: usage.totalTokens ?? 0,
      prompt_tokens_details: promptTokensDetails,
    };
  }

  /**
   * Map an AWS SDK exception (or anything error-shaped) into a
   * `CompletionError` with the right HTTP status, retryability, and
   * `providerRequestPayload` attached for the audit row.
   */
  handleError(
    error:
      | InternalServerException
      | ServiceUnavailableException
      | ModelStreamErrorException
      | ValidationException
      | ThrottlingException
      | Error
      | unknown,
    providerRequestPayload?: unknown
  ): never {
    if (error instanceof InternalServerException) {
      const retryable = error.$retryable?.throttling ?? false;
      throw new CompletionError({
        message: `AWS Bedrock API returned an internal server error: ${error.message}`,
        rate: retryable,
        retryable: retryable,
        headers: {
          'x-request-id': error.$metadata.requestId,
        },
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        failureReason: 'Internal server error',
        openAICompatibleError: {
          code: 'aws_bedrock_internal_server_error',
          type: 'internal_server_error',
        },
        providerRequestPayload,
      });
    } else if (error instanceof ServiceUnavailableException) {
      const retryable = error.$retryable?.throttling ?? false;
      throw new CompletionError({
        message: `AWS Bedrock API returned a service unavailable error: ${error.message}`,
        rate: retryable,
        retryable: retryable,
        headers: {
          'x-request-id': error.$metadata.requestId,
        },
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        failureReason: 'Service unavailable',
        openAICompatibleError: {
          code: 'aws_bedrock_service_unavailable_error',
          type: 'service_unavailable',
        },
        providerRequestPayload,
      });
    } else if (error instanceof ModelStreamErrorException) {
      const retryable = error.$retryable?.throttling ?? false;
      throw new CompletionError({
        message: `AWS Bedrock API returned a model stream error: ${error.message}`,
        rate: retryable,
        retryable: retryable,
        headers: {
          'x-request-id': error.$metadata.requestId,
        },
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        failureReason: 'Model stream error',
        openAICompatibleError: {
          code: 'aws_bedrock_model_stream_error',
          type: 'model_stream_error',
        },
        providerRequestPayload,
      });
    } else if (error instanceof ValidationException) {
      const retryable = error.$retryable?.throttling ?? false;
      throw new CompletionError({
        message: `AWS Bedrock API returned a validation error: ${error.message}`,
        rate: retryable,
        retryable: retryable,
        headers: {
          'x-request-id': error.$metadata.requestId,
        },
        statusCode: HttpStatus.BAD_REQUEST,
        failureReason: 'Validation error',
        openAICompatibleError: {
          code: 'aws_bedrock_validation_error',
          type: 'validation_error',
        },
        providerRequestPayload,
      });
    } else if (error instanceof ThrottlingException) {
      throw new CompletionError({
        message: `AWS Bedrock API returned a throttling error: ${error.message}`,
        rate: true,
        retryable: true,
        headers: {
          'x-request-id': error.$metadata.requestId,
        },
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        failureReason: 'Throttling error',
        openAICompatibleError: {
          code: 'aws_bedrock_throttling_error',
          type: 'throttling_error',
        },
        providerRequestPayload,
      });
    } else if (error instanceof Error) {
      throw new CompletionError(
        {
          rate: false,
          message: (error as Error).message,
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          retryable: false,
          failureReason: 'External API error',
          openAICompatibleError: {
            code: 'unknown_error',
          },
          providerRequestPayload,
        },
        error
      );
    }

    throw new CompletionError({
      message: 'Unknown error',
      rate: false,
      retryable: false,
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      failureReason: 'Unknown error',
      openAICompatibleError: {
        code: 'unknown_error',
      },
      providerRequestPayload,
    });
  }
}
