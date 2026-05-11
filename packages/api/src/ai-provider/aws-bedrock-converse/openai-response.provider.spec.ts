import { describe, expect, it, vi } from 'vitest';
import type {
  ConverseCommandOutput,
  ConverseStreamOutput,
} from '@aws-sdk/client-bedrock-runtime';
import type {
  ResponseCreateParams,
  Response as OpenAIResponse,
} from 'openai/resources/responses/responses.js';
import { AWSBedrockConverseOpenAIResponseProvider } from './openai-response.provider';
import type { AWSBedrockConverseDispatcher } from './shared';
import type { AWSBedrockAIConnectionConfig } from './shared';
import type { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import type { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';

/**
 * Class-layer tests for {@link AWSBedrockConverseOpenAIResponseProvider} —
 * the Responses↔Converse direct path (no internal pivot through Chat
 * Completions). Mirrors the Anthropic-input class spec for the Resp
 * input format.
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

const baseRequest: ResponseCreateParams = {
  model: 'test',
  input: 'ping',
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

describe('AWSBedrockConverseOpenAIResponseProvider — class layer', () => {
  it('delegates to dispatcher.dispatchConverseRaw with the converted input', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchConverseRaw.mockResolvedValue({
      data: fakeConverseOutput,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockConverseOpenAIResponseProvider(dispatcher);

    await provider.handle(baseRequest, makeConnection(), makeModel());
    const [input, isStream] = dispatcher.dispatchConverseRaw.mock.calls[0];
    expect(input.modelId).toBe('us.anthropic.claude-haiku-4-5-20251001-v1:0');
    expect(isStream).toBe(false);
  });

  it('non-stream: converts ConverseCommandOutput → OpenAI Response', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchConverseRaw.mockResolvedValue({
      data: fakeConverseOutput,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockConverseOpenAIResponseProvider(dispatcher);

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

  it('stream: converts ConverseStream → ResponseStreamEvent iterable', async () => {
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
    const provider = new AWSBedrockConverseOpenAIResponseProvider(dispatcher);

    const result = await provider.handle(
      { ...baseRequest, stream: true },
      makeConnection(),
      makeModel()
    );
    const events: Array<{ type: string }> = [];
    for await (const ev of result.data as AsyncIterable<{ type: string }>) {
      events.push(ev);
    }
    expect(events.map((e) => e.type)).toContain('response.created');
    expect(events.map((e) => e.type)).toContain('response.completed');
    expect(dispatcher.dispatchConverseRaw.mock.calls[0][1]).toBe(true);
  });

  it('T22: appends performanceConfig from the connection', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchConverseRaw.mockResolvedValue({
      data: fakeConverseOutput,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockConverseOpenAIResponseProvider(dispatcher);

    await provider.handle(
      baseRequest,
      makeConnection({ performanceConfig: { latency: 'optimized' } } as never),
      makeModel()
    );
    const input = dispatcher.dispatchConverseRaw.mock.calls[0][0];
    expect(input.performanceConfig).toEqual({ latency: 'optimized' });
  });

  it('T21: appends guardrailConfig from the connection (default trace=enabled)', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchConverseRaw.mockResolvedValue({
      data: fakeConverseOutput,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockConverseOpenAIResponseProvider(dispatcher);

    await provider.handle(
      baseRequest,
      makeConnection({
        guardrailConfig: {
          guardrailIdentifier: 'gr-2',
          guardrailVersion: 'DRAFT',
        },
      } as never),
      makeModel()
    );
    const input = dispatcher.dispatchConverseRaw.mock.calls[0][0];
    expect(input.guardrailConfig).toEqual({
      guardrailIdentifier: 'gr-2',
      guardrailVersion: 'DRAFT',
      trace: 'enabled',
    });
  });

  it('T19: capability gate throws on tools + non-supporting model BEFORE the SDK call', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchConverseRaw.mockResolvedValue({
      data: fakeConverseOutput,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockConverseOpenAIResponseProvider(dispatcher);

    await expect(
      provider.handle(
        {
          ...baseRequest,
          tools: [
            {
              type: 'function',
              name: 't',
              parameters: { type: 'object' },
            },
          ],
        } as unknown as ResponseCreateParams,
        makeConnection(),
        { model: 'amazon.titan-text-large-v1' } as AIResourceModelConfigEntity
      )
    ).rejects.toMatchObject({
      data: expect.objectContaining({ statusCode: 400 }),
    });
    expect(dispatcher.dispatchConverseRaw).not.toHaveBeenCalled();
  });

  it('T19: tool_choice="none" with tools skips the gate', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchConverseRaw.mockResolvedValue({
      data: fakeConverseOutput,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockConverseOpenAIResponseProvider(dispatcher);

    await provider.handle(
      {
        ...baseRequest,
        tools: [
          { type: 'function', name: 't', parameters: { type: 'object' } },
        ],
        tool_choice: 'none',
      } as unknown as ResponseCreateParams,
      makeConnection(),
      { model: 'amazon.titan-text-large-v1' } as AIResourceModelConfigEntity
    );
    expect(dispatcher.dispatchConverseRaw).toHaveBeenCalledOnce();
  });
});
