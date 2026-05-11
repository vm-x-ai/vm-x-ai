import type {
  ChatCompletion,
  ChatCompletionChunk,
} from 'openai/resources/index.js';
import type {
  Response as OpenAIResponse,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses.js';
import type {
  Message as AnthropicMessage,
  RawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages';
import type { CompletionUsage } from 'openai/resources/completions.js';

/**
 * Runtime detection for non-streaming response payloads. The orchestrator
 * (`CompletionService`) needs to tell apart what each format-specific
 * provider method returns so it can:
 *
 *  - skip the `mapCompletionResponseToFormat` back-conversion when the
 *    data is already in the requested format (the dispatch helpers and
 *    native passthrough paths return native shape);
 *  - extract usage tokens via the right field names (`prompt_tokens`
 *    on ChatCompletion vs `input_tokens` on Response/Anthropic);
 *  - audit/serialise the wire body without lying about its shape.
 *
 * Pure structural detection — checks exclusive top-level keys present
 * on each shape's SDK type (`choices` for ChatCompletion, `output` +
 * `object: 'response'` for Responses, `content` array of blocks +
 * `role: 'assistant'` for Anthropic).
 *
 * Intentionally narrow: returns `'unknown'` when the payload doesn't
 * match any known shape. Callers that want best-effort
 * back-compat should default to ChatCompletion processing on
 * `'unknown'` (that was the orchestrator's only branch before this
 * helper landed).
 */
export type ResponseShape =
  | 'openai-chat-completion'
  | 'openai-response'
  | 'anthropic-message'
  | 'unknown';

export function detectResponseShape(data: unknown): ResponseShape {
  if (data == null || typeof data !== 'object') return 'unknown';
  const obj = data as Record<string, unknown>;

  // OpenAI Responses: object: 'response' is unique to the Responses API.
  if (obj.object === 'response' && Array.isArray(obj.output)) {
    return 'openai-response';
  }

  // Anthropic Messages: object 'message' has `content` (array of
  // blocks), `role: 'assistant'`, and `stop_reason`. ChatCompletion
  // also uses `role`, but on `choices[N].message.role` not at top
  // level.
  if (
    obj.type === 'message' &&
    Array.isArray(obj.content) &&
    obj.role === 'assistant'
  ) {
    return 'anthropic-message';
  }

  // OpenAI Chat Completion: `choices` array is unique to it among
  // the three response shapes the gateway routes today.
  if (Array.isArray(obj.choices)) {
    return 'openai-chat-completion';
  }

  return 'unknown';
}

/**
 * Extract usage in normalised OpenAI `CompletionUsage` shape from any
 * of the three supported response payloads. Per D10 in `task.md`, the
 * cost service consumes the OpenAI usage shape — per-format extractors
 * normalise to it without losing the extension fields downstream code
 * reads (`prompt_tokens_details.cached_tokens`,
 * `completion_tokens_details.reasoning_tokens`, `cache_creation`,
 * `server_tool_use`).
 *
 * Returns `undefined` when the payload doesn't carry usage (mid-stream
 * shape, error, etc.) — the orchestrator's audit/cost paths already
 * tolerate `undefined`.
 */
export function extractUsageFromResponse(
  data: unknown
): CompletionUsage | undefined {
  if (data == null || typeof data !== 'object') return undefined;
  const shape = detectResponseShape(data);

  if (shape === 'openai-chat-completion') {
    const cc = data as ChatCompletion;
    return cc.usage;
  }

  if (shape === 'openai-response') {
    const resp = data as OpenAIResponse;
    if (!resp.usage) return undefined;
    const u = resp.usage as OpenAIResponse['usage'] & {
      input_tokens_details?: {
        cached_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_creation?: Record<string, number>;
      };
      output_tokens_details?: { reasoning_tokens?: number };
    };
    return {
      prompt_tokens: u.input_tokens,
      completion_tokens: u.output_tokens,
      total_tokens: u.total_tokens,
      ...(u.input_tokens_details
        ? {
            prompt_tokens_details: {
              cached_tokens: u.input_tokens_details.cached_tokens ?? 0,
              ...(u.input_tokens_details.cache_creation_input_tokens != null
                ? {
                    cache_creation_input_tokens:
                      u.input_tokens_details.cache_creation_input_tokens,
                  }
                : {}),
              ...(u.input_tokens_details.cache_creation
                ? { cache_creation: u.input_tokens_details.cache_creation }
                : {}),
            } as CompletionUsage['prompt_tokens_details'],
          }
        : {}),
      ...(u.output_tokens_details
        ? {
            completion_tokens_details: {
              reasoning_tokens: u.output_tokens_details.reasoning_tokens ?? 0,
            } as CompletionUsage['completion_tokens_details'],
          }
        : {}),
    } as CompletionUsage;
  }

  if (shape === 'anthropic-message') {
    const msg = data as AnthropicMessage;
    if (!msg.usage) return undefined;
    const u = msg.usage;
    const cacheCreation = (
      u as {
        cache_creation?: {
          ephemeral_5m_input_tokens?: number;
          ephemeral_1h_input_tokens?: number;
        };
      }
    ).cache_creation;
    return {
      prompt_tokens: u.input_tokens,
      completion_tokens: u.output_tokens,
      total_tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
      prompt_tokens_details: {
        cached_tokens: u.cache_read_input_tokens ?? 0,
        ...(u.cache_creation_input_tokens != null
          ? { cache_creation_input_tokens: u.cache_creation_input_tokens }
          : {}),
        ...(cacheCreation ? { cache_creation: cacheCreation } : {}),
      } as CompletionUsage['prompt_tokens_details'],
      ...(u.server_tool_use
        ? {
            // Server-tool usage surfaces on the audit row; it's an
            // Anthropic-specific extension passed straight through on
            // the OpenAI-shape usage object so downstream code that
            // reads `usage.server_tool_use` (e.g. `postCompletion`)
            // sees it without further mapping.
            server_tool_use: u.server_tool_use,
          }
        : {}),
    } as CompletionUsage & {
      server_tool_use?: AnthropicMessage['usage']['server_tool_use'];
    };
  }

  return undefined;
}

/**
 * Extract a stable message id from any of the three response shapes.
 * Audit + metrics expect a single id field; native Response and
 * Anthropic Message both expose `id` at top level, same as
 * ChatCompletion, so this collapses to a single read with the shape
 * detection serving as documentation rather than a runtime branch.
 */
export function extractMessageId(data: unknown): string | null {
  if (data == null || typeof data !== 'object') return null;
  const obj = data as { id?: unknown };
  return typeof obj.id === 'string' ? obj.id : null;
}

// ─── Streaming-shape detection ─────────────────────────────────────

export type StreamChunkShape =
  | 'openai-chat-completion-chunk'
  | 'openai-response-event'
  | 'anthropic-stream-event'
  | 'unknown';

/**
 * Detect the shape of a single streaming chunk. Unique-key based:
 *
 *  - `choices` array → OpenAI Chat Completion chunk
 *  - `type` starts with `response.` → OpenAI Responses event
 *  - `type` is one of the Anthropic SSE event names → Anthropic event
 */
export function detectStreamChunkShape(chunk: unknown): StreamChunkShape {
  if (chunk == null || typeof chunk !== 'object') return 'unknown';
  const obj = chunk as { choices?: unknown; type?: unknown };
  if (Array.isArray(obj.choices)) return 'openai-chat-completion-chunk';
  if (typeof obj.type === 'string') {
    if (obj.type.startsWith('response.')) return 'openai-response-event';
    if (
      obj.type === 'message_start' ||
      obj.type === 'message_delta' ||
      obj.type === 'message_stop' ||
      obj.type === 'content_block_start' ||
      obj.type === 'content_block_delta' ||
      obj.type === 'content_block_stop' ||
      obj.type === 'ping' ||
      obj.type === 'error'
    ) {
      return 'anthropic-stream-event';
    }
  }
  return 'unknown';
}

// ─── Streaming usage accumulator ───────────────────────────────────

/**
 * Stateful per-stream usage accumulator. Each format reports usage
 * differently:
 *
 *  - OpenAI Chat Completion: a single `chunk.usage` near the end
 *    (when `stream_options.include_usage` is set).
 *  - OpenAI Responses: `response.completed` event carries final
 *    `event.response.usage`.
 *  - Anthropic Messages: `message_start` carries input_tokens; each
 *    `message_delta` carries cumulative `output_tokens` (last-wins).
 *
 * Call `update(chunk)` on every chunk; call `snapshot()` after the
 * stream completes to get the normalised OpenAI `CompletionUsage`
 * shape the orchestrator's audit / cost paths consume.
 */
export class StreamUsageAccumulator {
  private inputTokens = 0;
  private outputTokens = 0;
  private cachedTokens = 0;
  private cacheCreationTokens: number | null = null;
  private reasoningTokens = 0;
  private finalised = false;
  private legacy: CompletionUsage | undefined;

  update(chunk: unknown): void {
    if (this.finalised) return;
    const shape = detectStreamChunkShape(chunk);
    if (shape === 'openai-chat-completion-chunk') {
      const c = chunk as ChatCompletionChunk;
      if (c.usage) {
        this.legacy = c.usage;
        this.finalised = true;
      }
      return;
    }
    if (shape === 'openai-response-event') {
      const ev = chunk as ResponseStreamEvent;
      if ((ev as { type?: string }).type === 'response.completed') {
        const r = (ev as { response?: { usage?: unknown } }).response;
        if (r?.usage) {
          this.legacy = extractUsageFromResponse(
            // Reuse the non-streaming extractor on the final response
            // shape — the response object on `response.completed` has
            // the full `output[]` and `usage` payload.
            { object: 'response', output: [], usage: r.usage } as never
          );
          this.finalised = true;
        }
      }
      return;
    }
    if (shape === 'anthropic-stream-event') {
      const ev = chunk as RawMessageStreamEvent;
      if (ev.type === 'message_start') {
        const u = (
          ev.message as {
            usage?: {
              input_tokens?: number;
              cache_read_input_tokens?: number;
              cache_creation_input_tokens?: number;
            };
          }
        ).usage;
        if (u) {
          this.inputTokens = u.input_tokens ?? this.inputTokens;
          this.cachedTokens = u.cache_read_input_tokens ?? this.cachedTokens;
          this.cacheCreationTokens =
            u.cache_creation_input_tokens ?? this.cacheCreationTokens;
        }
        return;
      }
      if (ev.type === 'message_delta') {
        const u = (
          ev as {
            usage?: {
              input_tokens?: number;
              output_tokens?: number;
              cache_read_input_tokens?: number;
              cache_creation_input_tokens?: number;
            };
          }
        ).usage;
        if (u) {
          // Anthropic emits cumulative-last-wins. `output_tokens` is
          // the running total; `input_tokens` may also appear (rarer).
          if (typeof u.input_tokens === 'number')
            this.inputTokens = u.input_tokens;
          if (typeof u.output_tokens === 'number')
            this.outputTokens = u.output_tokens;
          if (typeof u.cache_read_input_tokens === 'number')
            this.cachedTokens = u.cache_read_input_tokens;
          if (typeof u.cache_creation_input_tokens === 'number')
            this.cacheCreationTokens = u.cache_creation_input_tokens;
        }
        return;
      }
      if (ev.type === 'message_stop') {
        // Lock in the accumulated counts.
        this.legacy = {
          prompt_tokens: this.inputTokens,
          completion_tokens: this.outputTokens,
          total_tokens: this.inputTokens + this.outputTokens,
          prompt_tokens_details: {
            cached_tokens: this.cachedTokens,
            ...(this.cacheCreationTokens != null
              ? { cache_creation_input_tokens: this.cacheCreationTokens }
              : {}),
          } as CompletionUsage['prompt_tokens_details'],
          ...(this.reasoningTokens > 0
            ? {
                completion_tokens_details: {
                  reasoning_tokens: this.reasoningTokens,
                } as CompletionUsage['completion_tokens_details'],
              }
            : {}),
        } as CompletionUsage;
        this.finalised = true;
        return;
      }
    }
  }

  snapshot(): CompletionUsage | undefined {
    return this.legacy;
  }
}
