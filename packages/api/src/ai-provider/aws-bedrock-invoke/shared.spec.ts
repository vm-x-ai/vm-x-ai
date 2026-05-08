import { describe, expect, it, vi } from 'vitest';
import { PinoLogger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import {
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
});
