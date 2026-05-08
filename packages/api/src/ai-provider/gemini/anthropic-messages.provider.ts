import { Injectable } from '@nestjs/common';
import type { ChatCompletionChunk } from 'openai/resources/index.js';
import type {
  Message as AnthropicMessage,
  RawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages';
import { v4 as uuidv4 } from 'uuid';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import {
  AnthropicMessagesResponse,
  CompletionRequestOptions,
} from '../ai-provider.types';
import { isAsyncIterable } from '../../utils/async';
import {
  anthropicRequestToOpenAI,
  openAIResponseToAnthropic,
} from '../../gateway/anthropic/anthropic-converter';
import type { CompletionRequestDto } from '../../gateway/dto/completion-request.dto';
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';
import { OpenAIChatCompletionProvider } from '../openai/openai-chat-completion.provider';
import { GeminiChatCompletionProvider } from './openai-chat-completion.provider';
import type { OpenAIConnectionConfig } from '../openai/shared';

/**
 * Direct one-hop `Anthropic → ChatCompletion → Anthropic` adapter for
 * OpenAI-compat upstreams that lack a Responses endpoint (Gemini, Groq,
 * Perplexity). Single converter pair, not an internal pivot — these
 * providers' wire format IS Chat Completions.
 *
 * The OpenAI provider's `anthropicMessages` cell uses a richer pivot
 * (Anthropic → Responses) per D5; OpenAI-compat upstreams without a
 * Responses endpoint use this path instead.
 */
export async function dispatchAnthropicMessagesViaOpenAICompat(
  chatCompletionProvider: OpenAIChatCompletionProvider,
  request: AnthropicMessagesRequest,
  connection: AIConnectionEntity<OpenAIConnectionConfig>,
  model: AIResourceModelConfigEntity,
  options?: CompletionRequestOptions
): Promise<AnthropicMessagesResponse> {
  const chatRequest = anthropicRequestToOpenAI(request) as CompletionRequestDto;
  const completion = await chatCompletionProvider.handle(
    chatRequest,
    connection,
    model,
    options
  );

  if (isAsyncIterable<ChatCompletionChunk>(completion.data)) {
    // T17: convert OpenAI ChatCompletion chunks → Anthropic SSE
    // events so Anthropic SDK clients can consume the stream. The
    // converter walks each chunk's delta, accumulates tool_call
    // arguments by index, and emits the standard Anthropic event
    // sequence (`message_start` → content_block start/delta/stop →
    // `message_delta` → `message_stop`).
    return {
      data: chatCompletionStreamToAnthropic(
        completion.data,
        request.model
      ) as never,
      headers: completion.headers,
      providerRequestPayload: completion.providerRequestPayload,
    };
  }
  const message = openAIResponseToAnthropic(
    completion.data as Parameters<typeof openAIResponseToAnthropic>[0],
    request.model
  ) as AnthropicMessage;
  return {
    data: message,
    headers: completion.headers,
    providerRequestPayload: completion.providerRequestPayload,
  };
}

/**
 * Convert an OpenAI ChatCompletion chunk stream into an Anthropic
 * SSE event sequence. Used by Gemini / Groq / Perplexity's
 * Anthropic-input handlers — those upstreams' wire format is Chat
 * Completions, but Anthropic-SDK clients consuming the gateway
 * expect `message_start` / `content_block_*` / `message_delta` /
 * `message_stop` events. (T17)
 *
 * Maps:
 *   - first chunk → `message_start` (with empty content + initial usage).
 *   - text delta → `content_block_start` (text, on first delta) +
 *     `content_block_delta` (text_delta) on subsequent.
 *   - tool_call delta → `content_block_start` (tool_use, on first) +
 *     `content_block_delta` (input_json_delta) on subsequent.
 *   - finish_reason chunk → `content_block_stop` (close any open
 *     blocks) + `message_delta` (final usage + stop_reason mapped).
 *   - end of stream → `message_stop`.
 */
export async function* chatCompletionStreamToAnthropic(
  source: AsyncIterable<ChatCompletionChunk>,
  model: string
): AsyncIterable<RawMessageStreamEvent> {
  const messageId = `msg_${uuidv4()}`;
  let messageStartEmitted = false;

  // Anthropic content-block index → block kind. Text blocks share
  // index 0 (one text block per assistant turn); tool_use blocks take
  // 1, 2, ... in the order they're seen.
  let textBlockOpen = false;
  let nextToolBlockIndex = 1;
  // OpenAI tool_call index → Anthropic block index.
  const toolBlockIndex = new Map<number, number>();

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let finishReason: ChatCompletionChunk.Choice['finish_reason'] | null = null;

  const emitMessageStart = (): RawMessageStreamEvent => {
    messageStartEmitted = true;
    return {
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        content: [],
        model,
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
        } as never,
      } as never,
    } as unknown as RawMessageStreamEvent;
  };

  for await (const chunk of source) {
    if (!messageStartEmitted) {
      yield emitMessageStart();
    }

    if (chunk.usage) {
      inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
      outputTokens = chunk.usage.completion_tokens ?? outputTokens;
      cacheReadTokens =
        chunk.usage.prompt_tokens_details?.cached_tokens ?? cacheReadTokens;
    }

    const choice = chunk.choices?.[0];
    if (!choice) continue;

    if (typeof choice.delta?.content === 'string' && choice.delta.content) {
      if (!textBlockOpen) {
        yield {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' } as never,
        } as unknown as RawMessageStreamEvent;
        textBlockOpen = true;
      }
      yield {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: choice.delta.content } as never,
      } as unknown as RawMessageStreamEvent;
    }

    for (const tc of choice.delta?.tool_calls ?? []) {
      const oaiIdx = tc.index;
      let anthIdx = toolBlockIndex.get(oaiIdx);
      if (anthIdx == null) {
        anthIdx = nextToolBlockIndex++;
        toolBlockIndex.set(oaiIdx, anthIdx);
        yield {
          type: 'content_block_start',
          index: anthIdx,
          content_block: {
            type: 'tool_use',
            id: tc.id ?? `toolu_${uuidv4()}`,
            name: tc.function?.name ?? '',
            input: {},
          } as never,
        } as unknown as RawMessageStreamEvent;
      }
      const argsDelta = tc.function?.arguments;
      if (argsDelta) {
        yield {
          type: 'content_block_delta',
          index: anthIdx,
          delta: {
            type: 'input_json_delta',
            partial_json: argsDelta,
          } as never,
        } as unknown as RawMessageStreamEvent;
      }
    }

    if (choice.finish_reason) {
      finishReason = choice.finish_reason;
    }
  }

  if (!messageStartEmitted) {
    yield emitMessageStart();
  }
  if (textBlockOpen) {
    yield {
      type: 'content_block_stop',
      index: 0,
    } as unknown as RawMessageStreamEvent;
  }
  for (const idx of toolBlockIndex.values()) {
    yield {
      type: 'content_block_stop',
      index: idx,
    } as unknown as RawMessageStreamEvent;
  }

  yield {
    type: 'message_delta',
    delta: {
      stop_reason: mapFinishReason(finishReason),
      stop_sequence: null,
    },
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_read_input_tokens: cacheReadTokens || null,
      cache_creation_input_tokens: null,
      server_tool_use: null,
    } as never,
  } as unknown as RawMessageStreamEvent;
  yield { type: 'message_stop' } as unknown as RawMessageStreamEvent;
}

function mapFinishReason(
  reason: ChatCompletionChunk.Choice['finish_reason'] | null
): AnthropicMessage['stop_reason'] {
  switch (reason) {
    case 'stop':
      return 'end_turn';
    case 'length':
      return 'max_tokens';
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'content_filter':
      return 'refusal';
    default:
      return 'end_turn';
  }
}

/**
 * Gemini's Anthropic-Messages-input handler. Uses the canonical
 * `Anthropic → ChatCompletion` adapter (exported above) — Groq and
 * Perplexity do the same with their own chat-completion deps.
 */
@Injectable()
export class GeminiAnthropicMessagesProvider {
  constructor(
    private readonly chatCompletionProvider: GeminiChatCompletionProvider
  ) {}

  handle(
    request: AnthropicMessagesRequest,
    connection: AIConnectionEntity<OpenAIConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<AnthropicMessagesResponse> {
    return dispatchAnthropicMessagesViaOpenAICompat(
      this.chatCompletionProvider,
      request,
      connection,
      model,
      options
    );
  }
}
