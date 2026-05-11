import { describe, expect, it, vi } from 'vitest';
import type {
  ResponseCreateParams,
  Response as OpenAIResponse,
} from 'openai/resources/responses/responses.js';
import type {
  Message as AnthropicMessage,
  RawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages';
import { AWSBedrockInvokeOpenAIResponseProvider } from './openai-response.provider';
import type { AWSBedrockInvokeDispatcher } from './shared';
import type { AWSBedrockAIConnectionConfig } from '../aws-bedrock-base';
import type { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import type { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';

/**
 * Class-layer tests for {@link AWSBedrockInvokeOpenAIResponseProvider}.
 *
 * Pipeline: OpenAI Responses → Anthropic shape (via canonical
 * Responses↔Anthropic adapter from
 * `anthropic/openai-response.provider.ts`) → Bedrock-Invoke wire
 * shape → `dispatcher.dispatchNative` → response converted back to
 * Responses shape.
 *
 * No internal pivot through ChatCompletion. The class assembles a
 * three-step pipeline; this spec pins each step.
 */

function makeConnection(): AIConnectionEntity<AWSBedrockAIConnectionConfig> {
  return {
    connectionId: 'conn-1',
    config: {
      iamRoleArn: 'arn:aws:iam::123456789012:role/test',
      region: 'us-east-1',
    },
  } as unknown as AIConnectionEntity<AWSBedrockAIConnectionConfig>;
}

function makeModel(
  model = 'us.anthropic.claude-haiku-4-5-20251001-v1:0'
): AIResourceModelConfigEntity {
  return { model } as AIResourceModelConfigEntity;
}

function makeDispatcherStub(): AWSBedrockInvokeDispatcher & {
  dispatchNative: ReturnType<typeof vi.fn>;
} {
  return {
    dispatchNative: vi.fn(),
  } as unknown as AWSBedrockInvokeDispatcher & {
    dispatchNative: ReturnType<typeof vi.fn>;
  };
}

const baseRequest: ResponseCreateParams = {
  model: 'test',
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

describe('AWSBedrockInvokeOpenAIResponseProvider — class layer', () => {
  it('builds the Bedrock-Invoke wire body with anthropic_version + canonical Anthropic content', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchNative.mockResolvedValue({
      data: fakeAnthropicMessage,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockInvokeOpenAIResponseProvider(dispatcher);

    await provider.handle(baseRequest, makeConnection(), makeModel());
    const wireBody = dispatcher.dispatchNative.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(wireBody.anthropic_version).toBeDefined();
    expect(wireBody).not.toHaveProperty('model');
    expect(wireBody).not.toHaveProperty('stream');
    // Responses' `instructions` becomes Anthropic's `system`.
    expect(wireBody.system).toBeDefined();
    expect(Array.isArray(wireBody.messages)).toBe(true);
  });

  it('non-stream: converts Anthropic Message → OpenAI Response shape', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchNative.mockResolvedValue({
      data: fakeAnthropicMessage,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockInvokeOpenAIResponseProvider(dispatcher);

    const result = await provider.handle(
      baseRequest,
      makeConnection(),
      makeModel()
    );
    const data = result.data as OpenAIResponse;
    expect(data.object).toBe('response');
    expect(data.status).toBe('completed');
    const message = data.output.find((o) => o.type === 'message');
    expect(message).toBeDefined();
  });

  it('stream: converts RawMessageStreamEvent iterable → ResponseStreamEvent iterable', async () => {
    const dispatcher = makeDispatcherStub();
    async function* fakeStream(): AsyncIterable<RawMessageStreamEvent> {
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
      data: fakeStream(),
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockInvokeOpenAIResponseProvider(dispatcher);

    const result = await provider.handle(
      { ...baseRequest, stream: true },
      makeConnection(),
      makeModel()
    );
    const events: Array<{ type: string }> = [];
    for await (const ev of result.data as AsyncIterable<{ type: string }>) {
      events.push(ev);
    }
    const types = events.map((e) => e.type);
    expect(types).toContain('response.created');
    expect(types).toContain('response.completed');
    // Dispatcher saw the streaming flag.
    expect(dispatcher.dispatchNative.mock.calls[0][1]).toBe(true);
  });

  it('forwards providerRequestPayload + headers from the dispatcher', async () => {
    const dispatcher = makeDispatcherStub();
    const dispatcherPayload = {
      anthropic_version: 'bedrock-2023-05-31',
      messages: [],
    };
    dispatcher.dispatchNative.mockResolvedValue({
      data: fakeAnthropicMessage,
      headers: { 'x-request-id': 'req-bdr-1' },
      providerRequestPayload: dispatcherPayload,
    });
    const provider = new AWSBedrockInvokeOpenAIResponseProvider(dispatcher);

    const result = await provider.handle(
      baseRequest,
      makeConnection(),
      makeModel()
    );
    expect(result.providerRequestPayload).toBe(dispatcherPayload);
    expect(result.headers).toEqual({ 'x-request-id': 'req-bdr-1' });
  });

  it('forwards options to the dispatcher', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchNative.mockResolvedValue({
      data: fakeAnthropicMessage,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockInvokeOpenAIResponseProvider(dispatcher);

    const ac = new AbortController();
    const options = { signal: ac.signal, maxRetries: 2 };
    await provider.handle(baseRequest, makeConnection(), makeModel(), options);
    expect(dispatcher.dispatchNative.mock.calls[0][4]).toBe(options);
  });
});
