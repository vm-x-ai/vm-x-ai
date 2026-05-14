import { describe, expect, it, vi } from 'vitest';
import { PinoLogger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import {
  ModelTimeoutException,
  ServiceUnavailableException,
  ThrottlingException,
  ValidationException,
  ModelStreamErrorException,
  type InvokeModelWithResponseStreamCommandOutput,
} from '@aws-sdk/client-bedrock-runtime';
import type { RawMessageStreamEvent } from '@anthropic-ai/sdk/resources/messages';
import { AWSBedrockInvokeDispatcher } from './shared';
import { CompletionError } from '../../gateway/completion.types';

/**
 * Unit tests for the AWS-specific event-stream parser inside
 * {@link AWSBedrockInvokeDispatcher}. The Phase 3 consolidation moved
 * the OpenAI ↔ Anthropic conversion into the shared adapter; what
 * stays here is the AWS event-stream → `RawMessageStreamEvent`
 * generator and its exception mapping, which the adapter never sees.
 *
 * The tests assert the audit invariant that mattered most when this
 * was inline: AWS exception items emitted mid-stream become
 * `CompletionError`s carrying `providerRequestPayload` so the audit
 * row records what the SDK saw on the wire.
 */
function makeProvider(): AWSBedrockInvokeDispatcher {
  const logger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as PinoLogger;
  const configService = {
    get: vi.fn(),
  } as unknown as ConfigService;
  return new AWSBedrockInvokeDispatcher(logger, configService);
}

// `parseBedrockEventStream` is private; bracket-access keeps the test
// honest without leaking the helper to the public surface.
type StreamParser = (
  output: InvokeModelWithResponseStreamCommandOutput,
  requestBody: unknown
) => AsyncIterable<RawMessageStreamEvent>;
const getStreamParser = (p: AWSBedrockInvokeDispatcher): StreamParser =>
  (
    p as unknown as { parseBedrockEventStream: StreamParser }
  ).parseBedrockEventStream.bind(p);

// Build a fake `InvokeModelWithResponseStreamCommandOutput` whose
// `body` is an async iterable of the supplied event-stream items. The
// SDK shape uses optional fields per item so each iteration carries
// exactly one of `chunk` / exception variants.
type StreamItem =
  | { chunk: { bytes: Uint8Array } }
  | { internalServerException: unknown }
  | { modelStreamErrorException: ModelStreamErrorException }
  | { modelTimeoutException: ModelTimeoutException }
  | { serviceUnavailableException: ServiceUnavailableException }
  | { throttlingException: ThrottlingException }
  | { validationException: ValidationException };

function makeOutput(
  items: StreamItem[]
): InvokeModelWithResponseStreamCommandOutput {
  return {
    body: (async function* () {
      for (const item of items) yield item;
    })(),
    $metadata: { requestId: 'req-test-123' },
    contentType: 'application/json',
  } as unknown as InvokeModelWithResponseStreamCommandOutput;
}

function encodeEvent(event: RawMessageStreamEvent): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(event));
}

describe('AWSBedrockInvokeDispatcher.parseBedrockEventStream', () => {
  const requestBody = { anthropic_version: 'bedrock-2023-05-31' };

  it('passes through chunk bytes as parsed RawMessageStreamEvents', async () => {
    const provider = makeProvider();
    const parse = getStreamParser(provider);

    const output = makeOutput([
      {
        chunk: {
          bytes: encodeEvent({
            type: 'message_start',
            message: {
              id: 'msg_1',
              role: 'assistant',
              content: [],
              model: 'claude-haiku-4-5',
              stop_reason: null,
              stop_sequence: null,
              type: 'message',
              usage: {
                input_tokens: 10,
                output_tokens: 0,
                cache_creation_input_tokens: null,
                cache_read_input_tokens: null,
                cache_creation: null,
                server_tool_use: null,
                service_tier: null,
              },
            },
          } as unknown as RawMessageStreamEvent),
        },
      },
      {
        chunk: {
          bytes: encodeEvent({
            type: 'message_stop',
          } as unknown as RawMessageStreamEvent),
        },
      },
    ]);

    const events: RawMessageStreamEvent[] = [];
    for await (const e of parse(output, requestBody)) events.push(e);
    expect(events.map((e) => e.type)).toEqual([
      'message_start',
      'message_stop',
    ]);
  });

  it('skips items that have no chunk bytes and no exception', async () => {
    const provider = makeProvider();
    const parse = getStreamParser(provider);

    // Items the SDK can emit with no chunk and no exception (e.g.
    // metadata-only frames). Should be silently skipped.
    const output = makeOutput([
      {} as unknown as StreamItem,
      {
        chunk: {
          bytes: encodeEvent({
            type: 'message_stop',
          } as unknown as RawMessageStreamEvent),
        },
      },
    ]);

    const events: RawMessageStreamEvent[] = [];
    for await (const e of parse(output, requestBody)) events.push(e);
    expect(events).toHaveLength(1);
  });

  it('throws CompletionError with providerRequestPayload on throttlingException', async () => {
    const provider = makeProvider();
    const parse = getStreamParser(provider);

    const throttle = Object.assign(
      new ThrottlingException({
        $metadata: { requestId: 'req-throttle' },
        message: 'Too many requests',
      }),
      { $retryable: { throttling: true } }
    );

    const output = makeOutput([{ throttlingException: throttle }]);

    let caught: unknown;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of parse(output, requestBody)) {
        // unreachable — first item should throw
      }
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CompletionError);
    const data = (caught as CompletionError).data;
    expect(data.statusCode).toBe(429);
    expect(data.retryable).toBe(true);
    expect(data.openAICompatibleError?.code).toBe(
      'aws_bedrock_invoke_throttling_error'
    );
    // The audit invariant: providerRequestPayload set on every error path.
    expect(data.providerRequestPayload).toEqual(requestBody);
  });

  it('throws CompletionError on validationException with the wire body attached', async () => {
    const provider = makeProvider();
    const parse = getStreamParser(provider);

    const validation = new ValidationException({
      $metadata: { requestId: 'req-validation' },
      message: 'Invalid request',
    });

    const output = makeOutput([{ validationException: validation }]);

    let caught: unknown;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of parse(output, requestBody)) {
        // unreachable
      }
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CompletionError);
    const data = (caught as CompletionError).data;
    expect(data.statusCode).toBe(400);
    expect(data.openAICompatibleError?.code).toBe(
      'aws_bedrock_invoke_validation_error'
    );
    expect(data.providerRequestPayload).toEqual(requestBody);
  });

  it('throws CompletionError on modelStreamErrorException mid-stream', async () => {
    const provider = makeProvider();
    const parse = getStreamParser(provider);

    const modelErr = Object.assign(
      new ModelStreamErrorException({
        $metadata: { requestId: 'req-stream-err' },
        message: 'Model stream interrupted',
      }),
      { $retryable: { throttling: false } }
    );

    // First a normal message_start, then an exception item — covers the
    // "errors after the stream has started" path that motivated
    // threading `requestBody` through to the parser.
    const output = makeOutput([
      {
        chunk: {
          bytes: encodeEvent({
            type: 'message_start',
            message: {
              id: 'msg_x',
              role: 'assistant',
              content: [],
              model: 'claude-haiku-4-5',
              stop_reason: null,
              stop_sequence: null,
              type: 'message',
              usage: {
                input_tokens: 5,
                output_tokens: 0,
                cache_creation_input_tokens: null,
                cache_read_input_tokens: null,
                cache_creation: null,
                server_tool_use: null,
                service_tier: null,
              },
            },
          } as unknown as RawMessageStreamEvent),
        },
      },
      { modelStreamErrorException: modelErr },
    ]);

    let caught: unknown;
    const seen: RawMessageStreamEvent[] = [];
    try {
      for await (const e of parse(output, requestBody)) seen.push(e);
    } catch (e) {
      caught = e;
    }
    expect(seen).toHaveLength(1); // message_start before the error
    expect(caught).toBeInstanceOf(CompletionError);
    const data = (caught as CompletionError).data;
    expect(data.openAICompatibleError?.code).toBe(
      'aws_bedrock_invoke_model_stream_error'
    );
    expect(data.providerRequestPayload).toEqual(requestBody);
  });

  it('throws when a single chunk exceeds the 4 MB defensive cap', async () => {
    const provider = makeProvider();
    const parse = getStreamParser(provider);

    // 5 MB of bytes — well past the cap. Don't actually JSON.parse this;
    // the size check should fire before the parse.
    const oversized = new Uint8Array(5 * 1024 * 1024);
    const output = makeOutput([{ chunk: { bytes: oversized } }]);

    let caught: unknown;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of parse(output, requestBody)) {
        // unreachable
      }
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CompletionError);
    const data = (caught as CompletionError).data;
    expect(data.message).toMatch(/exceeded/);
    expect(data.providerRequestPayload).toEqual(requestBody);
  });

  it('throws CompletionError on modelTimeoutException stream item', async () => {
    const provider = makeProvider();
    const parse = getStreamParser(provider);

    const timeoutErr = new ModelTimeoutException({
      $metadata: { requestId: 'req-timeout' },
      message: 'Model timed out',
    });
    const output = makeOutput([{ modelTimeoutException: timeoutErr }]);

    let caught: unknown;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of parse(output, requestBody)) {
        // unreachable
      }
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CompletionError);
    const data = (caught as CompletionError).data;
    expect(data.statusCode).toBe(504);
    expect(data.retryable).toBe(true);
    expect(data.openAICompatibleError?.code).toBe(
      'aws_bedrock_invoke_model_timeout'
    );
    expect(data.providerRequestPayload).toEqual(requestBody);
  });

  it('throws CompletionError on serviceUnavailableException stream item', async () => {
    const provider = makeProvider();
    const parse = getStreamParser(provider);

    const unavailErr = Object.assign(
      new ServiceUnavailableException({
        $metadata: { requestId: 'req-unavail' },
        message: 'Service unavailable',
      }),
      { $retryable: { throttling: true } }
    );
    const output = makeOutput([{ serviceUnavailableException: unavailErr }]);

    let caught: unknown;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of parse(output, requestBody)) {
        // unreachable
      }
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CompletionError);
    const data = (caught as CompletionError).data;
    expect(data.statusCode).toBe(503);
    expect(data.openAICompatibleError?.code).toBe(
      'aws_bedrock_invoke_service_unavailable'
    );
    expect(data.providerRequestPayload).toEqual(requestBody);
  });
});

describe('AWSBedrockInvokeDispatcher — Claude-only gate', () => {
  /**
   * Bedrock Invoke speaks the Anthropic Messages wire format and only
   * accepts Claude models. `assertClaudeModel` is the runtime gate that
   * rejects non-Claude families (Titan, Llama, Mistral, Nova, DeepSeek)
   * with a 400 before any AWS SDK call. We pin every Claude variant the
   * SDK actually accepts (native, cross-region, EU/APAC prefixes) +
   * representative non-Claude families.
   */
  const provider = makeProvider();
  const baseConnection = {
    connectionId: 'c1',
    config: {
      iamRoleArn: 'arn:aws:iam::123456789012:role/test',
      region: 'us-east-1',
    },
  } as Parameters<typeof provider.dispatchNative>[2];
  const baseBody = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 16,
    messages: [{ role: 'user', content: 'hi' }],
  } as unknown as Parameters<typeof provider.dispatchNative>[0];

  it.each([
    'claude-haiku-4-5',
    'anthropic.claude-3-5-sonnet-20241022-v2:0',
    'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    'eu.anthropic.claude-3-5-sonnet-20241022-v2:0',
    'apac.anthropic.claude-3-haiku-20240307-v1:0',
  ])('accepts Claude model id %s (gate passes)', async (model) => {
    // We can't actually dispatch (no AWS creds), but the gate fires
    // before the SDK call. If the gate accepts the model, the next
    // step is the AWS client send — that will reject with a different
    // error (not a CompletionError shaped as 'anthropic_unsupported_model').
    let err: unknown;
    try {
      await provider.dispatchNative(baseBody, false, baseConnection, {
        model,
      } as Parameters<typeof provider.dispatchNative>[3]);
    } catch (e) {
      err = e;
    }
    if (err instanceof CompletionError) {
      expect(err.data.openAICompatibleError?.code).not.toBe(
        'anthropic_unsupported_model'
      );
    }
  });

  it.each([
    'amazon.titan-text-express-v1',
    'us.amazon.nova-pro-v1:0',
    'meta.llama3-70b-instruct-v1:0',
    'mistral.mixtral-8x7b-instruct-v0:1',
    'cohere.command-r-plus-v1:0',
    'deepseek.r1-v1:0',
  ])('rejects non-Claude model id %s with a 400', async (model) => {
    await expect(
      provider.dispatchNative(baseBody, false, baseConnection, {
        model,
      } as Parameters<typeof provider.dispatchNative>[3])
    ).rejects.toMatchObject({
      data: expect.objectContaining({
        statusCode: 400,
        openAICompatibleError: { code: 'anthropic_unsupported_model' },
      }),
    });
  });

  it('attaches providerRequestPayload on the gate rejection path', async () => {
    // The audit invariant: even when the model gate fires before any
    // AWS SDK call, the CompletionError carries the wire body so the
    // audit row sees what would have been sent.
    let caught: unknown;
    try {
      await provider.dispatchNative(baseBody, false, baseConnection, {
        model: 'amazon.titan-text-express-v1',
      } as Parameters<typeof provider.dispatchNative>[3]);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CompletionError);
    expect((caught as CompletionError).data.providerRequestPayload).toEqual(
      baseBody
    );
  });
});

describe('AWSBedrockInvokeDispatcher.handleError — AWS exception map', () => {
  /**
   * Bedrock's `InvokeModel` and `InvokeModelWithResponseStream` commands
   * can reject with the full Bedrock-Runtime exception family.
   * `handleError` maps each instance to a `CompletionError` with the
   * audit-row-friendly status code, retryability, and openAI-compat
   * `code`. Tests here exercise the additive cases beyond the original
   * five (validation/throttling/internal/serviceUnavailable/modelStream).
   */
  type HandleError = (err: unknown, payload?: unknown) => never;
  const getHandleError = (p: AWSBedrockInvokeDispatcher): HandleError =>
    (p as unknown as { handleError: HandleError }).handleError.bind(p);

  it('maps AccessDeniedException → 403 + access_denied code', async () => {
    const { AccessDeniedException } = await import(
      '@aws-sdk/client-bedrock-runtime'
    );
    const provider = makeProvider();
    const handle = getHandleError(provider);
    const err = new AccessDeniedException({
      $metadata: { requestId: 'req-denied' },
      message: 'No permission',
    });
    let caught: unknown;
    try {
      handle(err, { body: 'wire' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CompletionError);
    const data = (caught as CompletionError).data;
    expect(data.statusCode).toBe(403);
    expect(data.retryable).toBe(false);
    expect(data.openAICompatibleError?.code).toBe(
      'aws_bedrock_invoke_access_denied'
    );
    expect(data.providerRequestPayload).toEqual({ body: 'wire' });
  });

  it('maps ResourceNotFoundException → 404 + resource_not_found code', async () => {
    const { ResourceNotFoundException } = await import(
      '@aws-sdk/client-bedrock-runtime'
    );
    const provider = makeProvider();
    const handle = getHandleError(provider);
    const err = new ResourceNotFoundException({
      $metadata: { requestId: 'req-notfound' },
      message: 'Model not found',
    });
    let caught: unknown;
    try {
      handle(err, { body: 'wire' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CompletionError);
    const data = (caught as CompletionError).data;
    expect(data.statusCode).toBe(404);
    expect(data.openAICompatibleError?.code).toBe(
      'aws_bedrock_invoke_resource_not_found'
    );
    expect(data.providerRequestPayload).toEqual({ body: 'wire' });
  });

  it('maps ServiceQuotaExceededException → 429 + service_quota_exceeded code', async () => {
    const { ServiceQuotaExceededException } = await import(
      '@aws-sdk/client-bedrock-runtime'
    );
    const provider = makeProvider();
    const handle = getHandleError(provider);
    const err = new ServiceQuotaExceededException({
      $metadata: { requestId: 'req-quota' },
      message: 'Quota exhausted',
    });
    let caught: unknown;
    try {
      handle(err, { body: 'wire' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CompletionError);
    const data = (caught as CompletionError).data;
    expect(data.statusCode).toBe(429);
    expect(data.retryable).toBe(true);
    expect(data.openAICompatibleError?.code).toBe(
      'aws_bedrock_invoke_service_quota_exceeded'
    );
  });

  it('maps ModelTimeoutException → 504 + model_timeout code', async () => {
    const provider = makeProvider();
    const handle = getHandleError(provider);
    const err = new ModelTimeoutException({
      $metadata: { requestId: 'req-timeout' },
      message: 'Model timed out',
    });
    let caught: unknown;
    try {
      handle(err, { body: 'wire' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CompletionError);
    const data = (caught as CompletionError).data;
    expect(data.statusCode).toBe(504);
    expect(data.retryable).toBe(true);
    expect(data.openAICompatibleError?.code).toBe(
      'aws_bedrock_invoke_model_timeout'
    );
  });
});
