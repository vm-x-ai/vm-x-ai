import { describe, expect, it, vi } from 'vitest';
import { OpenAIAnthropicMessagesProvider } from './anthropic-messages.provider';
import type { OpenAIResponseProvider } from './openai-response.provider';
import type { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import type { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import type { OpenAIConnectionConfig } from './shared';
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';
import type { Message as AnthropicMessage } from '@anthropic-ai/sdk/resources/messages';
import type { Response as OpenAIResponse } from 'openai/resources/responses/responses.js';

/**
 * Class-layer unit tests for {@link OpenAIAnthropicMessagesProvider} —
 * the D5 path: Anthropic Messages input pivots through OpenAI
 * **Responses** (not Chat Completions). The Anthropic↔Responses
 * adapter is canonical-owned by this file; the pure converter
 * functions are covered by `__integration__/anthropic/responses-adapter.spec.ts`.
 *
 * What's tested here:
 * 1. The class converts the request via `requestAnthropicToResponses`,
 *    delegates to `OpenAIResponseProvider.handle()`, then converts the
 *    response back via `responseResponsesToAnthropic` (non-stream) or
 *    `streamResponsesToAnthropic` (stream).
 * 2. The class doesn't strip vmx itself — the inner `OpenAIResponseProvider`
 *    does. We just assert the inner provider was called.
 * 3. `providerRequestPayload` from the inner provider flows back
 *    verbatim (the audit row records the Responses-shape body the SDK
 *    saw, not the original Anthropic request).
 */

function makeConnection(): AIConnectionEntity<OpenAIConnectionConfig> {
  return {
    connectionId: 'conn-1',
    config: { apiKey: 'sk-test' },
  } as unknown as AIConnectionEntity<OpenAIConnectionConfig>;
}

function makeModel(model = 'gpt-4o-mini'): AIResourceModelConfigEntity {
  return { model } as AIResourceModelConfigEntity;
}

/** Build a stub `OpenAIResponseProvider` whose `handle` is a vi spy. */
function makeResponseProviderStub(): OpenAIResponseProvider & {
  handle: ReturnType<typeof vi.fn>;
} {
  return { handle: vi.fn() } as unknown as OpenAIResponseProvider & {
    handle: ReturnType<typeof vi.fn>;
  };
}

const anthropicRequest: AnthropicMessagesRequest = {
  model: 'will-be-replaced',
  max_tokens: 100,
  messages: [{ role: 'user', content: 'ping' }],
};

const fakeResponsesShape: OpenAIResponse = {
  id: 'resp_1',
  object: 'response',
  created_at: 1715000000,
  status: 'completed',
  model: 'gpt-4o-mini',
  output: [
    {
      type: 'message',
      id: 'msg_1',
      role: 'assistant',
      status: 'completed',
      content: [
        { type: 'output_text', text: 'pong', annotations: [], logprobs: [] },
      ],
    },
  ],
  usage: {
    input_tokens: 5,
    output_tokens: 1,
    total_tokens: 6,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 },
  },
} as unknown as OpenAIResponse;

describe('OpenAIAnthropicMessagesProvider — class layer', () => {
  it('delegates to OpenAIResponseProvider with a Responses-shape body', async () => {
    const responseProvider = makeResponseProviderStub();
    responseProvider.handle.mockResolvedValue({
      data: fakeResponsesShape,
      headers: { 'x-request-id': 'req-1' },
      providerRequestPayload: { model: 'gpt-4o-mini', input: [] },
    });
    const provider = new OpenAIAnthropicMessagesProvider(responseProvider);

    await provider.handle(anthropicRequest, makeConnection(), makeModel());

    expect(responseProvider.handle).toHaveBeenCalledOnce();
    const responsesBody = responseProvider.handle.mock.calls[0][0];
    expect(responsesBody).toMatchObject({ model: 'will-be-replaced' });
    // Anthropic `messages` becomes Responses `input`.
    expect(responsesBody.input).toBeDefined();
    expect(Array.isArray(responsesBody.input)).toBe(true);
  });

  it('non-streaming response: converts Responses → Anthropic Message shape', async () => {
    const responseProvider = makeResponseProviderStub();
    responseProvider.handle.mockResolvedValue({
      data: fakeResponsesShape,
      headers: {},
      providerRequestPayload: { model: 'gpt-4o-mini', input: [] },
    });
    const provider = new OpenAIAnthropicMessagesProvider(responseProvider);

    const result = await provider.handle(
      anthropicRequest,
      makeConnection(),
      makeModel()
    );
    const data = result.data as AnthropicMessage;
    expect(data.type).toBe('message');
    expect(data.role).toBe('assistant');
    expect(data.content[0]).toMatchObject({ type: 'text', text: 'pong' });
    expect(data.usage.input_tokens).toBe(5);
    expect(data.usage.output_tokens).toBe(1);
  });

  it('streaming response: converts ResponseStreamEvent → RawMessageStreamEvent iterable', async () => {
    const responseProvider = makeResponseProviderStub();
    async function* fakeRespStream() {
      yield {
        type: 'response.created',
        response: { id: 'r1' },
      } as never;
      yield {
        type: 'response.output_item.added',
        output_index: 0,
        item: {
          type: 'message',
          id: 'msg_1',
          role: 'assistant',
          status: 'in_progress',
          content: [],
        },
      } as never;
      yield {
        type: 'response.output_text.delta',
        item_id: 'msg_1',
        output_index: 0,
        content_index: 0,
        delta: 'pong',
      } as never;
      yield {
        type: 'response.completed',
        response: fakeResponsesShape,
      } as never;
    }
    responseProvider.handle.mockResolvedValue({
      data: fakeRespStream(),
      headers: {},
      providerRequestPayload: { model: 'gpt-4o-mini', input: [] },
    });
    const provider = new OpenAIAnthropicMessagesProvider(responseProvider);

    const result = await provider.handle(
      { ...anthropicRequest, stream: true },
      makeConnection(),
      makeModel()
    );

    const events: Array<{ type: string }> = [];
    for await (const ev of result.data as AsyncIterable<{ type: string }>) {
      events.push(ev);
    }
    const types = events.map((e) => e.type);
    // Anthropic streaming envelope must contain at least the
    // canonical lifecycle events.
    expect(types).toContain('message_start');
    expect(types).toContain('content_block_delta');
    expect(types).toContain('message_stop');
  });

  it('forwards providerRequestPayload + headers from the inner Response provider', async () => {
    const responseProvider = makeResponseProviderStub();
    const innerPayload = {
      model: 'gpt-4o-mini',
      input: [{ role: 'user' }],
      instructions: 'hi',
    };
    responseProvider.handle.mockResolvedValue({
      data: fakeResponsesShape,
      headers: { 'x-request-id': 'req-via-inner' },
      providerRequestPayload: innerPayload,
    });
    const provider = new OpenAIAnthropicMessagesProvider(responseProvider);

    const result = await provider.handle(
      anthropicRequest,
      makeConnection(),
      makeModel()
    );
    expect(result.providerRequestPayload).toBe(innerPayload);
    expect(result.headers).toEqual({ 'x-request-id': 'req-via-inner' });
  });

  it('inner errors propagate (this class never converts errors)', async () => {
    const responseProvider = makeResponseProviderStub();
    const innerError = new Error('inner failed');
    responseProvider.handle.mockRejectedValue(innerError);
    const provider = new OpenAIAnthropicMessagesProvider(responseProvider);

    await expect(
      provider.handle(anthropicRequest, makeConnection(), makeModel())
    ).rejects.toBe(innerError);
  });

  it('forwards options (signal, maxRetries, forwardHeaders) to the inner provider', async () => {
    const responseProvider = makeResponseProviderStub();
    responseProvider.handle.mockResolvedValue({
      data: fakeResponsesShape,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new OpenAIAnthropicMessagesProvider(responseProvider);
    const ac = new AbortController();
    const options = {
      signal: ac.signal,
      maxRetries: 4,
      forwardHeaders: { 'OpenAI-Beta': 'b' },
    };
    await provider.handle(
      anthropicRequest,
      makeConnection(),
      makeModel(),
      options
    );
    expect(responseProvider.handle.mock.calls[0][3]).toBe(options);
  });
});
