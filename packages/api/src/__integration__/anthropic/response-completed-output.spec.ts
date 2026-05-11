import { describe, expect, it } from 'vitest';
import { streamAnthropicToResponses } from '../../ai-provider/anthropic/openai-response.provider';
import type { RawMessageStreamEvent } from '@anthropic-ai/sdk/resources/messages';
import type { ResponseStreamEvent } from 'openai/resources/responses/responses.js';

/**
 * T14: `response.completed` used to ship `output: []` even when the
 * stream had emitted per-item `output_item.done` events. The fix
 * accumulates each emitted item and replays them on the final
 * aggregate event.
 */

async function* iter(
  events: RawMessageStreamEvent[]
): AsyncIterable<RawMessageStreamEvent> {
  for (const e of events) yield e;
}

async function drain<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

describe('streamAnthropicToResponses output[] (T14)', () => {
  it('replays text item on response.completed.output[]', async () => {
    const events: RawMessageStreamEvent[] = [
      {
        type: 'message_start',
        message: {
          id: 'msg_1',
          role: 'assistant',
          content: [],
          model: 'claude',
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 0 } as never,
        } as never,
      } as RawMessageStreamEvent,
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' } as never,
      } as RawMessageStreamEvent,
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'hello' } as never,
      } as RawMessageStreamEvent,
      { type: 'content_block_stop', index: 0 } as RawMessageStreamEvent,
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 1 } as never,
      } as unknown as RawMessageStreamEvent,
      { type: 'message_stop' } as RawMessageStreamEvent,
    ];
    const events_out = (await drain(
      streamAnthropicToResponses(iter(events), 'resp_x', 0, 'claude')
    )) as ResponseStreamEvent[];
    const completed = events_out.find(
      (e) => (e as { type?: string }).type === 'response.completed'
    ) as { response?: { output?: unknown[] } } | undefined;
    expect(completed).toBeDefined();
    expect(completed?.response?.output).toHaveLength(1);
    expect((completed!.response!.output![0] as { type?: string }).type).toBe(
      'message'
    );
  });

  it('replays multiple items on response.completed.output[]', async () => {
    const events: RawMessageStreamEvent[] = [
      {
        type: 'message_start',
        message: {
          id: 'msg_2',
          role: 'assistant',
          content: [],
          model: 'claude',
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 0 } as never,
        } as never,
      } as RawMessageStreamEvent,
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '' } as never,
      } as RawMessageStreamEvent,
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'thoughts' } as never,
      } as RawMessageStreamEvent,
      { type: 'content_block_stop', index: 0 } as RawMessageStreamEvent,
      {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'text', text: '' } as never,
      } as RawMessageStreamEvent,
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'text_delta', text: 'hi' } as never,
      } as RawMessageStreamEvent,
      { type: 'content_block_stop', index: 1 } as RawMessageStreamEvent,
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 2 } as never,
      } as unknown as RawMessageStreamEvent,
      { type: 'message_stop' } as RawMessageStreamEvent,
    ];
    const events_out = (await drain(
      streamAnthropicToResponses(iter(events), 'resp_x', 0, 'claude')
    )) as ResponseStreamEvent[];
    const completed = events_out.find(
      (e) => (e as { type?: string }).type === 'response.completed'
    ) as { response?: { output?: unknown[] } } | undefined;
    expect(completed?.response?.output).toHaveLength(2);
    const types = (completed!.response!.output! as Array<{ type: string }>).map(
      (i) => i.type
    );
    expect(types).toEqual(['reasoning', 'message']);
  });
});
