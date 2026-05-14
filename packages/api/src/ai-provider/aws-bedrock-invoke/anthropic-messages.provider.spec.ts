import { describe, expect, it, vi } from 'vitest';
import type { Message as AnthropicMessage } from '@anthropic-ai/sdk/resources/messages';
import { AWSBedrockInvokeAnthropicMessagesProvider } from './anthropic-messages.provider';
import type { AWSBedrockInvokeDispatcher } from './shared';
import type { AWSBedrockAIConnectionConfig } from '../aws-bedrock-base';
import type { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import type { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';

/**
 * Class-layer tests for {@link AWSBedrockInvokeAnthropicMessagesProvider}.
 *
 * The Anthropic-input handler is a thin wrap around the wire-shape
 * adapter (`canonicalAnthropicToBedrockInvoke`) + `dispatchNative`,
 * with one critical pre-flight: T23 rejects external image URLs
 * before the SDK call (Bedrock-Invoke can't fetch them, otherwise it
 * surfaces an opaque 400). The dispatcher's AWS event-stream parser
 * is covered separately by `shared.spec.ts`.
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

const fakeMessage: AnthropicMessage = {
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-haiku-4-5',
  content: [{ type: 'text', text: 'pong', citations: null }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 5, output_tokens: 1 },
} as unknown as AnthropicMessage;

const baseRequest: AnthropicMessagesRequest = {
  model: 'claude-haiku-4-5',
  max_tokens: 100,
  messages: [{ role: 'user', content: 'ping' }],
};

describe('AWSBedrockInvokeAnthropicMessagesProvider — class layer', () => {
  it('reshapes to Bedrock-Invoke wire shape: anthropic_version added, model + stream stripped', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchNative.mockResolvedValue({
      data: fakeMessage,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockInvokeAnthropicMessagesProvider(dispatcher);

    await provider.handle(
      { ...baseRequest, stream: true },
      makeConnection(),
      makeModel()
    );
    const wireBody = dispatcher.dispatchNative.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(wireBody.anthropic_version).toBeDefined();
    // Bedrock-Invoke addresses the model via the InvokeModel command's
    // modelId — the body MUST NOT carry it (the SDK 400s otherwise).
    expect(wireBody).not.toHaveProperty('model');
    expect(wireBody).not.toHaveProperty('stream');
  });

  it('passes streaming flag as the second arg to dispatchNative', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchNative.mockResolvedValue({
      data: fakeMessage,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockInvokeAnthropicMessagesProvider(dispatcher);

    await provider.handle(
      { ...baseRequest, stream: true },
      makeConnection(),
      makeModel()
    );
    expect(dispatcher.dispatchNative.mock.calls[0][1]).toBe(true);

    await provider.handle(baseRequest, makeConnection(), makeModel());
    expect(dispatcher.dispatchNative.mock.calls[1][1]).toBe(false);
  });

  it('T23: rejects external image URLs BEFORE the SDK call with a 400', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchNative.mockResolvedValue({
      data: fakeMessage,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockInvokeAnthropicMessagesProvider(dispatcher);

    await expect(
      provider.handle(
        {
          ...baseRequest,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'url',
                    url: 'https://example.com/cat.png',
                  },
                } as never,
              ],
            },
          ],
        } as AnthropicMessagesRequest,
        makeConnection(),
        makeModel()
      )
    ).rejects.toMatchObject({
      data: expect.objectContaining({
        statusCode: 400,
        retryable: false,
        openAICompatibleError: expect.objectContaining({
          code: 'aws_bedrock_invoke_image_url_unsupported',
        }),
      }),
    });
    expect(dispatcher.dispatchNative).not.toHaveBeenCalled();
  });

  it('T23: base64 + file_id image sources pass the gate', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchNative.mockResolvedValue({
      data: fakeMessage,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockInvokeAnthropicMessagesProvider(dispatcher);

    await provider.handle(
      {
        ...baseRequest,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
                },
              } as never,
            ],
          },
        ],
      } as AnthropicMessagesRequest,
      makeConnection(),
      makeModel()
    );
    expect(dispatcher.dispatchNative).toHaveBeenCalledOnce();
  });

  it('forwards options + connection + model to the dispatcher', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchNative.mockResolvedValue({
      data: fakeMessage,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockInvokeAnthropicMessagesProvider(dispatcher);

    const ac = new AbortController();
    const options = { signal: ac.signal, maxRetries: 3 };
    const conn = makeConnection();
    const model = makeModel();
    await provider.handle(baseRequest, conn, model, options);
    const call = dispatcher.dispatchNative.mock.calls[0];
    expect(call[2]).toBe(conn);
    expect(call[3]).toBe(model);
    expect(call[4]).toBe(options);
  });

  it('returns dispatcher result verbatim (true passthrough)', async () => {
    const dispatcher = makeDispatcherStub();
    const result = {
      data: fakeMessage,
      headers: { 'x-request-id': 'req-1' },
      providerRequestPayload: { anthropic_version: 'bedrock-2023-05-31' },
    };
    dispatcher.dispatchNative.mockResolvedValue(result as never);
    const provider = new AWSBedrockInvokeAnthropicMessagesProvider(dispatcher);

    const out = await provider.handle(
      baseRequest,
      makeConnection(),
      makeModel()
    );
    expect(out).toBe(result);
  });

  it('passes through every canonical Anthropic field intact (sampling, system, tools, thinking, …)', async () => {
    // Pin the audit invariant: Anthropic-side fields that Bedrock
    // InvokeModel accepts must arrive on the wire body untouched
    // (`model` / `stream` / gateway envelopes are stripped, and
    // Bedrock-Invoke-rejected fields — `mcp_servers`, `container`,
    // `context_management`, `inference_geo` — are silently stripped
    // because the InvokeModel API 400s on them, see the separate
    // assertion below). A regression on the kept fields would silently
    // drop caller intent — e.g. a structured-output request losing
    // its `output_config`, or a cache-control breakpoint going missing.
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchNative.mockResolvedValue({
      data: fakeMessage,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockInvokeAnthropicMessagesProvider(dispatcher);

    const richRequest = {
      ...baseRequest,
      system: 'You are a helpful assistant.',
      temperature: 0.7,
      top_p: 0.95,
      top_k: 40,
      stop_sequences: ['<END>'],
      metadata: { user_id: 'u_1' },
      thinking: { type: 'enabled', budget_tokens: 1024 },
      tools: [
        {
          name: 'get_weather',
          description: 'Get the weather',
          input_schema: {
            type: 'object',
            properties: { city: { type: 'string' } },
          },
        },
      ],
      tool_choice: { type: 'auto' },
      service_tier: 'standard_only',
      mcp_servers: [{ type: 'url', url: 'https://x', name: 'x' }],
      context_management: { edits: [{ type: 'clear_tool_uses_20250919' }] },
      inference_geo: 'us',
      output_config: { format: { type: 'json_schema', schema: {} } },
      container: 'cnt_1',
      cache_control: { type: 'ephemeral' },
    } as unknown as AnthropicMessagesRequest;
    await provider.handle(richRequest, makeConnection(), makeModel());

    const wireBody = dispatcher.dispatchNative.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(wireBody.anthropic_version).toBe('bedrock-2023-05-31');
    for (const key of [
      'system',
      'temperature',
      'top_p',
      'top_k',
      'stop_sequences',
      'metadata',
      'thinking',
      'tools',
      'tool_choice',
      'service_tier',
      'output_config',
      'cache_control',
      'max_tokens',
      'messages',
    ]) {
      expect(wireBody).toHaveProperty(key);
    }
    expect(wireBody).not.toHaveProperty('model');
    expect(wireBody).not.toHaveProperty('stream');
    // Bedrock-Invoke-rejected fields (silent strip in the adapter)
    expect(wireBody).not.toHaveProperty('mcp_servers');
    expect(wireBody).not.toHaveProperty('container');
    expect(wireBody).not.toHaveProperty('context_management');
    expect(wireBody).not.toHaveProperty('inference_geo');
  });

  it('re-emits `betas` as `anthropic_beta` on the Bedrock wire body', async () => {
    // Bedrock-Invoke's Anthropic body uses `anthropic_beta` (not the
    // canonical `betas` field name). The adapter lifts it; verify the
    // class path keeps that lift intact end-to-end.
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchNative.mockResolvedValue({
      data: fakeMessage,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockInvokeAnthropicMessagesProvider(dispatcher);

    await provider.handle(
      {
        ...baseRequest,
        betas: ['interleaved-thinking-2025-05-14'],
      } as AnthropicMessagesRequest,
      makeConnection(),
      makeModel()
    );

    const wireBody = dispatcher.dispatchNative.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(wireBody).not.toHaveProperty('betas');
    expect(wireBody.anthropic_beta).toEqual([
      'interleaved-thinking-2025-05-14',
    ]);
  });

  it('strips gateway scaffolding (vmx / __vmx_passthrough) before the SDK call', async () => {
    // Defensive: the Anthropic-input path is supposed to receive
    // already-Anthropic-shape bodies, but callers occasionally hand
    // the gateway's internal envelopes through (e.g. when re-using a
    // canonical body built by the converter). Bedrock 400s on unknown
    // top-level fields, so this MUST be stripped on the wire.
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchNative.mockResolvedValue({
      data: fakeMessage,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockInvokeAnthropicMessagesProvider(dispatcher);

    await provider.handle(
      {
        ...baseRequest,
        vmx: { correlationId: 'corr-1' },
        __vmx_passthrough: { anthropic: { top_k: 5 } },
      } as unknown as AnthropicMessagesRequest,
      makeConnection(),
      makeModel()
    );

    const wireBody = dispatcher.dispatchNative.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(wireBody).not.toHaveProperty('vmx');
    expect(wireBody).not.toHaveProperty('__vmx_passthrough');
  });

  it('forwards Anthropic server tools (BashTool / WebSearchTool / etc.) on the wire body', async () => {
    // Server-tool definitions are part of the canonical Anthropic
    // tools[] union. Bedrock-Invoke speaks Anthropic on the wire, so
    // the gateway forwards them verbatim — the model decides server-
    // side whether a given tool is supported. Pin the passthrough so
    // a future "strip unsupported tools" optimisation doesn't silently
    // erase caller intent.
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchNative.mockResolvedValue({
      data: fakeMessage,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockInvokeAnthropicMessagesProvider(dispatcher);

    const tools = [
      { type: 'web_search_20250305', name: 'web_search' },
      { type: 'bash_20250124', name: 'bash' },
      {
        type: 'text_editor_20250728',
        name: 'str_replace_based_edit_tool',
      },
    ];
    await provider.handle(
      {
        ...baseRequest,
        tools: tools as never,
      } as AnthropicMessagesRequest,
      makeConnection(),
      makeModel()
    );

    const wireBody = dispatcher.dispatchNative.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(wireBody.tools).toEqual(tools);
  });
});
