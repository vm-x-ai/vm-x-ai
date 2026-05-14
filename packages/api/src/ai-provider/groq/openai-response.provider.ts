import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import type {
  ResponseCreateParams,
  ResponseInputItem,
} from 'openai/resources/responses/responses.js';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import {
  CompletionRequestOptions,
  OpenAIResponseResponse,
} from '../ai-provider.types';
import { OpenAIResponseProvider } from '../openai/openai-response.provider';
import {
  type OpenAIConnectionConfig,
  createOpenAIClient,
} from '../openai/shared';

/**
 * Groq exposes a native OpenAI Responses-compatible endpoint
 * (https://console.groq.com/docs/responses-api), so the wire body is
 * passed through verbatim — same client construction pattern as the
 * chat-completion provider, just pointed at Groq's base URL.
 *
 * One Groq-specific divergence from OpenAI's contract: Groq rejects
 * typed `output_text` content parts inside assistant messages in the
 * request `input` array with a 400 ("Input contains unsupported
 * content types or unsupported content fields"). Typed `input_text`
 * parts in user messages, the response output[].content[].output_text
 * parts emitted on the wire, and tool-call / function_call items all
 * work. The flatten in `normalizeAssistantOutputTextForGroq` collapses
 * each assistant message's typed `output_text` parts into a single
 * plain-string `content`, which Groq accepts. Empirically verified
 * 2026-05 against api.groq.com/openai/v1/responses; the limitation is
 * not documented on Groq's responses-api page.
 */
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

@Injectable()
export class GroqResponseProvider extends OpenAIResponseProvider {
  protected override createClient(
    connection: AIConnectionEntity<OpenAIConnectionConfig>
  ): Promise<OpenAI> {
    return createOpenAIClient(connection, GROQ_BASE_URL);
  }

  override handle(
    request: ResponseCreateParams,
    connection: AIConnectionEntity<OpenAIConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<OpenAIResponseResponse> {
    return super.handle(
      normalizeAssistantOutputTextForGroq(request),
      connection,
      model,
      options
    );
  }
}

/**
 * Walk `request.input` and, for every assistant `message` whose
 * `content` is a typed-block array, collapse the `output_text` parts
 * to a single plain string. Other shapes (non-array `input`, non-
 * message items, user messages, tool calls, content with non-text
 * parts) round-trip unchanged.
 *
 * Exported for direct testing; the override above is the production
 * call site.
 */
export function normalizeAssistantOutputTextForGroq(
  request: ResponseCreateParams
): ResponseCreateParams {
  const input = request.input;
  if (!Array.isArray(input)) return request;

  let mutated = false;
  const next: ResponseInputItem[] = input.map((item) => {
    if (!isAssistantMessageWithTypedContent(item)) return item;
    const text = collectOutputText(item.content);
    if (text === null) return item;
    mutated = true;
    return { ...item, content: text } as ResponseInputItem;
  });

  return mutated ? { ...request, input: next } : request;
}

type AssistantTypedMessage = ResponseInputItem & {
  type: 'message';
  role: 'assistant';
  content: Array<{ type?: string; text?: string }>;
};

function isAssistantMessageWithTypedContent(
  item: ResponseInputItem
): item is AssistantTypedMessage {
  if (item == null || typeof item !== 'object') return false;
  const obj = item as { type?: unknown; role?: unknown; content?: unknown };
  // The Responses input grammar lets a message item omit `type` —
  // any item with a `role` field is treated as a message. Match both
  // the explicit `{ type: 'message', role: 'assistant' }` shape and
  // the role-only `{ role: 'assistant' }` shorthand the SDK accepts.
  const isMessage = obj.type === 'message' || obj.type === undefined;
  return isMessage && obj.role === 'assistant' && Array.isArray(obj.content);
}

/**
 * Returns the concatenated `output_text` content, or `null` when the
 * array contains anything that isn't a plain `output_text` part — in
 * which case we leave the message alone so non-text content (refusals,
 * etc.) isn't silently dropped.
 */
function collectOutputText(
  parts: Array<{ type?: string; text?: string }>
): string | null {
  const out: string[] = [];
  for (const part of parts) {
    if (part?.type !== 'output_text' || typeof part.text !== 'string') {
      return null;
    }
    out.push(part.text);
  }
  return out.join('');
}
