import type { ChatCompletionCreateParams } from 'openai/resources/index.js';
import type { ResponseCreateParams } from 'openai/resources/responses/responses.js';
import type { AnthropicMessagesRequest } from './anthropic/anthropic.types';

/**
 * Routing input — wraps the canonical Responses-shape body the routing
 * engine evaluates against alongside the input format and the original
 * native body.
 *
 * **Canonical shape: OpenAI Responses.** Every public endpoint
 * normalizes to Responses before the orchestrator routes/gates/audits.
 * EJS routing templates dereference Responses fields directly:
 * `request.input`, `request.instructions`, `request.tools`,
 * `request.reasoning`. Legacy convenience variables (`request.messages`,
 * `request.firstMessage`, `request.lastMessage`,
 * `request.allMessagesContent`, `request.messagesCount`,
 * `request.toolsCount`) are derived in `routing.service.ts` from the
 * Responses body so existing template patterns keep working.
 *
 * Advanced templates can branch on `request.format` and read
 * `request.nativeBody` to access fields no canonical conversion covers
 * (Anthropic `cache_control`, Bedrock-Converse-only configs, etc.).
 */
export type RoutingFormat = 'chat-completions' | 'responses' | 'anthropic';

export type RoutingContext = {
  /** The input format the client sent. */
  format: RoutingFormat;
  /** Canonical Responses-shape body — what routing templates evaluate against. */
  responses: ResponseCreateParams;
  /** Original native body — exposed to advanced templates. */
  native:
    | ChatCompletionCreateParams
    | ResponseCreateParams
    | AnthropicMessagesRequest;
};

export function makeRoutingContext<F extends RoutingFormat>(
  format: F,
  responses: ResponseCreateParams,
  native: F extends 'chat-completions'
    ? ChatCompletionCreateParams
    : F extends 'responses'
    ? ResponseCreateParams
    : AnthropicMessagesRequest
): RoutingContext {
  return { format, responses, native: native as RoutingContext['native'] };
}
