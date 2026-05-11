import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PinoLogger } from 'nestjs-pino';

// Mock the SDK so `new Anthropic({apiKey})` returns a stub whose
// `messages.create` / `messages.stream` are programmable per-test.
// `importOriginal` preserves the real `APIError` / `RateLimitError`
// classes — the dispatcher's error mapping uses `instanceof` against
// them, so we can't shadow them with a fresh class.
const sdkSpies = {
  create:
    vi.fn<(body: unknown, sdkOptions: Record<string, unknown>) => unknown>(),
  stream:
    vi.fn<(body: unknown, sdkOptions: Record<string, unknown>) => unknown>(),
};
vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const original = await importOriginal<typeof import('@anthropic-ai/sdk')>();
  class MockAnthropic {
    messages = {
      create: (body: unknown, sdkOptions: Record<string, unknown>) => {
        const result = sdkSpies.create(body, sdkOptions);
        return {
          withResponse: () =>
            result instanceof Error ? Promise.reject(result) : result,
        };
      },
      stream: (body: unknown, sdkOptions: Record<string, unknown>) => {
        return sdkSpies.stream(body, sdkOptions);
      },
    };
  }
  return {
    ...original,
    default: MockAnthropic,
  };
});

import { APIError, RateLimitError } from '@anthropic-ai/sdk';
import type {
  Message,
  RawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages';
import {
  AnthropicDispatcher,
  filterAnthropicHeaders,
  handleAnthropicError,
  stripGatewayEnvelopes,
} from './shared';
import { CompletionError } from '../../gateway/completion.types';
import type { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import type { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import type { AnthropicConnectionConfig } from './shared';
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';

/**
 * Tests for the Anthropic dispatcher + helpers in `shared.ts`.
 *
 * The dispatcher is where the SDK call actually lands, and where the
 * load-bearing T-fixes live: T4 (`.withResponse()` so headers come
 * back), T9 (`liftBetasToHeader` — native Anthropic rejects `betas`
 * on the body so it must lift to the `anthropic-beta` HTTP header),
 * T18 (caller-header forwarding), and the streaming error wrap that
 * keeps `providerRequestPayload` on every error path.
 */

function makeLogger(): PinoLogger {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    setContext: vi.fn(),
  } as unknown as PinoLogger;
}

function makeConnection(): AIConnectionEntity<AnthropicConnectionConfig> {
  return {
    connectionId: 'conn-1',
    config: { apiKey: 'sk-ant-test' },
  } as unknown as AIConnectionEntity<AnthropicConnectionConfig>;
}

function makeModel(model = 'claude-haiku-4-5'): AIResourceModelConfigEntity {
  return { model } as AIResourceModelConfigEntity;
}

const baseRequest: AnthropicMessagesRequest = {
  model: 'claude-haiku-4-5',
  max_tokens: 100,
  messages: [{ role: 'user', content: 'ping' }],
};

const fakeMessage: Message = {
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-haiku-4-5',
  content: [{ type: 'text', text: 'pong', citations: null }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 5, output_tokens: 1 },
} as unknown as Message;

/** Per-test programmable shim around the mocked SDK. */
function patchAnthropicSdk(opts: {
  create?: (body: unknown, sdkOptions: Record<string, unknown>) => unknown;
  stream?: (body: unknown, sdkOptions: Record<string, unknown>) => unknown;
}): void {
  sdkSpies.create.mockReset();
  sdkSpies.stream.mockReset();
  if (opts.create) sdkSpies.create.mockImplementation(opts.create);
  if (opts.stream) sdkSpies.stream.mockImplementation(opts.stream);
}

describe('stripGatewayEnvelopes', () => {
  it('strips vmx + __vmx_passthrough', () => {
    const out = stripGatewayEnvelopes({
      ...baseRequest,
      vmx: { metrics: {} },
      __vmx_passthrough: { anthropic: { top_k: 50 } },
    } as AnthropicMessagesRequest);
    expect(out).not.toHaveProperty('vmx');
    expect(out).not.toHaveProperty('__vmx_passthrough');
    expect(out.messages).toEqual(baseRequest.messages);
  });
});

describe('filterAnthropicHeaders', () => {
  it('maps anthropic-ratelimit-* → x-ratelimit-* (OpenAI-shape)', () => {
    const headers = new Headers({
      'anthropic-ratelimit-tokens-limit': '4000000',
      'anthropic-ratelimit-requests-limit': '4000',
      'anthropic-ratelimit-tokens-reset': '2026-05-10T00:00:00Z',
      'anthropic-ratelimit-requests-reset': '2026-05-10T00:00:00Z',
      'x-request-id': 'req-1',
      'content-type': 'application/json',
    });
    const out = filterAnthropicHeaders(headers);
    expect(out['x-ratelimit-limit-tokens']).toBe('4000000');
    expect(out['x-ratelimit-limit-requests']).toBe('4000');
    expect(out['x-ratelimit-reset-tokens']).toBe('2026-05-10T00:00:00Z');
    expect(out['x-ratelimit-reset-requests']).toBe('2026-05-10T00:00:00Z');
    expect(out['x-request-id']).toBe('req-1');
    expect(out).not.toHaveProperty('content-type');
  });

  it('returns {} for undefined headers', () => {
    expect(filterAnthropicHeaders(undefined)).toEqual({});
  });
});

describe('handleAnthropicError', () => {
  it('RateLimitError → CompletionError(rate:true, retryable:true)', () => {
    const err = Object.assign(
      new RateLimitError(429, undefined, 'rate', new Headers()),
      { headers: new Headers() }
    );
    const payload = { model: 'claude-haiku-4-5' };
    expect(() => handleAnthropicError(err, payload, makeLogger())).toThrowError(
      CompletionError
    );
    try {
      handleAnthropicError(err, payload, makeLogger());
    } catch (e) {
      expect(e).toBeInstanceOf(CompletionError);
      expect((e as CompletionError).data).toMatchObject({
        rate: true,
        retryable: true,
        statusCode: 429,
        providerRequestPayload: payload,
      });
    }
  });

  it('APIError(503) → retryable:true with providerRequestPayload', () => {
    const err = Object.assign(
      new APIError(503, undefined, 'down', new Headers()),
      {
        status: 503,
        headers: new Headers(),
        error: { error: { type: 'overloaded' } },
      }
    );
    try {
      handleAnthropicError(err, { foo: 'bar' }, makeLogger());
    } catch (e) {
      expect((e as CompletionError).data).toMatchObject({
        rate: false,
        retryable: true,
        statusCode: 503,
        providerRequestPayload: { foo: 'bar' },
      });
    }
  });

  it('non-APIError → CompletionError(retryable:false, status:500)', () => {
    try {
      handleAnthropicError(new Error('boom'), { x: 1 }, makeLogger());
    } catch (e) {
      expect((e as CompletionError).data).toMatchObject({
        rate: false,
        retryable: false,
        statusCode: 500,
        message: 'boom',
        providerRequestPayload: { x: 1 },
      });
    }
  });
});

describe('AnthropicDispatcher.dispatchNative', () => {
  let dispatcher: AnthropicDispatcher;

  beforeEach(() => {
    dispatcher = new AnthropicDispatcher(makeLogger());
  });

  it('non-streaming: returns Message verbatim + x-request-id from SDK request_id', async () => {
    patchAnthropicSdk({
      create: () =>
        Promise.resolve({
          data: fakeMessage,
          response: { headers: new Headers() },
          request_id: 'req-anth-1',
        }),
    });
    const result = await dispatcher.dispatchNative(
      baseRequest,
      makeConnection(),
      makeModel()
    );
    expect(result.data).toBe(fakeMessage);
    expect(result.headers['x-request-id']).toBe('req-anth-1');
    expect(result.providerRequestPayload).toEqual(baseRequest);
  });

  it('lifts `betas` off the body to anthropic-beta header (T9)', async () => {
    let capturedBody: unknown;
    let capturedHeaders: Record<string, string> | undefined;
    patchAnthropicSdk({
      create: (body, sdkOptions) => {
        capturedBody = body;
        capturedHeaders = sdkOptions.headers as Record<string, string>;
        return Promise.resolve({
          data: fakeMessage,
          response: { headers: new Headers() },
        });
      },
    });
    await dispatcher.dispatchNative(
      {
        ...baseRequest,
        betas: ['interleaved-thinking-2025-05-14', 'pdfs-2024-09-25'],
      } as AnthropicMessagesRequest,
      makeConnection(),
      makeModel()
    );
    expect(capturedBody).not.toHaveProperty('betas');
    expect(capturedHeaders).toEqual({
      'anthropic-beta': 'interleaved-thinking-2025-05-14,pdfs-2024-09-25',
    });
  });

  it('appends to caller-supplied anthropic-beta header instead of overwriting', async () => {
    let capturedHeaders: Record<string, string> | undefined;
    patchAnthropicSdk({
      create: (_body, sdkOptions) => {
        capturedHeaders = sdkOptions.headers as Record<string, string>;
        return Promise.resolve({
          data: fakeMessage,
          response: { headers: new Headers() },
        });
      },
    });
    await dispatcher.dispatchNative(
      {
        ...baseRequest,
        betas: ['feature-A'],
      } as AnthropicMessagesRequest,
      makeConnection(),
      makeModel(),
      { forwardHeaders: { 'anthropic-beta': 'caller-beta' } }
    );
    expect(capturedHeaders?.['anthropic-beta']).toBe('caller-beta,feature-A');
  });

  it('forwards caller headers (T18) to the SDK', async () => {
    let capturedHeaders: Record<string, string> | undefined;
    patchAnthropicSdk({
      create: (_body, sdkOptions) => {
        capturedHeaders = sdkOptions.headers as Record<string, string>;
        return Promise.resolve({
          data: fakeMessage,
          response: { headers: new Headers() },
        });
      },
    });
    await dispatcher.dispatchNative(
      baseRequest,
      makeConnection(),
      makeModel(),
      { forwardHeaders: { 'anthropic-version': '2023-06-01', 'X-Custom': 'v' } }
    );
    expect(capturedHeaders).toMatchObject({
      'anthropic-version': '2023-06-01',
      'X-Custom': 'v',
    });
  });

  it('non-streaming: filters anthropic-ratelimit-* response headers (T4)', async () => {
    const respHeaders = new Headers({
      'anthropic-ratelimit-tokens-limit': '500000',
      'x-request-id': 'req-1',
    });
    patchAnthropicSdk({
      create: () =>
        Promise.resolve({
          data: fakeMessage,
          response: { headers: respHeaders },
        }),
    });
    const result = await dispatcher.dispatchNative(
      baseRequest,
      makeConnection(),
      makeModel()
    );
    expect(result.headers['x-ratelimit-limit-tokens']).toBe('500000');
    expect(result.headers['x-request-id']).toBe('req-1');
  });

  it('streaming: yields events verbatim and surfaces request_id', async () => {
    async function* fakeStream() {
      yield { type: 'message_start' } as RawMessageStreamEvent;
      yield {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'pong' },
      } as unknown as RawMessageStreamEvent;
      yield { type: 'message_stop' } as RawMessageStreamEvent;
    }
    const stream = fakeStream() as AsyncIterable<RawMessageStreamEvent> & {
      request_id?: string;
    };
    Object.assign(stream, { request_id: 'req-stream-1' });

    patchAnthropicSdk({ stream: () => stream });

    const result = await dispatcher.dispatchNative(
      { ...baseRequest, stream: true } as AnthropicMessagesRequest,
      makeConnection(),
      makeModel()
    );
    expect(result.headers['x-request-id']).toBe('req-stream-1');
    const events: RawMessageStreamEvent[] = [];
    for await (const ev of result.data as AsyncIterable<RawMessageStreamEvent>) {
      events.push(ev);
    }
    expect(events.map((e) => e.type)).toEqual([
      'message_start',
      'content_block_delta',
      'message_stop',
    ]);
  });

  it('streaming: mid-stream errors map to CompletionError with providerRequestPayload', async () => {
    async function* failing() {
      yield { type: 'message_start' } as RawMessageStreamEvent;
      throw Object.assign(
        new APIError(500, undefined, 'mid-stream boom', new Headers()),
        { status: 500, headers: new Headers() }
      );
    }
    patchAnthropicSdk({ stream: () => failing() });

    const result = await dispatcher.dispatchNative(
      { ...baseRequest, stream: true } as AnthropicMessagesRequest,
      makeConnection(),
      makeModel()
    );
    let caught: unknown;
    try {
      for await (const _ev of result.data as AsyncIterable<RawMessageStreamEvent>) {
        void _ev;
      }
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CompletionError);
    expect(
      (caught as CompletionError).data.providerRequestPayload
    ).toMatchObject({ stream: true });
  });

  it('non-streaming SDK error → CompletionError via handleAnthropicError', async () => {
    const err = Object.assign(
      new APIError(400, undefined, 'bad', new Headers()),
      {
        status: 400,
        headers: new Headers(),
        error: { error: { type: 'invalid_request' } },
      }
    );
    patchAnthropicSdk({ create: () => Promise.reject(err) });

    await expect(
      dispatcher.dispatchNative(baseRequest, makeConnection(), makeModel())
    ).rejects.toMatchObject({
      data: expect.objectContaining({
        rate: false,
        retryable: false,
        statusCode: 400,
        providerRequestPayload: baseRequest,
      }),
    });
  });

  it('preserves existing providerRequestPayload on a CompletionError thrown by the adapter', async () => {
    // assertClaudeModel (called inside dispatchNative) throws a
    // CompletionError on a non-Claude model. The dispatcher must NOT
    // overwrite a payload that the adapter already attached, but if
    // the adapter left it undefined the dispatcher fills it.
    const err = new CompletionError({
      rate: false,
      retryable: false,
      statusCode: 400,
      message: 'preset',
      failureReason: 'External API error',
      openAICompatibleError: { code: 'invalid_request' },
      providerRequestPayload: { preset: true },
    });
    patchAnthropicSdk({ create: () => Promise.reject(err) });
    await expect(
      dispatcher.dispatchNative(baseRequest, makeConnection(), makeModel())
    ).rejects.toMatchObject({
      data: expect.objectContaining({
        providerRequestPayload: { preset: true },
      }),
    });
  });
});

describe('AnthropicDispatcher.dispatch (converting variant)', () => {
  let dispatcher: AnthropicDispatcher;

  beforeEach(() => {
    dispatcher = new AnthropicDispatcher(makeLogger());
  });

  it('non-streaming: converts Anthropic Message → ChatCompletion shape', async () => {
    patchAnthropicSdk({
      create: () =>
        Promise.resolve({
          data: fakeMessage,
          response: { headers: new Headers() },
          request_id: 'req-1',
        }),
    });
    const result = await dispatcher.dispatch(
      baseRequest,
      makeConnection(),
      makeModel('claude-haiku-4-5')
    );
    const data = result.data as { object: string; choices: unknown[] };
    expect(data.object).toBe('chat.completion');
    expect(Array.isArray(data.choices)).toBe(true);
    expect(data.choices.length).toBeGreaterThan(0);
  });

  it('streaming: converts RawMessageStreamEvent iterable → ChatCompletionChunk iterable', async () => {
    async function* fakeStream() {
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
      } as unknown as RawMessageStreamEvent;
      yield {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'pong' },
      } as unknown as RawMessageStreamEvent;
      yield {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 1 },
      } as unknown as RawMessageStreamEvent;
      yield { type: 'message_stop' } as RawMessageStreamEvent;
    }
    const stream = fakeStream() as AsyncIterable<RawMessageStreamEvent> & {
      request_id?: string;
    };
    Object.assign(stream, { request_id: 'req-stream-1' });
    patchAnthropicSdk({ stream: () => stream });

    const result = await dispatcher.dispatch(
      { ...baseRequest, stream: true } as AnthropicMessagesRequest,
      makeConnection(),
      makeModel()
    );
    const chunks: Array<{ object: string }> = [];
    for await (const c of result.data as AsyncIterable<{ object: string }>) {
      chunks.push(c);
    }
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].object).toBe('chat.completion.chunk');
  });
});
