import { describe, expect, it, vi } from 'vitest';
import type {
  ChatCompletion,
  ChatCompletionCreateParams,
} from 'openai/resources/index.js';
import { AnthropicOpenAICompletionProvider } from './openai-chat-completion.provider';
import type { AnthropicDispatcher } from './shared';
import type { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import type { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import type { AnthropicConnectionConfig } from './shared';

/**
 * Class-layer tests for {@link AnthropicOpenAICompletionProvider} —
 * the cross-format `openAICompletion` handler on the Anthropic
 * provider. Converts OpenAI body via the canonical
 * `openAIRequestToAnthropic` adapter, then delegates to
 * `dispatcher.dispatch` (the converting variant that returns
 * ChatCompletion shape). Adapter is covered by
 * `__integration__/anthropic/adapter.spec.ts`; this spec pins the
 * class's adapter-call → model-substitution → dispatch chain.
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
  dispatch: ReturnType<typeof vi.fn>;
} {
  return { dispatch: vi.fn() } as unknown as AnthropicDispatcher & {
    dispatch: ReturnType<typeof vi.fn>;
  };
}

const openAIRequest: ChatCompletionCreateParams = {
  model: 'will-be-replaced',
  messages: [
    { role: 'system', content: 'Be concise.' },
    { role: 'user', content: 'ping' },
  ],
};

describe('AnthropicOpenAICompletionProvider — class layer', () => {
  it('converts OpenAI request → Anthropic shape and substitutes model', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatch.mockResolvedValue({
      data: {} as ChatCompletion,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AnthropicOpenAICompletionProvider(dispatcher);

    await provider.handle(
      openAIRequest,
      makeConnection(),
      makeModel('claude-haiku-4-5')
    );
    const passedBody = dispatcher.dispatch.mock.calls[0][0];
    expect(passedBody.model).toBe('claude-haiku-4-5');
    // System prompt becomes the top-level Anthropic `system` field.
    expect(passedBody.system).toBeDefined();
    // User message survives.
    expect(passedBody.messages).toEqual([
      expect.objectContaining({ role: 'user' }),
    ]);
  });

  it('forwards options to the dispatcher (signal, maxRetries, forwardHeaders)', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatch.mockResolvedValue({
      data: {} as ChatCompletion,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AnthropicOpenAICompletionProvider(dispatcher);

    const ac = new AbortController();
    const options = {
      signal: ac.signal,
      maxRetries: 2,
      forwardHeaders: { 'anthropic-beta': 'pdfs-2024-09-25' },
    };
    await provider.handle(
      openAIRequest,
      makeConnection(),
      makeModel(),
      options
    );
    expect(dispatcher.dispatch.mock.calls[0][3]).toBe(options);
  });

  it('returns the dispatcher result (already converted to ChatCompletion shape)', async () => {
    const dispatcher = makeDispatcherStub();
    const result = {
      data: { id: 'cmpl_1', object: 'chat.completion' } as ChatCompletion,
      headers: { 'x-request-id': 'req-via-dispatcher' },
      providerRequestPayload: { model: 'claude-haiku-4-5' },
    };
    dispatcher.dispatch.mockResolvedValue(result as never);
    const provider = new AnthropicOpenAICompletionProvider(dispatcher);

    const out = await provider.handle(
      openAIRequest,
      makeConnection(),
      makeModel()
    );
    expect(out).toBe(result);
  });

  it('dispatcher errors propagate untouched', async () => {
    const dispatcher = makeDispatcherStub();
    const err = new Error('dispatch failed');
    dispatcher.dispatch.mockRejectedValue(err);
    const provider = new AnthropicOpenAICompletionProvider(dispatcher);

    await expect(
      provider.handle(openAIRequest, makeConnection(), makeModel())
    ).rejects.toBe(err);
  });
});
