import { describe, expect, it } from 'vitest';
import {
  responseResponsesToAnthropic,
  streamResponsesToAnthropic,
} from '../../ai-provider/openai/anthropic-messages.provider';
import { CompletionError } from '../../gateway/completion.types';
import type { ResponseStreamEvent } from 'openai/resources/responses/responses.js';

/**
 * T6: distinguish three Responses outcomes that all used to collapse
 * to `stop_reason: 'max_tokens'`:
 *   - response.completed status:'incomplete' reason:'max_output_tokens' → max_tokens (correct)
 *   - response.completed status:'incomplete' reason:'content_filter'    → refusal
 *   - response.failed                                                    → throw CompletionError
 */

async function* iter(
  events: ResponseStreamEvent[]
): AsyncIterable<ResponseStreamEvent> {
  for (const e of events) yield e;
}

async function drain(stream: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

describe('Resp→Anth stop_reason mapping (T6)', () => {
  it('non-streaming: status:incomplete reason:content_filter → refusal', () => {
    const anth = responseResponsesToAnthropic(
      {
        id: 'resp_1',
        status: 'incomplete',
        incomplete_details: { reason: 'content_filter' },
        output: [],
      } as never,
      'claude'
    );
    expect(anth.stop_reason).toBe('refusal');
  });

  it('non-streaming: status:incomplete reason:max_output_tokens → max_tokens', () => {
    const anth = responseResponsesToAnthropic(
      {
        id: 'resp_1',
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output: [],
      } as never,
      'claude'
    );
    expect(anth.stop_reason).toBe('max_tokens');
  });
});

describe('streamResponsesToAnthropic — response.failed (T6)', () => {
  it('throws CompletionError on response.failed mid-stream — never silently masks as max_tokens', async () => {
    const events: ResponseStreamEvent[] = [
      { type: 'response.created', response: { id: 'r' } } as never,
      {
        type: 'response.failed',
        response: {
          error: { code: 'upstream_timeout', message: 'gateway timed out' },
        },
      } as never,
    ];
    await expect(
      drain(streamResponsesToAnthropic(iter(events), 'claude'))
    ).rejects.toThrowError(CompletionError);
  });

  it('thrown error carries the upstream code + retryable flag', async () => {
    const events: ResponseStreamEvent[] = [
      { type: 'response.created', response: { id: 'r' } } as never,
      {
        type: 'response.failed',
        response: {
          error: { code: 'upstream_timeout', message: 'gateway timed out' },
        },
      } as never,
    ];
    await drain(streamResponsesToAnthropic(iter(events), 'claude')).catch(
      (err: unknown) => {
        expect(err).toBeInstanceOf(CompletionError);
        const ce = err as CompletionError;
        expect(ce.data.openAICompatibleError?.code).toBe('upstream_timeout');
        expect(ce.data.retryable).toBe(true);
      }
    );
  });

  it('streaming: response.incomplete with content_filter → refusal stop_reason', async () => {
    const events: ResponseStreamEvent[] = [
      { type: 'response.created', response: { id: 'r' } } as never,
      {
        type: 'response.incomplete',
        response: { incomplete_details: { reason: 'content_filter' } },
      } as never,
    ];
    const drained = await drain(
      streamResponsesToAnthropic(iter(events), 'claude')
    );
    const messageDelta = drained.find(
      (e) => (e as { type?: string }).type === 'message_delta'
    ) as { delta?: { stop_reason?: string } } | undefined;
    expect(messageDelta?.delta?.stop_reason).toBe('refusal');
  });
});
