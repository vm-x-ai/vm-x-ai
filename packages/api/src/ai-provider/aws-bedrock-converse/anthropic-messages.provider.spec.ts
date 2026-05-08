import { describe, expect, it, vi } from 'vitest';
import type {
  ConverseCommandOutput,
  ConverseStreamOutput,
} from '@aws-sdk/client-bedrock-runtime';
import type { Message as AnthropicMessage } from '@anthropic-ai/sdk/resources/messages';
import { AWSBedrockConverseAnthropicMessagesProvider } from './anthropic-messages.provider';
import type { AWSBedrockConverseDispatcher } from './shared';
import type { AWSBedrockAIConnectionConfig } from './shared';
import type { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import type { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';

/**
 * Class-layer tests for {@link AWSBedrockConverseAnthropicMessagesProvider}.
 *
 * Pins the load-bearing class behaviours that complement the pure
 * adapter coverage in `__integration__/converse/anthropic-adapter.spec.ts`:
 *  - T19 capability gate fires (or doesn't) based on tools/tool_choice
 *  - T21 guardrails appended onto the Converse input from connection config
 *  - T22 performanceConfig appended from connection config
 *  - stream-vs-nonstream branch picks the right output adapter
 */

function makeConnection(
  overrides: Partial<AWSBedrockAIConnectionConfig> = {}
): AIConnectionEntity<AWSBedrockAIConnectionConfig> {
  return {
    connectionId: 'conn-1',
    config: {
      iamRoleArn: 'arn:aws:iam::123456789012:role/test',
      region: 'us-east-1',
      ...overrides,
    },
  } as unknown as AIConnectionEntity<AWSBedrockAIConnectionConfig>;
}

function makeModel(
  model = 'us.anthropic.claude-haiku-4-5-20251001-v1:0'
): AIResourceModelConfigEntity {
  return { model } as AIResourceModelConfigEntity;
}

function makeDispatcherStub(): AWSBedrockConverseDispatcher & {
  dispatchConverseRaw: ReturnType<typeof vi.fn>;
} {
  return {
    dispatchConverseRaw: vi.fn(),
  } as unknown as AWSBedrockConverseDispatcher & {
    dispatchConverseRaw: ReturnType<typeof vi.fn>;
  };
}

const baseRequest: AnthropicMessagesRequest = {
  model: 'test',
  max_tokens: 100,
  messages: [{ role: 'user', content: 'ping' }],
};

const fakeConverseOutput: ConverseCommandOutput = {
  $metadata: {},
  output: {
    message: {
      role: 'assistant',
      content: [{ text: 'pong' }],
    },
  },
  stopReason: 'end_turn',
  usage: { inputTokens: 5, outputTokens: 1, totalTokens: 6 },
} as ConverseCommandOutput;

describe('AWSBedrockConverseAnthropicMessagesProvider — class layer', () => {
  it('delegates to dispatcher.dispatchConverseRaw with the converted Converse input', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchConverseRaw.mockResolvedValue({
      data: fakeConverseOutput,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockConverseAnthropicMessagesProvider(
      dispatcher
    );

    await provider.handle(baseRequest, makeConnection(), makeModel());
    expect(dispatcher.dispatchConverseRaw).toHaveBeenCalledOnce();
    const [input, isStream] = dispatcher.dispatchConverseRaw.mock.calls[0];
    expect(input.modelId).toBe('us.anthropic.claude-haiku-4-5-20251001-v1:0');
    expect(isStream).toBe(false);
  });

  it('non-stream: converts ConverseCommandOutput → AnthropicMessage', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchConverseRaw.mockResolvedValue({
      data: fakeConverseOutput,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockConverseAnthropicMessagesProvider(
      dispatcher
    );

    const result = await provider.handle(
      baseRequest,
      makeConnection(),
      makeModel()
    );
    const data = result.data as AnthropicMessage;
    expect(data.type).toBe('message');
    expect(data.role).toBe('assistant');
    expect(data.content[0]).toMatchObject({ type: 'text', text: 'pong' });
  });

  it('stream: returns AsyncIterable<RawMessageStreamEvent> from streamConverseToAnthropic', async () => {
    const dispatcher = makeDispatcherStub();
    async function* fakeStream(): AsyncIterable<ConverseStreamOutput> {
      yield {
        messageStart: { role: 'assistant' },
      } as ConverseStreamOutput;
      yield {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { text: 'pong' },
        },
      } as ConverseStreamOutput;
      yield { messageStop: { stopReason: 'end_turn' } } as ConverseStreamOutput;
    }
    dispatcher.dispatchConverseRaw.mockResolvedValue({
      data: fakeStream(),
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockConverseAnthropicMessagesProvider(
      dispatcher
    );

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
    expect(types).toContain('message_start');
    expect(types).toContain('content_block_delta');
    expect(types).toContain('message_stop');
    // Dispatcher was told this is a streaming call.
    expect(dispatcher.dispatchConverseRaw.mock.calls[0][1]).toBe(true);
  });

  it('T22: appends connection.config.performanceConfig.latency to the Converse input', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchConverseRaw.mockResolvedValue({
      data: fakeConverseOutput,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockConverseAnthropicMessagesProvider(
      dispatcher
    );

    await provider.handle(
      baseRequest,
      makeConnection({ performanceConfig: { latency: 'optimized' } } as never),
      makeModel()
    );
    const input = dispatcher.dispatchConverseRaw.mock.calls[0][0];
    expect(input.performanceConfig).toEqual({ latency: 'optimized' });
  });

  it('T21: appends connection.config.guardrailConfig (with default trace=enabled) to the Converse input', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchConverseRaw.mockResolvedValue({
      data: fakeConverseOutput,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockConverseAnthropicMessagesProvider(
      dispatcher
    );

    await provider.handle(
      baseRequest,
      makeConnection({
        guardrailConfig: {
          guardrailIdentifier: 'gr-1',
          guardrailVersion: 'DRAFT',
        },
      } as never),
      makeModel()
    );
    const input = dispatcher.dispatchConverseRaw.mock.calls[0][0];
    expect(input.guardrailConfig).toEqual({
      guardrailIdentifier: 'gr-1',
      guardrailVersion: 'DRAFT',
      trace: 'enabled',
    });
  });

  it('T21: respects explicit trace setting on connection.guardrailConfig', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchConverseRaw.mockResolvedValue({
      data: fakeConverseOutput,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockConverseAnthropicMessagesProvider(
      dispatcher
    );

    await provider.handle(
      baseRequest,
      makeConnection({
        guardrailConfig: {
          guardrailIdentifier: 'gr-1',
          guardrailVersion: '1',
          trace: 'disabled',
        },
      } as never),
      makeModel()
    );
    const input = dispatcher.dispatchConverseRaw.mock.calls[0][0];
    expect(input.guardrailConfig?.trace).toBe('disabled');
  });

  it('T19: capability gate throws on tools+model-without-tool-support BEFORE the SDK call', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchConverseRaw.mockResolvedValue({
      data: fakeConverseOutput,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockConverseAnthropicMessagesProvider(
      dispatcher
    );

    // Titan Text Large doesn't support tools (capability map).
    await expect(
      provider.handle(
        {
          ...baseRequest,
          tools: [
            {
              name: 't',
              description: 'd',
              input_schema: { type: 'object' },
            },
          ],
        } as AnthropicMessagesRequest,
        makeConnection(),
        { model: 'amazon.titan-text-large-v1' } as AIResourceModelConfigEntity
      )
    ).rejects.toMatchObject({
      data: expect.objectContaining({ statusCode: 400 }),
    });
    expect(dispatcher.dispatchConverseRaw).not.toHaveBeenCalled();
  });

  it('T19: tool_choice="none" with tools skips the gate (model can ignore tools)', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchConverseRaw.mockResolvedValue({
      data: fakeConverseOutput,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockConverseAnthropicMessagesProvider(
      dispatcher
    );

    // Even though the model doesn't support tools, tool_choice=none
    // means the model is told to NOT use them — which is semantically
    // tool-free, so the gate must not fire.
    await provider.handle(
      {
        ...baseRequest,
        tools: [
          { name: 't', description: 'd', input_schema: { type: 'object' } },
        ],
        tool_choice: { type: 'none' },
      } as AnthropicMessagesRequest,
      makeConnection(),
      { model: 'amazon.titan-text-large-v1' } as AIResourceModelConfigEntity
    );
    expect(dispatcher.dispatchConverseRaw).toHaveBeenCalledOnce();
  });

  it('forwards options (signal, maxRetries) to the dispatcher', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchConverseRaw.mockResolvedValue({
      data: fakeConverseOutput,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockConverseAnthropicMessagesProvider(
      dispatcher
    );
    const ac = new AbortController();
    const options = { signal: ac.signal, maxRetries: 4 };
    await provider.handle(baseRequest, makeConnection(), makeModel(), options);
    expect(dispatcher.dispatchConverseRaw.mock.calls[0][3]).toBe(options);
  });
});
