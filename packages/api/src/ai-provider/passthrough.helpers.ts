import type { ChatCompletionCreateParams } from 'openai/resources/index.js';
import type {
  AnthropicMessagesRequest,
  AnthropicToolChoice,
} from '../gateway/anthropic/anthropic.types';

/**
 * Provider-side helper for the `__vmx_passthrough` envelope set by the
 * Anthropic ↔ OpenAI converter (and, in future, by other format
 * converters). The envelope carries gateway-pivot-incompatible fields
 * — `cache_control` markers, extended `thinking`, `top_k`, server tools,
 * `service_tier`, `container`, `metadata` — so providers that *can*
 * speak them natively can re-attach when re-serialising to the wire.
 *
 * Usage pattern:
 *
 *   const { body, anthropic } = takePassthroughEnvelope(request);
 *   // `body` is the clean OpenAI body — safe to send to a strict
 *   // upstream that rejects unknown fields.
 *   // `anthropic` is the captured Anthropic-only fields, or undefined
 *   // if the converter didn't attach any.
 *
 * Callers that don't care about the envelope can skip the destructure
 * — `body` is the input minus the `__vmx_passthrough` key. Importantly
 * this returns a *shallow copy* so providers can mutate the body
 * (model override, stream_options, etc.) without leaking back into the
 * caller's reference.
 */

export type PassthroughEnvelope = {
  anthropic?: AnthropicPassthrough;
};

export type AnthropicPassthrough = {
  /** Top-level `cache_control` on the request envelope. */
  cache_control?: AnthropicMessagesRequest['cache_control'];
  /** Extended thinking config — `{type, budget_tokens?, display?}`. */
  thinking?: AnthropicMessagesRequest['thinking'];
  /** `top_k` (Anthropic-specific; OpenAI has no equivalent). */
  top_k?: number;
  /** `service_tier` selection. */
  service_tier?: AnthropicMessagesRequest['service_tier'];
  /** Container config (beta). */
  container?: AnthropicMessagesRequest['container'];
  /** Full structured metadata (more than `user_id`). */
  metadata?: AnthropicMessagesRequest['metadata'];
  /** Server tools (`web_search_*`, `code_execution_*`, etc.). */
  server_tools?: Array<unknown>;
  /** Tool choice with extended fields (`disable_parallel_tool_use`). */
  tool_choice?: AnthropicToolChoice;
  /**
   * Cache breakpoints inside the content. Keyed by `message_index/block_index`
   * (assistant/system stripped to flat indices) so providers can find and
   * re-attach the markers without parsing the OpenAI body.
   */
  cache_breakpoints?: Array<{
    path: string;
    cache_control: { type: 'ephemeral'; ttl?: '5m' | '1h' };
  }>;
  /** System-level cache control if `system` is a TextBlock array with markers. */
  system_cache_breakpoints?: Array<{
    index: number;
    cache_control: { type: 'ephemeral'; ttl?: '5m' | '1h' };
  }>;
  /** Tool-level cache breakpoints (last marked tool fixes the cache prefix). */
  tool_cache_breakpoints?: Array<{
    index: number;
    cache_control: { type: 'ephemeral'; ttl?: '5m' | '1h' };
  }>;
  /**
   * Thinking blocks from prior assistant turns — preserved so a
   * follow-up turn can include the signed reasoning back in the
   * request (multi-turn extended thinking continuity).
   *
   * Keyed by message index in the OpenAI `messages[]` array.
   */
  prior_thinking?: Array<{
    message_index: number;
    blocks: Array<{
      type: 'thinking' | 'redacted_thinking';
      thinking?: string;
      data?: string;
      signature?: string;
    }>;
  }>;
  /**
   * `betas` array opt-ins (interleaved-thinking-2025-05-14,
   * compact-2026-01-12, files-api-2025-04-14, search-results-2025-06-09,
   * etc.). T9 closes the gap where these were doc-claimed but never
   * actually plumbed. Native-Anthropic / Bedrock-Invoke providers
   * surface them onto the wire; OpenAI-compat providers ignore.
   */
  betas?: string[];
  /** MCP connector — URL-based remote MCP servers. (T9) */
  mcp_servers?: AnthropicMessagesRequest['mcp_servers'];
  /** Server-side compaction / context-management edits. (T9) */
  context_management?: AnthropicMessagesRequest['context_management'];
  /** Inference geo (us / global). (T9) */
  inference_geo?: AnthropicMessagesRequest['inference_geo'];
};

export type WithPassthrough = ChatCompletionCreateParams & {
  __vmx_passthrough?: PassthroughEnvelope;
};

export function takePassthroughEnvelope<T extends object>(
  request: T
): {
  body: T;
  envelope: PassthroughEnvelope | undefined;
  anthropic: AnthropicPassthrough | undefined;
} {
  // The Responses-API converter (`responses-converter.ts`) carries
  // the gateway's `vmx` extras on the converted OpenAI body so
  // CompletionService can read `correlationId`, `metadata`, etc. for
  // routing / audit / metrics. Strict OpenAI-compat upstreams (Groq,
  // Anthropic on the OpenAI shim, Gemini's OpenAI bridge, Perplexity)
  // reject unknown top-level fields with a 400 — so we strip both
  // the `__vmx_passthrough` envelope AND the top-level `vmx` field
  // here, before the provider hands the body to its SDK.
  //
  // Generic over the body type so the same helper serves OpenAI Chat
  // Completions, OpenAI Responses, and any future input-format DTO
  // that can carry the envelope (T7).
  const {
    __vmx_passthrough,
    vmx: _vmx,
    ...body
  } = request as T & {
    __vmx_passthrough?: PassthroughEnvelope;
    vmx?: unknown;
  };
  void _vmx;
  return {
    body: body as unknown as T,
    envelope: __vmx_passthrough,
    anthropic: __vmx_passthrough?.anthropic,
  };
}

/**
 * Convenience overload for providers that only care about stripping
 * the envelope (most OpenAI-compat upstreams that don't speak
 * Anthropic extensions natively). Generic so the same helper covers
 * OpenAI Chat Completions, OpenAI Responses, Anthropic Messages, and
 * any other input-shape DTO that can carry the envelope — the input
 * type round-trips out unchanged.
 */
export function stripPassthroughEnvelope<T extends object>(request: T): T {
  return takePassthroughEnvelope(request).body;
}
