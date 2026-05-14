import { describe, expect, it, vi } from 'vitest';
import type {
  ResponseCreateParams,
  Response as OpenAIResponse,
} from 'openai/resources/responses/responses.js';
import type {
  Message as AnthropicMessage,
  RawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages';
import { AnthropicOpenAIResponseProvider } from './openai-response.provider';
import type { AnthropicDispatcher } from './shared';
import type { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import type { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import type { AnthropicConnectionConfig } from './shared';

/**
 * Class-layer tests for {@link AnthropicOpenAIResponseProvider} — the
 * direct Responses↔Anthropic path (no internal pivot). Converts
 * Responses-shape input via `requestResponsesToAnthropic`, calls
 * `dispatcher.dispatchNative` (true Anthropic native dispatch), then
 * converts the response back via `responseAnthropicToResponses` /
 * `streamAnthropicToResponses`.
 *
 * Pure adapter math is covered by
 * `__integration__/anthropic/responses-adapter.spec.ts`. This spec
 * pins the class's three-step pipeline: convert-in → dispatch → convert-out.
 */

function makeConnection(): AIConnectionEntity<AnthropicConnectionConfig> {
  return {
    connectionId: 'conn-1',
    config: { apiKey: 'sk-ant-test' },
  } as unknown as AIConnectionEntity<AnthropicConnectionConfig>;
}

function makeModel(model = 'claude-haiku-4-5'): AIResourceModelConfigEntity {
  return { model } as AIResourceModelConfigEntity;
}

function makeDispatcherStub(): AnthropicDispatcher & {
  dispatchNative: ReturnType<typeof vi.fn>;
} {
  return { dispatchNative: vi.fn() } as unknown as AnthropicDispatcher & {
    dispatchNative: ReturnType<typeof vi.fn>;
  };
}

const responsesRequest: ResponseCreateParams = {
  model: 'will-be-replaced',
  input: 'ping',
  instructions: 'Be concise.',
};

const fakeAnthropicMessage: AnthropicMessage = {
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-haiku-4-5',
  content: [{ type: 'text', text: 'pong', citations: null }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 5, output_tokens: 1 },
} as unknown as AnthropicMessage;

describe('AnthropicOpenAIResponseProvider — class layer', () => {
  it('converts Responses → Anthropic shape and substitutes model before dispatch', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchNative.mockResolvedValue({
      data: fakeAnthropicMessage,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AnthropicOpenAIResponseProvider(dispatcher);

    await provider.handle(
      responsesRequest,
      makeConnection(),
      makeModel('claude-haiku-4-5')
    );
    const passedBody = dispatcher.dispatchNative.mock.calls[0][0];
    expect(passedBody.model).toBe('claude-haiku-4-5');
    // The adapter emits Anthropic's `system` as a TextBlockParam[]
    // (or a string, depending on shape). Both forms must surface the
    // instructions text verbatim.
    const systemText = Array.isArray(passedBody.system)
      ? passedBody.system.map((b: { text?: string }) => b.text ?? '').join('')
      : passedBody.system;
    expect(systemText).toBe('Be concise.');
  });

  it('non-streaming: converts Anthropic Message → OpenAI Response shape', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchNative.mockResolvedValue({
      data: fakeAnthropicMessage,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AnthropicOpenAIResponseProvider(dispatcher);

    const result = await provider.handle(
      responsesRequest,
      makeConnection(),
      makeModel()
    );
    const data = result.data as OpenAIResponse;
    expect(data.object).toBe('response');
    expect(data.status).toBe('completed');
    const message = data.output.find((o) => o.type === 'message');
    expect(message).toBeDefined();
    expect(data.usage?.input_tokens).toBe(5);
    expect(data.usage?.output_tokens).toBe(1);
  });

  it('streaming: converts RawMessageStreamEvent iterable → ResponseStreamEvent iterable', async () => {
    const dispatcher = makeDispatcherStub();
    async function* anthropicStream(): AsyncIterable<RawMessageStreamEvent> {
      yield {
        type: 'message_start',
        message: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude-haiku-4-5',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 5, output_tokens: 0 },
        },
      } as never;
      yield {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      } as never;
      yield {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'pong' },
      } as never;
      yield { type: 'content_block_stop', index: 0 } as never;
      yield {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 1 },
      } as never;
      yield { type: 'message_stop' } as never;
    }
    dispatcher.dispatchNative.mockResolvedValue({
      data: anthropicStream(),
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AnthropicOpenAIResponseProvider(dispatcher);

    const result = await provider.handle(
      { ...responsesRequest, stream: true },
      makeConnection(),
      makeModel()
    );
    const events: Array<{ type: string }> = [];
    for await (const ev of result.data as AsyncIterable<{ type: string }>) {
      events.push(ev);
    }
    const types = events.map((e) => e.type);
    // Responses streaming envelope canonical events.
    expect(types).toContain('response.created');
    expect(types).toContain('response.completed');
  });

  it('forwards providerRequestPayload + headers from the dispatcher', async () => {
    const dispatcher = makeDispatcherStub();
    const dispatcherPayload = { model: 'claude-haiku-4-5', messages: [] };
    dispatcher.dispatchNative.mockResolvedValue({
      data: fakeAnthropicMessage,
      headers: { 'x-request-id': 'req-1' },
      providerRequestPayload: dispatcherPayload,
    });
    const provider = new AnthropicOpenAIResponseProvider(dispatcher);

    const result = await provider.handle(
      responsesRequest,
      makeConnection(),
      makeModel()
    );
    expect(result.providerRequestPayload).toBe(dispatcherPayload);
    expect(result.headers).toEqual({ 'x-request-id': 'req-1' });
  });

  it('forwards options to the dispatcher', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchNative.mockResolvedValue({
      data: fakeAnthropicMessage,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AnthropicOpenAIResponseProvider(dispatcher);
    const ac = new AbortController();
    const options = { signal: ac.signal, maxRetries: 1 };
    await provider.handle(
      responsesRequest,
      makeConnection(),
      makeModel(),
      options
    );
    expect(dispatcher.dispatchNative.mock.calls[0][3]).toBe(options);
  });

  it('dispatcher errors propagate', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchNative.mockRejectedValue(new Error('dispatch failed'));
    const provider = new AnthropicOpenAIResponseProvider(dispatcher);

    await expect(
      provider.handle(responsesRequest, makeConnection(), makeModel())
    ).rejects.toThrow('dispatch failed');
  });

  it('propagates `parallel_tool_calls: false` as `disable_parallel_tool_use` on the dispatched body', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchNative.mockResolvedValue({
      data: fakeAnthropicMessage,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AnthropicOpenAIResponseProvider(dispatcher);

    await provider.handle(
      {
        ...responsesRequest,
        parallel_tool_calls: false,
        tools: [{ type: 'function', name: 't', parameters: {} }] as never,
      },
      makeConnection(),
      makeModel()
    );
    const passedBody = dispatcher.dispatchNative.mock.calls[0][0];
    expect(passedBody.tool_choice).toMatchObject({
      type: 'auto',
      disable_parallel_tool_use: true,
    });
  });

  it('populates incomplete_details on max_tokens stop', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchNative.mockResolvedValue({
      data: {
        ...fakeAnthropicMessage,
        stop_reason: 'max_tokens',
      },
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AnthropicOpenAIResponseProvider(dispatcher);

    const result = await provider.handle(
      responsesRequest,
      makeConnection(),
      makeModel()
    );
    const data = result.data as OpenAIResponse;
    expect(data.status).toBe('incomplete');
    expect(data.incomplete_details).toEqual({ reason: 'max_output_tokens' });
  });
});
