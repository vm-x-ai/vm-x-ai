import { describe, expect, it, vi } from 'vitest';
import type { ChatCompletionCreateParams } from 'openai/resources/index.js';
import { AWSBedrockInvokeOpenAICompletionProvider } from './openai-chat-completion.provider';
import type { AWSBedrockInvokeDispatcher } from './shared';
import type { AWSBedrockAIConnectionConfig } from '../aws-bedrock-base';
import type { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import type { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import type { AnthropicMessagesResponse } from '../../gateway/anthropic/anthropic.types';

/**
 * Class-layer tests for {@link AWSBedrockInvokeOpenAICompletionProvider}.
 *
 * Pipeline: OpenAI Chat Completions → canonical Anthropic (via shared
 * adapter, with `rejectExternalImageUrls: true` for T23 fidelity) →
 * Bedrock-Invoke wire shape (`anthropic_version` + strip `model`/`stream`)
 * → `dispatcher.dispatchNative` (native Anthropic response) → response
 * converted back to ChatCompletion shape inside the provider class.
 *
 * Adapter math is covered by `__integration__/anthropic/adapter.spec.ts`;
 * this spec pins the class's pipeline contract.
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

/**
 * Minimal valid `AnthropicMessagesResponse` the CC converter can read
 * without throwing. The class runs the native response through
 * `anthropicResponseToChatCompletion`, which walks `content[]` and
 * reads `usage` — return an empty content array + zeroed usage to
 * keep these tests focused on the wire-shape + dispatcher contract.
 */
function makeNativeResponse(): AnthropicMessagesResponse {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    container: null,
    model: 'claude',
    content: [],
    stop_reason: 'end_turn',
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      cache_creation: null,
      server_tool_use: null,
      service_tier: null,
      inference_geo: null,
    },
  } as unknown as AnthropicMessagesResponse;
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

const baseRequest: ChatCompletionCreateParams = {
  model: 'test',
  messages: [{ role: 'user', content: 'ping' }],
};

describe('AWSBedrockInvokeOpenAICompletionProvider — class layer', () => {
  it('produces Bedrock-Invoke wire shape: anthropic_version added, model/stream stripped', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchNative.mockResolvedValue({
      data: makeNativeResponse(),
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockInvokeOpenAICompletionProvider(dispatcher);

    await provider.handle(baseRequest, makeConnection(), makeModel());
    const wireBody = dispatcher.dispatchNative.mock.calls[0][0] as Record<
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
    const provider = new AWSBedrockInvokeOpenAICompletionProvider(dispatcher);

    // Streaming call — first, so the streaming-shaped mock is in place
    // BEFORE the call that consumes it. (The prior shape set the mock
    // after the call, so the streaming path was actually running the
    // non-streaming code path and the contract assertion that hit
    // `mock.calls[0][1] === true` only verified the boolean we passed,
    // not the converter wiring.)
    dispatcher.dispatchNative.mockResolvedValueOnce({
      data: (async function* () {
        /* no events */
      })(),
      headers: {},
      providerRequestPayload: {},
    });
    await provider.handle(
      { ...baseRequest, stream: true },
      makeConnection(),
      makeModel()
    );
    expect(dispatcher.dispatchNative.mock.calls[0][1]).toBe(true);

    // Non-streaming call — native message response shape.
    dispatcher.dispatchNative.mockResolvedValueOnce({
      data: makeNativeResponse(),
      headers: {},
      providerRequestPayload: {},
    });
    await provider.handle(baseRequest, makeConnection(), makeModel());
    expect(dispatcher.dispatchNative.mock.calls[1][1]).toBe(false);
  });

  it('T23: external image URL on the OpenAI body fails fast in the adapter', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchNative.mockResolvedValue({
      data: makeNativeResponse(),
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
    expect(dispatcher.dispatchNative).not.toHaveBeenCalled();
  });

  it('forwards connection + model + options to the dispatcher', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchNative.mockResolvedValue({
      data: makeNativeResponse(),
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockInvokeOpenAICompletionProvider(dispatcher);

    const ac = new AbortController();
    const options = { signal: ac.signal, maxRetries: 1 };
    const conn = makeConnection();
    const model = makeModel();
    await provider.handle(baseRequest, conn, model, options);
    const call = dispatcher.dispatchNative.mock.calls[0];
    expect(call[2]).toBe(conn);
    expect(call[3]).toBe(model);
    expect(call[4]).toBe(options);
  });

  it('returns a ChatCompletion shape (object: chat.completion) for the non-streaming path', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchNative.mockResolvedValue({
      data: makeNativeResponse(),
      headers: { 'x-request-id': 'req-1' },
      providerRequestPayload: { messages: [] },
    });
    const provider = new AWSBedrockInvokeOpenAICompletionProvider(dispatcher);
    const out = await provider.handle(
      baseRequest,
      makeConnection(),
      makeModel()
    );
    const cc = out.data as { object?: string; choices?: unknown[] };
    expect(cc.object).toBe('chat.completion');
    expect(Array.isArray(cc.choices)).toBe(true);
    expect(out.headers).toEqual({ 'x-request-id': 'req-1' });
  });
});
