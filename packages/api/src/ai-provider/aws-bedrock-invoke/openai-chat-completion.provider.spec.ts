import { describe, expect, it, vi } from 'vitest';
import type {
  ChatCompletion,
  ChatCompletionCreateParams,
} from 'openai/resources/index.js';
import { AWSBedrockInvokeOpenAICompletionProvider } from './openai-chat-completion.provider';
import type { AWSBedrockInvokeDispatcher } from './shared';
import type { AWSBedrockAIConnectionConfig } from '../aws-bedrock-base';
import type { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import type { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';

/**
 * Class-layer tests for {@link AWSBedrockInvokeOpenAICompletionProvider}.
 *
 * Pipeline: OpenAI Chat Completions → canonical Anthropic (via shared
 * adapter, with `rejectExternalImageUrls: true` for T23 fidelity) →
 * Bedrock-Invoke wire shape (`anthropic_version` + strip `model`/`stream`)
 * → `dispatcher.dispatch` (converting variant returning ChatCompletion).
 *
 * Adapter math is covered by `__integration__/anthropic/adapter.spec.ts`;
 * this spec pins the class's three-step pipeline.
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
  dispatch: ReturnType<typeof vi.fn>;
} {
  return { dispatch: vi.fn() } as unknown as AWSBedrockInvokeDispatcher & {
    dispatch: ReturnType<typeof vi.fn>;
  };
}

const baseRequest: ChatCompletionCreateParams = {
  model: 'test',
  messages: [{ role: 'user', content: 'ping' }],
};

describe('AWSBedrockInvokeOpenAICompletionProvider — class layer', () => {
  it('produces Bedrock-Invoke wire shape: anthropic_version added, model/stream stripped', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatch.mockResolvedValue({
      data: {} as ChatCompletion,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockInvokeOpenAICompletionProvider(dispatcher);

    await provider.handle(baseRequest, makeConnection(), makeModel());
    const wireBody = dispatcher.dispatch.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(wireBody.anthropic_version).toBeDefined();
    expect(wireBody).not.toHaveProperty('model');
    expect(wireBody).not.toHaveProperty('stream');
    // Anthropic-shape body has top-level `messages`.
    expect(Array.isArray(wireBody.messages)).toBe(true);
  });

  it('passes the streaming flag based on request.stream', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatch.mockResolvedValue({
      data: {} as ChatCompletion,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockInvokeOpenAICompletionProvider(dispatcher);

    await provider.handle(
      { ...baseRequest, stream: true },
      makeConnection(),
      makeModel()
    );
    expect(dispatcher.dispatch.mock.calls[0][1]).toBe(true);

    await provider.handle(baseRequest, makeConnection(), makeModel());
    expect(dispatcher.dispatch.mock.calls[1][1]).toBe(false);
  });

  it('T23: external image URL on the OpenAI body fails fast in the adapter', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatch.mockResolvedValue({
      data: {} as ChatCompletion,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockInvokeOpenAICompletionProvider(dispatcher);

    await expect(
      provider.handle(
        {
          ...baseRequest,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: { url: 'https://example.com/cat.png' },
                },
              ],
            },
          ],
        } as ChatCompletionCreateParams,
        makeConnection(),
        makeModel()
      )
    ).rejects.toThrow();
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('forwards connection + model + options to the dispatcher', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatch.mockResolvedValue({
      data: {} as ChatCompletion,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockInvokeOpenAICompletionProvider(dispatcher);

    const ac = new AbortController();
    const options = { signal: ac.signal, maxRetries: 1 };
    const conn = makeConnection();
    const model = makeModel();
    await provider.handle(baseRequest, conn, model, options);
    const call = dispatcher.dispatch.mock.calls[0];
    expect(call[2]).toBe(conn);
    expect(call[3]).toBe(model);
    expect(call[4]).toBe(options);
  });
});
