import { describe, expect, it, vi } from 'vitest';
import type {
  ChatCompletion,
  ChatCompletionCreateParams,
} from 'openai/resources/index.js';
import { AWSBedrockConverseOpenAICompletionProvider } from './openai-chat-completion.provider';
import type { AWSBedrockConverseDispatcher } from './shared';
import type { AWSBedrockAIConnectionConfig } from './shared';
import type { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import type { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';

/**
 * Class-layer tests for {@link AWSBedrockConverseOpenAICompletionProvider}.
 * Thin wrapper around `dispatcher.completion` — assert delegation +
 * payload pass-through.
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
  completion: ReturnType<typeof vi.fn>;
} {
  return { completion: vi.fn() } as unknown as AWSBedrockConverseDispatcher & {
    completion: ReturnType<typeof vi.fn>;
  };
}

const baseRequest: ChatCompletionCreateParams = {
  model: 'test',
  messages: [{ role: 'user', content: 'ping' }],
};

describe('AWSBedrockConverseOpenAICompletionProvider — class layer', () => {
  it('delegates to dispatcher.completion with all four arguments', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.completion.mockResolvedValue({
      data: {} as ChatCompletion,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockConverseOpenAICompletionProvider(dispatcher);
    const ac = new AbortController();
    const options = { signal: ac.signal, maxRetries: 2 };

    await provider.handle(baseRequest, makeConnection(), makeModel(), options);
    expect(dispatcher.completion).toHaveBeenCalledOnce();
    const call = dispatcher.completion.mock.calls[0];
    expect(call[0]).toBe(baseRequest);
    expect(call[3]).toBe(options);
  });

  it('passes through providerRequestPayload + headers from the dispatcher', async () => {
    const dispatcher = makeDispatcherStub();
    const result = {
      data: { id: 'cmpl_1', object: 'chat.completion' } as ChatCompletion,
      headers: { 'x-request-id': 'req-1' },
      providerRequestPayload: {
        modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
        messages: [],
      },
    };
    dispatcher.completion.mockResolvedValue(result as never);
    const provider = new AWSBedrockConverseOpenAICompletionProvider(dispatcher);

    const out = await provider.handle(
      baseRequest,
      makeConnection(),
      makeModel()
    );
    expect(out.data).toBe(result.data);
    expect(out.headers).toEqual({ 'x-request-id': 'req-1' });
    expect(out.providerRequestPayload).toBe(result.providerRequestPayload);
  });

  it('dispatcher errors propagate untouched', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.completion.mockRejectedValue(new Error('aws down'));
    const provider = new AWSBedrockConverseOpenAICompletionProvider(dispatcher);

    await expect(
      provider.handle(baseRequest, makeConnection(), makeModel())
    ).rejects.toThrow('aws down');
  });
});
