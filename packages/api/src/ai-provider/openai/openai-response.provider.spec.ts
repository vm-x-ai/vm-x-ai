import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PinoLogger } from 'nestjs-pino';
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  RateLimitError,
} from 'openai';
import type {
  ResponseCreateParams,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses.js';
import { OpenAIResponseProvider } from './openai-response.provider';
import { CompletionError } from '../../gateway/completion.types';
import type { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import type { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import type { OpenAIConnectionConfig } from './shared';

/**
 * Class-layer unit tests for {@link OpenAIResponseProvider} — D5
 * native passthrough. Mirrors the chat-completion spec; the only
 * shape difference is the SDK call (`responses.create`) and the
 * streaming branch returning the raw SDK iterable verbatim.
 */

type WithResponseShape<T> = Promise<{
  data: T;
  response: { headers: Headers };
}>;

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

function makeConnection(): AIConnectionEntity<OpenAIConnectionConfig> {
  return {
    connectionId: 'conn-1',
    name: 'test-conn',
    config: { apiKey: 'sk-test' },
  } as unknown as AIConnectionEntity<OpenAIConnectionConfig>;
}

function makeModel(model = 'gpt-4o-mini'): AIResourceModelConfigEntity {
  return { model } as AIResourceModelConfigEntity;
}

class TestableProvider extends OpenAIResponseProvider {
  public createSpy =
    vi.fn<
      (
        body: ResponseCreateParams,
        sdkOptions: Record<string, unknown>
      ) => unknown
    >();
  public setCreateImpl(
    impl: (
      body: ResponseCreateParams,
      sdkOptions: Record<string, unknown>
    ) => unknown
  ): void {
    this.createSpy.mockReset();
    this.createSpy.mockImplementation(impl);
  }
  protected override async createClient(): Promise<never> {
    return {
      responses: {
        create: (
          body: ResponseCreateParams,
          sdkOptions: Record<string, unknown>
        ) => {
          const result = this.createSpy(body, sdkOptions);
          return {
            withResponse: () =>
              result instanceof Error ? Promise.reject(result) : result,
          };
        },
      },
    } as unknown as never;
  }
}

function buildProvider(): TestableProvider {
  return new TestableProvider(makeLogger());
}

function okResponse<T>(
  data: T,
  headers: Headers = new Headers()
): WithResponseShape<T> {
  return Promise.resolve({ data, response: { headers } });
}

const baseRequest: ResponseCreateParams = {
  model: 'will-be-replaced',
  input: 'ping',
};

describe('OpenAIResponseProvider — class layer', () => {
  let provider: TestableProvider;

  beforeEach(() => {
    provider = buildProvider();
  });

  // ─── Wire-body shape ─────────────────────────────────────────────
  it('substitutes model from the resource config', async () => {
    provider.setCreateImpl(() => okResponse({ id: 'resp_1' } as never));
    await provider.handle(baseRequest, makeConnection(), makeModel('o4-mini'));
    const passedBody = provider.createSpy.mock
      .calls[0][0] as ResponseCreateParams;
    expect(passedBody.model).toBe('o4-mini');
  });

  it('strips vmx + __vmx_passthrough envelopes before sending', async () => {
    provider.setCreateImpl(() => okResponse({ id: 'resp_1' } as never));
    const requestWithEnvelope = {
      ...baseRequest,
      vmx: { metrics: {}, events: [] },
      __vmx_passthrough: { anthropic: { thinking: { type: 'enabled' } } },
    } as ResponseCreateParams;
    await provider.handle(requestWithEnvelope, makeConnection(), makeModel());
    const passedBody = provider.createSpy.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(passedBody).not.toHaveProperty('vmx');
    expect(passedBody).not.toHaveProperty('__vmx_passthrough');
  });

  it('preserves Responses-only fields verbatim (no force-injection)', async () => {
    // Pins the native-passthrough contract: every modern Responses
    // field — verbosity, prompt_cache_key, safety_identifier,
    // service_tier, background, include[], conversation, store,
    // truncation — must arrive at the SDK unchanged. The Chat
    // Completions sibling force-injects `stream_options.include_usage`;
    // Responses' StreamOptions has no such field (usage is auto-emitted
    // on `response.completed`), so the cell must NOT inject one.
    provider.setCreateImpl(() => okResponse({ id: 'resp_1' } as never));
    const rich = {
      ...baseRequest,
      stream: true,
      stream_options: { include_obfuscation: false },
      text: { verbosity: 'low' },
      reasoning: { effort: 'medium', summary: 'auto' },
      service_tier: 'flex',
      prompt_cache_key: 'cache-key-1',
      safety_identifier: 'user-hashed-1',
      background: true,
      include: ['reasoning.encrypted_content'],
      store: false,
      truncation: 'auto',
      parallel_tool_calls: false,
      max_output_tokens: 1024,
      previous_response_id: 'resp_prev',
      metadata: { tag: 'unit' },
      tools: [{ type: 'web_search' }],
    } as unknown as ResponseCreateParams;
    await provider.handle(rich, makeConnection(), makeModel());
    const passed = provider.createSpy.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(passed).toMatchObject({
      stream: true,
      stream_options: { include_obfuscation: false },
      text: { verbosity: 'low' },
      reasoning: { effort: 'medium', summary: 'auto' },
      service_tier: 'flex',
      prompt_cache_key: 'cache-key-1',
      safety_identifier: 'user-hashed-1',
      background: true,
      include: ['reasoning.encrypted_content'],
      store: false,
      truncation: 'auto',
      parallel_tool_calls: false,
      max_output_tokens: 1024,
      previous_response_id: 'resp_prev',
      metadata: { tag: 'unit' },
      tools: [{ type: 'web_search' }],
    });
    // Critical: no `include_usage` was synthesised into stream_options
    // (would be an unknown field on Responses' StreamOptions).
    expect(
      (passed.stream_options as Record<string, unknown>).include_usage
    ).toBeUndefined();
  });

  // ─── Streaming branch ───────────────────────────────────────────
  it('streaming returns the SDK iterable verbatim (D5 native passthrough)', async () => {
    async function* fakeStream(): AsyncIterable<ResponseStreamEvent> {
      yield { type: 'response.created', response: { id: 'r1' } } as never;
      yield {
        type: 'response.output_text.delta',
        delta: 'pong',
      } as never;
    }
    const stream = fakeStream();
    provider.setCreateImpl(() => okResponse(stream as never));

    const result = await provider.handle(
      { ...baseRequest, stream: true },
      makeConnection(),
      makeModel()
    );
    // The class returns `data` as an async iterable identical to the
    // SDK's; consume to confirm.
    const events: unknown[] = [];
    for await (const ev of result.data as AsyncIterable<unknown>)
      events.push(ev);
    expect(events).toHaveLength(2);
    expect((events[1] as { type: string }).type).toBe(
      'response.output_text.delta'
    );
  });

  // ─── Header forwarding ──────────────────────────────────────────
  it('forwards caller headers (T18) to the SDK call', async () => {
    provider.setCreateImpl(() => okResponse({ id: 'resp_1' } as never));
    await provider.handle(baseRequest, makeConnection(), makeModel(), {
      forwardHeaders: { 'OpenAI-Beta': 'responses=v1' },
    });
    const sdkOptions = provider.createSpy.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(sdkOptions.headers).toEqual({ 'OpenAI-Beta': 'responses=v1' });
  });

  it('omits SDK headers when forwardHeaders is empty/undefined', async () => {
    provider.setCreateImpl(() => okResponse({ id: 'resp_1' } as never));
    await provider.handle(baseRequest, makeConnection(), makeModel(), {
      forwardHeaders: {},
    });
    const sdkOptions = provider.createSpy.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(sdkOptions).not.toHaveProperty('headers');
  });

  it('forwards signal, timeoutMs and maxRetries to the SDK call', async () => {
    provider.setCreateImpl(() => okResponse({ id: 'resp_1' } as never));
    const ac = new AbortController();
    await provider.handle(baseRequest, makeConnection(), makeModel(), {
      signal: ac.signal,
      timeoutMs: 12_345,
      maxRetries: 2,
    });
    const sdkOptions = provider.createSpy.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(sdkOptions.signal).toBe(ac.signal);
    expect(sdkOptions.timeout).toBe(12_345);
    expect(sdkOptions.maxRetries).toBe(2);
  });

  // ─── Response shape ─────────────────────────────────────────────
  it('returns providerRequestPayload + filtered x- headers on success', async () => {
    const headers = new Headers({
      'x-request-id': 'req-resp-1',
      'content-type': 'application/json',
    });
    provider.setCreateImpl(() =>
      okResponse({ id: 'resp_1' } as never, headers)
    );
    const result = await provider.handle(
      baseRequest,
      makeConnection(),
      makeModel()
    );
    expect(result.headers).toEqual({ 'x-request-id': 'req-resp-1' });
    expect(result.providerRequestPayload).toMatchObject({
      model: 'gpt-4o-mini',
    });
  });

  // ─── Error mapping ──────────────────────────────────────────────
  it('RateLimitError → CompletionError(rate:true) with retryDelay from reset headers', async () => {
    const errorHeaders = new Headers({ 'x-ratelimit-reset-tokens': '3s' });
    const rateError = Object.assign(
      new RateLimitError(429, undefined, 'rl', errorHeaders),
      { headers: errorHeaders }
    );
    provider.setCreateImpl(() => rateError);
    await expect(
      provider.handle(baseRequest, makeConnection(), makeModel())
    ).rejects.toMatchObject({
      data: expect.objectContaining({
        rate: true,
        retryable: true,
        retryDelay: 3_000,
        statusCode: 429,
      }),
    });
  });

  it('APIError(503) → retryable:true', async () => {
    const apiError = Object.assign(
      new APIError(503, undefined, 'down', new Headers()),
      {
        status: 503,
        code: null,
        type: null,
        param: null,
        headers: new Headers(),
      }
    );
    provider.setCreateImpl(() => apiError);
    await expect(
      provider.handle(baseRequest, makeConnection(), makeModel())
    ).rejects.toMatchObject({
      data: expect.objectContaining({
        rate: false,
        retryable: true,
        statusCode: 503,
      }),
    });
  });

  it('non-APIError → CompletionError(retryable:false) with providerRequestPayload', async () => {
    provider.setCreateImpl(() => new Error('connect ECONNREFUSED'));
    await expect(
      provider.handle(baseRequest, makeConnection(), makeModel('o4-mini'))
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof CompletionError &&
        e.data.retryable === false &&
        (e.data.providerRequestPayload as { model?: string })?.model ===
          'o4-mini'
    );
  });

  it('APIConnectionError → CompletionError via APIError branch (status:500, retryable:true)', async () => {
    // APIConnectionError extends APIError but has `status: undefined`.
    // Falls through the APIError branch and defaults to 500 — which is
    // in the retryable set, so the gateway can fall forward to the
    // next model.
    const connError = new APIConnectionError({ message: 'socket reset' });
    provider.setCreateImpl(() => connError);
    await expect(
      provider.handle(baseRequest, makeConnection(), makeModel())
    ).rejects.toMatchObject({
      data: expect.objectContaining({
        rate: false,
        retryable: true,
        statusCode: 500,
        providerRequestPayload: expect.objectContaining({
          model: 'gpt-4o-mini',
        }),
      }),
    });
  });

  it('APIConnectionTimeoutError → CompletionError(retryable:true, status:500)', async () => {
    const timeoutError = new APIConnectionTimeoutError({
      message: 'request timed out',
    });
    provider.setCreateImpl(() => timeoutError);
    await expect(
      provider.handle(baseRequest, makeConnection(), makeModel())
    ).rejects.toMatchObject({
      data: expect.objectContaining({
        rate: false,
        retryable: true,
        statusCode: 500,
      }),
    });
  });

  it('every error path attaches providerRequestPayload (audit invariant)', async () => {
    // Pins the audit-row guarantee: every CompletionError surfaced by
    // this cell carries the wire body so the operator can replay /
    // debug a failed upstream call without re-running.
    const errors = [
      Object.assign(new RateLimitError(429, undefined, 'rl', new Headers()), {
        headers: new Headers(),
      }),
      Object.assign(new APIError(503, undefined, 'down', new Headers()), {
        status: 503,
        headers: new Headers(),
        code: null,
        type: null,
        param: null,
      }),
      new Error('weird'),
    ];
    for (const err of errors) {
      provider.setCreateImpl(() => err);
      await expect(
        provider.handle(baseRequest, makeConnection(), makeModel('gpt-4o-mini'))
      ).rejects.toSatisfy(
        (e: unknown) =>
          e instanceof CompletionError &&
          (e.data.providerRequestPayload as { model?: string })?.model ===
            'gpt-4o-mini'
      );
    }
  });
});
