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

  it('preserves every MessageCreateParams field on the dispatched body (request-side fidelity sweep)', async () => {
    // The class is passthrough, but the audit exists to catch any
    // future regression that silently filters a field on its way
    // through. This single sweep covers every top-level field the
    // Anthropic SDK accepts on the stable `/v1/messages` route so the
    // class layer keeps an exhaustive guard.
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchNative.mockResolvedValue({
      data: {} as never,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AnthropicMessagesProvider(dispatcher);

    const exhaustive = {
      model: 'will-be-replaced',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'hello',
              cache_control: { type: 'ephemeral' },
            },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: 'iVBORw0KGgo=',
              },
            },
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: 'JVBERi0=',
              },
            },
          ],
        },
        {
          role: 'assistant',
          content: [
            {
              type: 'thinking',
              thinking: 'reasoning trace',
              signature: 'sig',
            },
            { type: 'text', text: 'sure' },
            {
              type: 'tool_use',
              id: 'tu_1',
              name: 'get_weather',
              input: { location: 'Tokyo' },
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_1',
              content: [
                { type: 'text', text: '15C' },
                {
                  type: 'image',
                  source: { type: 'url', url: 'https://example/img.png' },
                },
              ],
            },
          ],
        },
      ],
      system: [
        {
          type: 'text',
          text: 'be concise',
          cache_control: { type: 'ephemeral' },
        },
      ],
      metadata: { user_id: 'usr_1' },
      service_tier: 'standard_only',
      stop_sequences: ['END'],
      temperature: 0.5,
      top_k: 40,
      top_p: 0.95,
      thinking: { type: 'enabled', budget_tokens: 1024 },
      tool_choice: { type: 'any', disable_parallel_tool_use: true },
      tools: [
        { name: 'get_weather', input_schema: { type: 'object' } },
        { type: 'web_search_20250305', name: 'web_search' },
        { type: 'bash_20250124', name: 'bash' },
      ],
      stream: false,
      container: 'cnt_1',
      inference_geo: 'us',
      betas: ['interleaved-thinking-2025-05-14'],
      mcp_servers: [
        { type: 'url', url: 'https://mcp.example/api', name: 'mcp1' },
      ],
      context_management: {
        edits: [{ type: 'clear_tool_uses' }],
      },
    } as unknown as AnthropicMessagesRequest;
    await provider.handle(
      exhaustive,
      makeConnection(),
      makeModel('claude-haiku-4-5')
    );
    const passed = dispatcher.dispatchNative.mock.calls[0][0];
    // Every field above must be present (model is overridden to the
    // resource model — that's a documented passthrough adjustment).
    expect(passed.model).toBe('claude-haiku-4-5');
    expect(passed.max_tokens).toBe(1024);
    expect(passed.messages).toEqual(exhaustive.messages);
    expect(passed.system).toEqual(exhaustive.system);
    expect(passed.metadata).toEqual(exhaustive.metadata);
    expect(passed.service_tier).toBe('standard_only');
    expect(passed.stop_sequences).toEqual(['END']);
    expect(passed.temperature).toBe(0.5);
    expect(passed.top_k).toBe(40);
    expect(passed.top_p).toBe(0.95);
    expect(passed.thinking).toEqual({ type: 'enabled', budget_tokens: 1024 });
    expect(passed.tool_choice).toEqual({
      type: 'any',
      disable_parallel_tool_use: true,
    });
    expect(passed.tools).toEqual(exhaustive.tools);
    expect(passed.stream).toBe(false);
    expect((passed as { container?: string }).container).toBe('cnt_1');
    expect((passed as { inference_geo?: string }).inference_geo).toBe('us');
    expect((passed as { betas?: string[] }).betas).toEqual([
      'interleaved-thinking-2025-05-14',
    ]);
    expect((passed as { mcp_servers?: unknown[] }).mcp_servers).toEqual(
      exhaustive.mcp_servers
    );
    expect(
      (passed as { context_management?: unknown }).context_management
    ).toEqual(exhaustive.context_management);
  });

  it('shallow-copies the request — caller-mutating the input is OK after handle', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchNative.mockResolvedValue({
      data: {} as never,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AnthropicMessagesProvider(dispatcher);
    const req: AnthropicMessagesRequest = {
      model: 'wire',
      max_tokens: 8,
      messages: [{ role: 'user', content: 'ping' }],
    };
    await provider.handle(req, makeConnection(), makeModel('claude-haiku-4-5'));
    // The caller's model field MUST NOT have been mutated to the
    // resource model — passthrough means the request reference stays
    // clean for the caller's retries / logging.
    expect(req.model).toBe('wire');
    expect(dispatcher.dispatchNative.mock.calls[0][0]).not.toBe(req);
  });
});
