import { describe, expect, it } from 'vitest';
import type { ChatCompletionChunk } from 'openai/resources/index.js';
import type { ResponseStreamEvent } from 'openai/resources/responses/responses.js';
import type { RawMessageStreamEvent } from '@anthropic-ai/sdk/resources/messages';
import {
  detectStreamChunkShape,
  StreamUsageAccumulator,
} from '../../ai-provider/response-shape.helpers';

/**
 * Streaming envelope unit tests — verifies the per-shape stream chunk
 * detector and the stateful usage accumulator that the orchestrator's
 * `createDataStream` uses to extract usage from any of the three
 * native stream shapes.
 */

describe('detectStreamChunkShape', () => {
  it('detects OpenAI Chat Completion chunks via `choices` array', () => {
    const c = {
      object: 'chat.completion.chunk',
      choices: [],
    } as unknown as ChatCompletionChunk;
    expect(detectStreamChunkShape(c)).toBe('openai-chat-completion-chunk');
  });

  it('detects OpenAI Responses events via `type: response.*`', () => {
    expect(detectStreamChunkShape({ type: 'response.created' })).toBe(
      'openai-response-event'
    );
    expect(detectStreamChunkShape({ type: 'response.output_text.delta' })).toBe(
      'openai-response-event'
    );
    expect(detectStreamChunkShape({ type: 'response.completed' })).toBe(
      'openai-response-event'
    );
  });

  it('detects Anthropic SSE events via the known type names', () => {
    expect(detectStreamChunkShape({ type: 'message_start' })).toBe(
      'anthropic-stream-event'
    );
    expect(detectStreamChunkShape({ type: 'content_block_delta' })).toBe(
      'anthropic-stream-event'
    );
    expect(detectStreamChunkShape({ type: 'message_stop' })).toBe(
      'anthropic-stream-event'
    );
  });

  it('returns unknown for unrecognised shapes', () => {
    expect(detectStreamChunkShape(null)).toBe('unknown');
    expect(detectStreamChunkShape(undefined)).toBe('unknown');
    expect(detectStreamChunkShape({})).toBe('unknown');
    expect(detectStreamChunkShape({ foo: 'bar' })).toBe('unknown');
  });
});

describe('StreamUsageAccumulator', () => {
  it('accumulates OpenAI ChatCompletion usage on the final chunk', () => {
    const acc = new StreamUsageAccumulator();
    const chunks: ChatCompletionChunk[] = [
      {
        id: 'c1',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'm',
        choices: [
          {
            index: 0,
            delta: { content: 'hi' },
            finish_reason: null,
            logprobs: null,
          },
        ],
      } as ChatCompletionChunk,
      {
        id: 'c1',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'm',
        choices: [
          { index: 0, delta: {}, finish_reason: 'stop', logprobs: null },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      } as ChatCompletionChunk,
    ];
    for (const c of chunks) acc.update(c);
    expect(acc.snapshot()).toEqual({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    });
  });

  it('accumulates OpenAI Responses usage on response.completed', () => {
    const acc = new StreamUsageAccumulator();
    const events: ResponseStreamEvent[] = [
      { type: 'response.created' } as never,
      { type: 'response.in_progress' } as never,
      { type: 'response.output_text.delta', delta: 'hi' } as never,
      {
        type: 'response.completed',
        response: {
          object: 'response',
          output: [],
          usage: {
            input_tokens: 7,
            output_tokens: 3,
            total_tokens: 10,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens_details: { reasoning_tokens: 0 },
          },
        },
      } as never,
    ];
    for (const e of events) acc.update(e);
    const snap = acc.snapshot();
    expect(snap?.prompt_tokens).toBe(7);
    expect(snap?.completion_tokens).toBe(3);
    expect(snap?.total_tokens).toBe(10);
  });

  it('accumulates Anthropic Messages usage stateful across message_start + message_delta + message_stop', () => {
    const acc = new StreamUsageAccumulator();
    const events: RawMessageStreamEvent[] = [
      {
        type: 'message_start',
        message: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 5,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          } as never,
        } as never,
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' } as never,
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'hi' } as never,
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: {
          stop_reason: 'end_turn',
          stop_sequence: null,
          container: null,
          stop_details: null,
        },
        usage: {
          input_tokens: 5,
          output_tokens: 2,
        } as never,
      },
      { type: 'message_stop' },
    ];

    for (const e of events) acc.update(e);
    const snap = acc.snapshot();
    expect(snap?.prompt_tokens).toBe(5);
    expect(snap?.completion_tokens).toBe(2);
    expect(snap?.total_tokens).toBe(7);
  });

  it('reads cumulative output_tokens last-wins across multiple message_delta events', () => {
    const acc = new StreamUsageAccumulator();
    const events: RawMessageStreamEvent[] = [
      {
        type: 'message_start',
        message: {
          id: 'msg_2',
          type: 'message',
          role: 'assistant',
          model: 'claude',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10 } as never,
        } as never,
      },
      // Anthropic typically emits one message_delta near the end with
      // the final cumulative output_tokens, but the accumulator must
      // still handle multiple correctly.
      {
        type: 'message_delta',
        delta: {
          stop_reason: null,
          stop_sequence: null,
          container: null,
          stop_details: null,
        },
        usage: { output_tokens: 5 } as never,
      },
      {
        type: 'message_delta',
        delta: {
          stop_reason: 'end_turn',
          stop_sequence: null,
          container: null,
          stop_details: null,
        },
        usage: { output_tokens: 12 } as never,
      },
      { type: 'message_stop' },
    ];

    for (const e of events) acc.update(e);
    const snap = acc.snapshot();
    expect(snap?.prompt_tokens).toBe(10);
    expect(snap?.completion_tokens).toBe(12);
  });
});
