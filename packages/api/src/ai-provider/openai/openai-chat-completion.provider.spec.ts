import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PinoLogger } from 'nestjs-pino';
import { APIError, RateLimitError } from 'openai';
import type { ChatCompletionCreateParams } from 'openai/resources/index.js';
import { OpenAIChatCompletionProvider } from './openai-chat-completion.provider';
import { CompletionError } from '../../gateway/completion.types';
import type { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import type { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import type { OpenAIConnectionConfig } from './shared';

/**
 * Class-layer unit tests for {@link OpenAIChatCompletionProvider}.
 *
 * These complement the live `__integration__/providers/openai.spec.ts`
 * matrix: live tests prove the SDK call shape works against the real
 * upstream; these tests pin the class's pre-SDK transformations
 * (`stripPassthroughEnvelope` integration, `model` substitution from
 * resource config, `stream_options.include_usage` injection,
 * `providerRequestPayload` capture on every path) and the post-SDK
 * error mapping (rate-limit / API / unknown) without paying the
 * upstream-call cost on every PR.
 *
 * Pattern: `createClient` is overridden via a subclass shim so the
 * `@Injectable` constructor stays untouched and the SDK is replaced
 * by a vi-mocked stand-in returning a chainable `withResponse()`-shape
 * promise.
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

/**
 * Subclass shim — overrides the protected `createClient` so we can
 * inject a fake SDK without `vi.mock('openai', ...)` (which is
 * brittle: `RateLimitError` / `APIError` constructors are exported
 * from the same module, and a wholesale module mock would shadow
 * them). The fake SDK exposes `chat.completions.create()` matching
 * the `.withResponse()` shape the provider class actually calls.
 */
class TestableProvider extends OpenAIChatCompletionProvider {
  public createSpy =
    vi.fn<
      (
        body: ChatCompletionCreateParams,
        sdkOptions: Record<string, unknown>
      ) => unknown
    >();
  // Allow tests to swap implementations on a per-test basis.
  public setCreateImpl(
    impl: (
      body: ChatCompletionCreateParams,
      sdkOptions: Record<string, unknown>
    ) => unknown
  ): void {
    this.createSpy.mockReset();
    this.createSpy.mockImplementation(impl);
  }
  protected override async createClient(): Promise<never> {
    // Cast: the real SDK has many more fields, but the provider only
    // touches `chat.completions.create(body, sdkOptions).withResponse()`.
    return {
      chat: {
        completions: {
          create: (
            body: ChatCompletionCreateParams,
            sdkOptions: Record<string, unknown>
          ) => {
            const result = this.createSpy(body, sdkOptions);
            return {
              withResponse: () =>
                result instanceof Error ? Promise.reject(result) : result,
            };
          },
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

const baseRequest: ChatCompletionCreateParams = {
  model: 'will-be-replaced',
  messages: [{ role: 'user', content: 'ping' }],
};

describe('OpenAIChatCompletionProvider — class layer', () => {
  let provider: TestableProvider;

  beforeEach(() => {
    provider = buildProvider();
  });

  // ─── Wire-body shape ─────────────────────────────────────────────
  it('substitutes model from the resource config (drops the request model)', async () => {
    provider.setCreateImpl((body) =>
      okResponse({ id: 'cmpl_1', model: body.model } as never)
    );
    await provider.handle(
      baseRequest,
      makeConnection(),
      makeModel('gpt-4o-mini')
    );
    expect(provider.createSpy).toHaveBeenCalledOnce();
    const passedBody = provider.createSpy.mock
      .calls[0][0] as ChatCompletionCreateParams;
    expect(passedBody.model).toBe('gpt-4o-mini');
  });

  it('strips the gateway __vmx_passthrough envelope before sending', async () => {
    provider.setCreateImpl(() => okResponse({ id: 'cmpl_1' } as never));
    const requestWithEnvelope = {
      ...baseRequest,
      __vmx_passthrough: { anthropic: { top_k: 50 } },
      vmx: { metrics: {}, events: [] },
    } as ChatCompletionCreateParams;
    await provider.handle(requestWithEnvelope, makeConnection(), makeModel());
    const passedBody = provider.createSpy.mock.calls[0][0] as unknown as Record<
      string,
      unknown
    >;
    expect(passedBody).not.toHaveProperty('__vmx_passthrough');
    expect(passedBody).not.toHaveProperty('vmx');
  });

  it('injects stream_options.include_usage when streaming is enabled', async () => {
    provider.setCreateImpl(() => okResponse({ id: 'cmpl_1' } as never));
    await provider.handle(
      { ...baseRequest, stream: true },
      makeConnection(),
      makeModel()
    );
    const passedBody = provider.createSpy.mock
      .calls[0][0] as ChatCompletionCreateParams;
    expect(passedBody.stream_options).toEqual({ include_usage: true });
  });

  it('omits stream_options when not streaming', async () => {
    provider.setCreateImpl(() => okResponse({ id: 'cmpl_1' } as never));
    await provider.handle(baseRequest, makeConnection(), makeModel());
    const passedBody = provider.createSpy.mock
      .calls[0][0] as ChatCompletionCreateParams;
    expect(passedBody.stream_options).toBeUndefined();
  });

  // ─── Header forwarding (T18) ────────────────────────────────────
  it('forwards caller headers to the SDK when forwardHeaders is set', async () => {
    provider.setCreateImpl(() => okResponse({ id: 'cmpl_1' } as never));
    await provider.handle(baseRequest, makeConnection(), makeModel(), {
      forwardHeaders: {
        'OpenAI-Beta': 'assistants=v2',
        Authorization: 'Bearer xyz',
      },
    });
    const sdkOptions = provider.createSpy.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(sdkOptions.headers).toEqual({
      'OpenAI-Beta': 'assistants=v2',
      Authorization: 'Bearer xyz',
    });
  });

  it('omits SDK headers when forwardHeaders is empty/undefined', async () => {
    provider.setCreateImpl(() => okResponse({ id: 'cmpl_1' } as never));
    await provider.handle(baseRequest, makeConnection(), makeModel(), {
      forwardHeaders: {},
    });
    const sdkOptions = provider.createSpy.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(sdkOptions).not.toHaveProperty('headers');
  });

  it('forwards maxRetries and signal to the SDK call', async () => {
    provider.setCreateImpl(() => okResponse({ id: 'cmpl_1' } as never));
    const ac = new AbortController();
    await provider.handle(baseRequest, makeConnection(), makeModel(), {
      maxRetries: 3,
      signal: ac.signal,
    });
    const sdkOptions = provider.createSpy.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(sdkOptions.maxRetries).toBe(3);
    expect(sdkOptions.signal).toBe(ac.signal);
  });

  // ─── Response shape ─────────────────────────────────────────────
  it('returns providerRequestPayload + filtered x- headers on success', async () => {
    const headers = new Headers({
      'x-request-id': 'req-1',
      'x-ratelimit-remaining-tokens': '500',
      'content-type': 'application/json',
    });
    provider.setCreateImpl(() =>
      okResponse({ id: 'cmpl_1', model: 'gpt-4o-mini' } as never, headers)
    );
    const result = await provider.handle(
      baseRequest,
      makeConnection(),
      makeModel()
    );
    expect(result.headers).toEqual({
      'x-request-id': 'req-1',
      'x-ratelimit-remaining-tokens': '500',
    });
    expect(result.providerRequestPayload).toMatchObject({
      model: 'gpt-4o-mini',
    });
  });

  // ─── Error mapping ──────────────────────────────────────────────
  it('RateLimitError → CompletionError(rate:true, retryable:true) with retryDelay parsed from reset headers', async () => {
    const errorHeaders = new Headers({
      'x-ratelimit-reset-requests': '5s',
      'x-ratelimit-reset-tokens': '2s',
    });
    const rateError = Object.assign(
      new RateLimitError(429, undefined, 'rate limited', errorHeaders),
      { headers: errorHeaders }
    );
    provider.setCreateImpl(() => rateError);
    await expect(
      provider.handle(baseRequest, makeConnection(), makeModel())
    ).rejects.toMatchObject({
      data: expect.objectContaining({
        rate: true,
        retryable: true,
        statusCode: 429,
        // 5s wins over 2s.
        retryDelay: 5_000,
        providerRequestPayload: expect.objectContaining({
          model: 'gpt-4o-mini',
        }),
      }),
    });
  });

  it('APIError(500) → retryable:true, providerRequestPayload set', async () => {
    const apiError = Object.assign(
      new APIError(500, undefined, 'server error', new Headers()),
      {
        status: 500,
        code: 'internal_error',
        type: 'server_error',
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
        statusCode: 500,
        providerRequestPayload: expect.any(Object),
      }),
    });
  });

  it('APIError(400) → retryable:false', async () => {
    const apiError = Object.assign(
      new APIError(400, undefined, 'bad request', new Headers()),
      {
        status: 400,
        code: 'invalid_request',
        type: 'invalid_request_error',
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
        retryable: false,
        statusCode: 400,
      }),
    });
  });

  it('non-APIError (e.g. network failure) → CompletionError(retryable:false, status:500)', async () => {
    provider.setCreateImpl(() => new Error('socket hang up'));
    await expect(
      provider.handle(baseRequest, makeConnection(), makeModel())
    ).rejects.toMatchObject({
      data: expect.objectContaining({
        rate: false,
        retryable: false,
        statusCode: 500,
        message: 'socket hang up',
        providerRequestPayload: expect.objectContaining({
          model: 'gpt-4o-mini',
        }),
      }),
    });
  });

  it('every error path attaches providerRequestPayload (audit invariant)', async () => {
    // Sanity-bundles the three error branches into one assertion.
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
