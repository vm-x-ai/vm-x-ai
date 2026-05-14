import { describe, it, expect, vi } from 'vitest';
import { HttpStatus } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ResponsesController } from './responses.controller';
import type { ResponsesService } from './responses.service';
import type { ResponsesRequestDto } from './dto/responses-request.dto';
import { CompletionError } from '../completion.types';

/**
 * Unit tests for the SSE-started error frame rewrite in
 * {@link ResponsesController}.
 *
 * Once the SSE stream has been opened (a `200 text/event-stream` response
 * already flushed to the wire), an upstream error can no longer be sent as
 * a plain JSON envelope. The controller has to emit an `error` SSE event,
 * and that event's *payload shape* has to match OpenAI's native Responses
 * shape (`{type:'error', sequence_number:<n>, error:{type:<string>, ...}}`).
 * The AI SDK's Responses chunk schema rejects the bare `{error:{message,code}}`
 * envelope we use for pre-stream errors and dumps a 5kb union-validation
 * error into the client's UI instead of a usable message — that's what
 * these tests guard against.
 *
 * The pre-stream JSON-envelope path (`sseStarted === false`) is the public
 * OpenAI-compatible contract and is exercised here too as a regression
 * fence so a future tweak doesn't accidentally reshape it.
 */

type RawCall = string;

function makeFakeReply(): {
  reply: FastifyReply;
  rawWrites: RawCall[];
  rawEnded: { value: boolean };
  rawHeaders: { value: Record<string, unknown> | undefined };
  jsonStatus: { value: number | undefined };
  jsonHeaders: { value: Record<string, unknown> | undefined };
  jsonBody: { value: unknown };
} {
  const rawWrites: RawCall[] = [];
  const rawEnded = { value: false };
  const rawHeaders: { value: Record<string, unknown> | undefined } = {
    value: undefined,
  };
  const jsonStatus: { value: number | undefined } = { value: undefined };
  const jsonHeaders: { value: Record<string, unknown> | undefined } = {
    value: undefined,
  };
  const jsonBody: { value: unknown } = { value: undefined };

  const raw = {
    writeHead: (_code: number, headers: Record<string, unknown>) => {
      rawHeaders.value = headers;
    },
    write: (chunk: string) => {
      rawWrites.push(chunk);
    },
    end: () => {
      rawEnded.value = true;
    },
    on: () => undefined,
    off: () => undefined,
  } as unknown as FastifyReply['raw'];

  const reply = {
    raw,
    status(code: number) {
      jsonStatus.value = code;
      return reply;
    },
    headers(h: Record<string, unknown>) {
      jsonHeaders.value = h;
      return reply;
    },
    send(body: unknown) {
      jsonBody.value = body;
      return reply;
    },
  } as unknown as FastifyReply;

  return {
    reply,
    rawWrites,
    rawEnded,
    rawHeaders,
    jsonStatus,
    jsonHeaders,
    jsonBody,
  };
}

function buildController(
  respond: ResponsesService['respond']
): ResponsesController {
  const service = { respond } as unknown as ResponsesService;
  return new ResponsesController(service);
}

const basePayload = {
  model: 'default',
  input: 'hello',
} as unknown as ResponsesRequestDto;

const fakeRequest = {
  headers: {},
} as unknown as FastifyRequest;

/**
 * Concatenate the raw SSE writes, split into discrete events on the
 * `\n\n` boundary, and parse the `data:` line of each as JSON. Matches
 * the way the AI SDK consumes the stream so the assertions catch real
 * malformed frames.
 */
function parseSseEvents(
  rawWrites: string[]
): Array<{ event: string; data: unknown }> {
  const combined = rawWrites.join('');
  const frames = combined
    .split('\n\n')
    .map((f) => f.trim())
    .filter(Boolean);
  return frames.map((frame) => {
    const lines = frame.split('\n');
    const eventLine = lines.find((l) => l.startsWith('event: ')) ?? '';
    const dataLine = lines.find((l) => l.startsWith('data: ')) ?? '';
    return {
      event: eventLine.slice('event: '.length),
      data: dataLine ? JSON.parse(dataLine.slice('data: '.length)) : null,
    };
  });
}

describe('ResponsesController — error-frame shaping', () => {
  describe('after the SSE stream has opened (sseStarted)', () => {
    it('emits a native Responses-shape error event when the upstream throws mid-stream', async () => {
      // Yield two events, then blow up on the third iteration.
      async function* streamThenThrow() {
        yield { type: 'response.created', response: { id: 'resp_1' } };
        yield { type: 'response.output_text.delta', delta: 'pong' };
        throw new CompletionError({
          openAICompatibleError: { code: 'unknown_error' },
          message:
            'An error occurred while processing your request. ' +
            'Please include the request ID req_test in your message.',
          rate: false,
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          retryable: false,
          failureReason: 'upstream unknown_error',
        });
      }
      const respond = vi.fn().mockResolvedValue({
        data: streamThenThrow(),
        headers: {},
      });
      const controller = buildController(respond as never);
      const { reply, rawWrites, rawEnded, rawHeaders, jsonStatus } =
        makeFakeReply();

      await controller.responses('ws', 'env', basePayload, fakeRequest, reply);

      // The non-streaming JSON envelope path never fired.
      expect(jsonStatus.value).toBeUndefined();
      // The stream was opened with the SSE content-type.
      expect(rawHeaders.value?.['Content-Type']).toBe('text/event-stream');
      expect(rawEnded.value).toBe(true);

      const events = parseSseEvents(rawWrites);
      // Two real events forwarded, then one synthesised error event.
      expect(events.length).toBe(3);
      expect(events[0].event).toBe('response.created');
      expect(events[1].event).toBe('response.output_text.delta');
      expect(events[2].event).toBe('error');

      // The synthesised frame matches the AI SDK's Responses chunk schema:
      // `type:'error'`, numeric `sequence_number`, string `error.type`.
      const errorFrame = events[2].data as {
        type: string;
        sequence_number: number;
        error: { type: string; message: string; code?: string };
      };
      expect(errorFrame.type).toBe('error');
      expect(typeof errorFrame.sequence_number).toBe('number');
      // Two events were forwarded before the throw, so the sequence
      // counter sits at 2 when the error frame is emitted.
      expect(errorFrame.sequence_number).toBe(2);
      // The CompletionError's `code` becomes the canonical `error.type`.
      expect(errorFrame.error.type).toBe('unknown_error');
      expect(errorFrame.error.message).toMatch(/request ID req_test/);
      // The original `code` is preserved as a secondary field for
      // OpenAI-compatible consumers that key off it.
      expect(errorFrame.error.code).toBe('unknown_error');
    });

    it('surfaces plain Errors as `error.type = unknown_error` with the message preserved', async () => {
      // A non-CompletionError plain throw routes through `handleError`'s
      // generic-Error branch, which stamps `code: 'unknown_error'` on
      // the envelope. The sseStarted rewriter promotes that into
      // `error.type`, so plain mid-stream throws still get a usable
      // type discriminator on the wire.
      async function* streamThenThrowPlain() {
        yield { type: 'response.created', response: { id: 'resp_1' } };
        throw new Error('boom');
      }
      const respond = vi.fn().mockResolvedValue({
        data: streamThenThrowPlain(),
        headers: {},
      });
      const controller = buildController(respond as never);
      const { reply, rawWrites } = makeFakeReply();

      await controller.responses('ws', 'env', basePayload, fakeRequest, reply);

      const events = parseSseEvents(rawWrites);
      const errorEvent = events.find((e) => e.event === 'error');
      expect(errorEvent).toBeDefined();
      const errorFrame = errorEvent!.data as {
        type: string;
        sequence_number: number;
        error: { type: string; message: string };
      };
      expect(errorFrame.type).toBe('error');
      expect(errorFrame.error.type).toBe('unknown_error');
      expect(errorFrame.error.message).toBe('boom');
    });

    it('stamps sequence_number with the count of events forwarded before the throw', async () => {
      const N = 5;
      async function* streamNThenThrow() {
        for (let i = 0; i < N; i++) {
          yield { type: 'response.output_text.delta', delta: `tok${i}` };
        }
        throw new Error('mid-stream blow up');
      }
      const respond = vi.fn().mockResolvedValue({
        data: streamNThenThrow(),
        headers: {},
      });
      const controller = buildController(respond as never);
      const { reply, rawWrites } = makeFakeReply();

      await controller.responses('ws', 'env', basePayload, fakeRequest, reply);

      const events = parseSseEvents(rawWrites);
      // N real events + 1 error event.
      expect(events.length).toBe(N + 1);
      const errorFrame = events[N].data as { sequence_number: number };
      expect(errorFrame.sequence_number).toBe(N);
    });
  });

  describe('before the SSE stream opens (pre-stream JSON envelope)', () => {
    it('responds with the OpenAI-compatible {error:{message,code}} envelope, not an SSE frame', async () => {
      // The service throws synchronously inside `respond()`, before the
      // controller can call `res.raw.writeHead(200, ...)` — i.e.
      // `sseStarted` stays false.
      const respond = vi.fn().mockRejectedValue(
        new CompletionError({
          openAICompatibleError: { code: 'rate_limit_exceeded' },
          message: 'Rate limit hit',
          rate: true,
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          retryable: true,
          failureReason: '429 rate limit',
        })
      );
      const controller = buildController(respond as never);
      const { reply, rawWrites, rawEnded, jsonStatus, jsonBody } =
        makeFakeReply();

      await controller.responses('ws', 'env', basePayload, fakeRequest, reply);

      // The SSE path never opened.
      expect(rawWrites.length).toBe(0);
      expect(rawEnded.value).toBe(false);
      // OpenAI-compatible JSON envelope on a non-2xx status.
      expect(jsonStatus.value).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(jsonBody.value).toEqual({
        error: {
          message: 'Rate limit hit',
          code: 'rate_limit_exceeded',
        },
      });
    });
  });
});
