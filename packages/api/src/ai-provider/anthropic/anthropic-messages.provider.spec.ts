import { describe, expect, it, vi } from 'vitest';
import { AnthropicMessagesProvider } from './anthropic-messages.provider';
import type { AnthropicDispatcher } from './shared';
import type { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import type { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import type { AnthropicConnectionConfig } from './shared';
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';

/**
 * Class-layer tests for {@link AnthropicMessagesProvider} — the
 * native passthrough handler. The class is small (`stripGatewayEnvelopes`
 * + `model` substitution + delegate to `dispatcher.dispatchNative`),
 * but the envelope-stripping invariant matters: native Anthropic
 * rejects unknown body fields with a 400. The dispatcher itself
 * (`AnthropicDispatcher`) has its own `shared.spec.ts`.
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

const baseRequest: AnthropicMessagesRequest = {
  model: 'will-be-replaced',
  max_tokens: 100,
  messages: [{ role: 'user', content: 'ping' }],
};

describe('AnthropicMessagesProvider — class layer', () => {
  it('substitutes model from the resource config (drops the request model)', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchNative.mockResolvedValue({
      data: {} as never,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AnthropicMessagesProvider(dispatcher);

    await provider.handle(
      baseRequest,
      makeConnection(),
      makeModel('claude-haiku-4-5')
    );
    const passedBody = dispatcher.dispatchNative.mock.calls[0][0];
    expect(passedBody.model).toBe('claude-haiku-4-5');
  });

  it('strips gateway vmx + __vmx_passthrough envelopes before dispatch', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchNative.mockResolvedValue({
      data: {} as never,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AnthropicMessagesProvider(dispatcher);

    const requestWithEnvelope = {
      ...baseRequest,
      vmx: { metrics: {}, events: [] },
      __vmx_passthrough: { anthropic: { top_k: 50 } },
    } as AnthropicMessagesRequest;
    await provider.handle(requestWithEnvelope, makeConnection(), makeModel());
    const passedBody = dispatcher.dispatchNative.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(passedBody).not.toHaveProperty('vmx');
    expect(passedBody).not.toHaveProperty('__vmx_passthrough');
  });

  it('preserves Anthropic-native fields (system, tools, thinking)', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchNative.mockResolvedValue({
      data: {} as never,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AnthropicMessagesProvider(dispatcher);

    await provider.handle(
      {
        ...baseRequest,
        system: 'You are concise.',
        tools: [
          { name: 't', description: 'd', input_schema: { type: 'object' } },
        ],
        thinking: { type: 'enabled', budget_tokens: 1000 },
      } as AnthropicMessagesRequest,
      makeConnection(),
      makeModel()
    );
    const passedBody = dispatcher.dispatchNative.mock.calls[0][0];
    expect(passedBody.system).toBe('You are concise.');
    expect(passedBody.tools).toHaveLength(1);
    expect(passedBody.thinking).toMatchObject({
      type: 'enabled',
      budget_tokens: 1000,
    });
  });

  it('forwards options (signal, maxRetries, forwardHeaders) to the dispatcher', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchNative.mockResolvedValue({
      data: {} as never,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AnthropicMessagesProvider(dispatcher);
    const ac = new AbortController();
    const options = {
      signal: ac.signal,
      maxRetries: 4,
      forwardHeaders: { 'anthropic-beta': 'computer-use-2025-01-24' },
    };
    await provider.handle(baseRequest, makeConnection(), makeModel(), options);
    expect(dispatcher.dispatchNative.mock.calls[0][3]).toBe(options);
  });

  it('returns dispatcher result verbatim (true passthrough)', async () => {
    const dispatcher = makeDispatcherStub();
    const dispatcherResult = {
      data: {
        id: 'msg_1',
        type: 'message',
        content: [{ type: 'text', text: 'pong' }],
      },
      headers: { 'x-request-id': 'req-1' },
      providerRequestPayload: { model: 'claude-haiku-4-5' },
    };
    dispatcher.dispatchNative.mockResolvedValue(dispatcherResult as never);
    const provider = new AnthropicMessagesProvider(dispatcher);

    const result = await provider.handle(
      baseRequest,
      makeConnection(),
      makeModel()
    );
    expect(result).toBe(dispatcherResult);
  });

  it('dispatcher errors propagate untouched (no swallowing)', async () => {
    const dispatcher = makeDispatcherStub();
    const dispatcherError = new Error('upstream down');
    dispatcher.dispatchNative.mockRejectedValue(dispatcherError);
    const provider = new AnthropicMessagesProvider(dispatcher);

    await expect(
      provider.handle(baseRequest, makeConnection(), makeModel())
    ).rejects.toBe(dispatcherError);
  });
});
