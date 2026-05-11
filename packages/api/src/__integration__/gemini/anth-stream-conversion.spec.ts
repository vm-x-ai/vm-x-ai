import { describe, expect, it } from 'vitest';
import { chatCompletionStreamToAnthropic } from '../../ai-provider/gemini/anthropic-messages.provider';
import type { ChatCompletionChunk } from 'openai/resources/index.js';
import type { RawMessageStreamEvent } from '@anthropic-ai/sdk/resources/messages';

/**
 * T17: Anth→Gemini streaming used to forward OpenAI ChatCompletion
 * chunks verbatim, breaking strict Anthropic SDK clients consuming
 * the gateway. The new converter walks the chunks and emits a
 * proper Anthropic SSE event sequence.
 */

async function* iter(
  events: ChatCompletionChunk[]
): AsyncIterable<ChatCompletionChunk> {
  for (const e of events) yield e;
}

async function drain<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

const baseChunk: Omit<ChatCompletionChunk, 'choices'> = {
  id: 'chatcmpl_1',
  object: 'chat.completion.chunk',
  created: 0,
  model: 'gemini-2.5-flash-lite',
};

describe('chatCompletionStreamToAnthropic (T17)', () => {
  it('emits message_start, content_block_start (text), text_delta, content_block_stop, message_delta, message_stop', async () => {
    const chunks: ChatCompletionChunk[] = [
      {
        ...baseChunk,
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: 'hello' },
            finish_reason: null,
          },
        ],
      },
      {
        ...baseChunk,
        choices: [
          { index: 0, delta: { content: ' world' }, finish_reason: null },
        ],
      },
      {
        ...baseChunk,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      },
    ];
    const events = (await drain(
      chatCompletionStreamToAnthropic(iter(chunks), 'claude')
    )) as RawMessageStreamEvent[];
    const types = events.map((e) => (e as { type?: string }).type);
    expect(types[0]).toBe('message_start');
    expect(types).toContain('content_block_start');
    expect(types).toContain('content_block_delta');
    expect(types).toContain('content_block_stop');
    expect(types[types.length - 2]).toBe('message_delta');
    expect(types[types.length - 1]).toBe('message_stop');
  });

  it('maps tool_calls deltas to tool_use content_block_start + input_json_delta', async () => {
    const chunks: ChatCompletionChunk[] = [
      {
        ...baseChunk,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'search', arguments: '' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        ...baseChunk,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: '{"q":' },
                } as never,
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        ...baseChunk,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: '"cats"}' },
                } as never,
              ],
            },
            finish_reason: null,
          },
        ],
      },
      {
        ...baseChunk,
        choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      },
    ];
    const events = (await drain(
      chatCompletionStreamToAnthropic(iter(chunks), 'claude')
    )) as RawMessageStreamEvent[];
    const start = events.find(
      (e) =>
        (e as { type?: string }).type === 'content_block_start' &&
        (e as unknown as { content_block?: { type?: string } }).content_block
          ?.type === 'tool_use'
    );
    expect(start).toBeDefined();
    const deltas = events.filter(
      (e) =>
        (e as { type?: string }).type === 'content_block_delta' &&
        (e as unknown as { delta?: { type?: string } }).delta?.type ===
          'input_json_delta'
    );
    expect(deltas.length).toBe(2);
    const stop = events.find(
      (e) => (e as { type?: string }).type === 'message_delta'
    );
    expect(
      (stop as unknown as { delta?: { stop_reason?: string } }).delta
        ?.stop_reason
    ).toBe('tool_use');
  });

  it('maps finish_reason: length to stop_reason: max_tokens', async () => {
    const chunks: ChatCompletionChunk[] = [
      {
        ...baseChunk,
        choices: [
          { index: 0, delta: { content: 'partial' }, finish_reason: null },
        ],
      },
      {
        ...baseChunk,
        choices: [{ index: 0, delta: {}, finish_reason: 'length' }],
      },
    ];
    const events = (await drain(
      chatCompletionStreamToAnthropic(iter(chunks), 'claude')
    )) as RawMessageStreamEvent[];
    const md = events.find(
      (e) => (e as { type?: string }).type === 'message_delta'
    );
    expect(
      (md as unknown as { delta?: { stop_reason?: string } }).delta?.stop_reason
    ).toBe('max_tokens');
  });
});
