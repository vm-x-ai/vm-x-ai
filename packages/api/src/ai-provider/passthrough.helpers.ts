import type { ChatCompletionCreateParams } from 'openai/resources/index.js';
import type {
  AnthropicPassthrough,
  PassthroughEnvelope,
} from '../gateway/anthropic/anthropic-converter';

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
 * Anthropic extensions natively).
 */
export function stripPassthroughEnvelope(
  request: ChatCompletionCreateParams
): ChatCompletionCreateParams {
  return takePassthroughEnvelope(request).body;
}
