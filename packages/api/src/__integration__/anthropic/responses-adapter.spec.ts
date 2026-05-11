import { describe, expect, it } from 'vitest';
import type {
  ResponseCreateParams,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses.js';
import type {
  Message as AnthropicMessage,
  RawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages';
import {
  requestResponsesToAnthropic,
  responseAnthropicToResponses,
  streamAnthropicToResponses,
} from '../../ai-provider/anthropic/openai-response.provider';

/**
 * Adapter unit tests for the direct Responses ↔ Anthropic converter.
 * Validates the request mapping, the non-streaming response mapping,
 * and the streaming event sequence — three independent pure functions
 * with no SDK dependency.
 */

describe('Responses → Anthropic request adapter', () => {
  it('maps a simple string `input` to a single user message', () => {
    const req: ResponseCreateParams = {
      model: 'claude-haiku-4-5',
      input: 'hello',
      max_output_tokens: 128,
    } as ResponseCreateParams;
    const out = requestResponsesToAnthropic(req);
    expect(out.model).toBe('claude-haiku-4-5');
    expect(out.max_tokens).toBe(128);
    expect(out.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('maps `instructions` to top-level `system`', () => {
    const out = requestResponsesToAnthropic({
      model: 'claude-haiku-4-5',
      input: 'hi',
      instructions: 'be brief',
    } as ResponseCreateParams);
    // T7: instructions are emitted as TextBlockParam[] so passthrough
    // breakpoints can target system blocks by index.
    expect(out.system).toEqual([{ type: 'text', text: 'be brief' }]);
  });

  it('maps message-array `input` (user/assistant content blocks) to messages', () => {
    const out = requestResponsesToAnthropic({
      model: 'claude-haiku-4-5',
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'My name is Lucas.' }],
        },
        {
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Hello Lucas.' }],
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'What is my name?' }],
        },
      ] as never,
    } as ResponseCreateParams);
    expect(out.messages).toHaveLength(3);
    expect(out.messages[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'My name is Lucas.' }],
    });
    expect(out.messages[1]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello Lucas.' }],
    });
  });

  it('maps function_call + function_call_output items to tool_use / tool_result blocks', () => {
    const out = requestResponsesToAnthropic({
      model: 'claude-haiku-4-5',
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'weather?' }],
        },
        {
          type: 'function_call',
          id: 'fc_1',
          call_id: 'call_1',
          name: 'get_weather',
          arguments: JSON.stringify({ location: 'Tokyo' }),
        },
        {
          type: 'function_call_output',
          call_id: 'call_1',
          output: '15 °C, partly cloudy',
        },
      ] as never,
    } as ResponseCreateParams);

    expect(out.messages).toHaveLength(3);
    // 1: user text. 2: assistant tool_use. 3: user tool_result.
    expect(out.messages[1]).toMatchObject({
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'call_1',
          name: 'get_weather',
          input: { location: 'Tokyo' },
        },
      ],
    });
    expect(out.messages[2]).toMatchObject({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'call_1',
          content: '15 °C, partly cloudy',
        },
      ],
    });
  });

  it('maps function tools to Anthropic custom tools', () => {
    const out = requestResponsesToAnthropic({
      model: 'claude-haiku-4-5',
      input: 'pong',
      tools: [
        {
          type: 'function',
          name: 'get_weather',
          description: 'Weather lookup',
          parameters: {
            type: 'object',
            properties: { location: { type: 'string' } },
            required: ['location'],
          },
        },
      ] as never,
    } as ResponseCreateParams);
    expect(out.tools).toHaveLength(1);
    expect(out.tools![0]).toMatchObject({
      name: 'get_weather',
      description: 'Weather lookup',
      input_schema: expect.objectContaining({ type: 'object' }),
    });
  });

  it('maps tool_choice variants', () => {
    const auto = requestResponsesToAnthropic({
      model: 'm',
      input: 'x',
      tool_choice: 'auto',
      tools: [{ type: 'function', name: 't', parameters: {} }] as never,
    } as ResponseCreateParams);
    expect(auto.tool_choice).toMatchObject({ type: 'auto' });

    const required = requestResponsesToAnthropic({
      model: 'm',
      input: 'x',
      tool_choice: 'required',
      tools: [{ type: 'function', name: 't', parameters: {} }] as never,
    } as ResponseCreateParams);
    expect(required.tool_choice).toMatchObject({ type: 'any' });

    const named = requestResponsesToAnthropic({
      model: 'm',
      input: 'x',
      tool_choice: { type: 'function', name: 'pick_me' } as never,
      tools: [{ type: 'function', name: 'pick_me', parameters: {} }] as never,
    } as ResponseCreateParams);
    expect(named.tool_choice).toMatchObject({
      type: 'tool',
      name: 'pick_me',
    });
  });

  it('maps `reasoning.effort` to a thinking budget tier', () => {
    const out = requestResponsesToAnthropic({
      model: 'claude-haiku-4-5',
      input: 'pong',
      reasoning: { effort: 'high' },
    } as ResponseCreateParams);
    const thinking = (
      out as { thinking?: { type: string; budget_tokens: number } }
    ).thinking;
    expect(thinking).toBeDefined();
    expect(thinking!.type).toBe('enabled');
    expect(thinking!.budget_tokens).toBeGreaterThan(0);
  });
});

describe('Anthropic Message → Response adapter', () => {
  it('maps text + tool_use content blocks to output items', () => {
    const message = {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku-4-5',
      content: [
        { type: 'text', text: 'Here you go.' },
        {
          type: 'tool_use',
          id: 'call_1',
          name: 'get_weather',
          input: { location: 'Tokyo' },
        },
      ],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        server_tool_use: null,
        service_tier: null,
      } as never,
    } as unknown as AnthropicMessage;

    const resp = responseAnthropicToResponses(
      message,
      'resp_test',
      1717000000,
      'claude-haiku-4-5'
    );

    expect(resp.id).toBe('resp_test');
    expect(resp.object).toBe('response');
    expect(resp.status).toBe('completed');
    expect(resp.output).toHaveLength(2);

    const messageItem = resp.output.find((i) => i.type === 'message');
    expect(messageItem).toBeDefined();
    const fnCall = resp.output.find((i) => i.type === 'function_call');
    expect(fnCall).toMatchObject({ name: 'get_weather' });

    expect(resp.usage?.input_tokens).toBe(10);
    expect(resp.usage?.output_tokens).toBe(5);
  });

  it('maps thinking blocks to reasoning output items', () => {
    const message = {
      id: 'msg_2',
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku-4-5',
      content: [
        { type: 'thinking', thinking: 'Let me think...', signature: 'sig' },
        { type: 'text', text: 'Answer' },
      ] as never,
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 4,
        output_tokens: 2,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        server_tool_use: null,
        service_tier: null,
      } as never,
    } as unknown as AnthropicMessage;

    const resp = responseAnthropicToResponses(
      message,
      'r',
      0,
      'claude-haiku-4-5'
    );
    const reasoning = resp.output.find((i) => i.type === 'reasoning');
    expect(reasoning).toBeDefined();
  });

  it('maps stop_reason: max_tokens to status: incomplete', () => {
    const message = {
      id: 'msg_3',
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku-4-5',
      content: [{ type: 'text', text: 'Truncated...' }],
      stop_reason: 'max_tokens',
      stop_sequence: null,
      usage: {
        input_tokens: 4,
        output_tokens: 100,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        server_tool_use: null,
        service_tier: null,
      } as never,
    } as unknown as AnthropicMessage;
    const resp = responseAnthropicToResponses(
      message,
      'r',
      0,
      'claude-haiku-4-5'
    );
    expect(resp.status).toBe('incomplete');
  });
});

describe('Anthropic stream → Response stream adapter', () => {
  async function* synth(events: RawMessageStreamEvent[]) {
    for (const e of events) yield e;
  }

  it('emits response.created → output_item.added → output_text.delta → completed', async () => {
    const events: RawMessageStreamEvent[] = [
      {
        type: 'message_start',
        message: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude-haiku-4-5',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 5, output_tokens: 0 } as never,
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
        delta: { type: 'text_delta', text: 'Hello' } as never,
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: ' world' } as never,
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
        usage: { input_tokens: 5, output_tokens: 2 } as never,
      },
      { type: 'message_stop' },
    ];

    const out: ResponseStreamEvent[] = [];
    for await (const ev of streamAnthropicToResponses(
      synth(events),
      'resp_stream',
      0,
      'claude-haiku-4-5'
    )) {
      out.push(ev);
    }

    const types = out.map((e) => (e as { type?: string }).type);
    expect(types).toContain('response.created');
    expect(types).toContain('response.in_progress');
    expect(types).toContain('response.output_item.added');
    expect(types).toContain('response.content_part.added');
    expect(types).toContain('response.output_text.delta');
    expect(types).toContain('response.output_text.done');
    expect(types).toContain('response.content_part.done');
    expect(types).toContain('response.output_item.done');
    expect(types).toContain('response.completed');

    // Reconstructed text should be the concatenated deltas.
    const reconstructed = out
      .filter(
        (e) => (e as { type?: string }).type === 'response.output_text.delta'
      )
      .map((e) => (e as { delta?: string }).delta ?? '')
      .join('');
    expect(reconstructed).toBe('Hello world');

    // Final completed event must carry usage.
    const completed = out.find(
      (e) => (e as { type?: string }).type === 'response.completed'
    ) as {
      response: { usage: { input_tokens: number; output_tokens: number } };
    };
    expect(completed.response.usage.input_tokens).toBe(5);
    expect(completed.response.usage.output_tokens).toBe(2);
  });

  it('translates tool_use stream events to function_call_arguments deltas', async () => {
    const events: RawMessageStreamEvent[] = [
      {
        type: 'message_start',
        message: {
          id: 'msg_t',
          type: 'message',
          role: 'assistant',
          model: 'claude-haiku-4-5',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 0 } as never,
        } as never,
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'tool_use',
          id: 'tu_1',
          name: 'get_weather',
          input: {},
        } as never,
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'input_json_delta',
          partial_json: '{"location":',
        } as never,
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'input_json_delta',
          partial_json: '"Tokyo"}',
        } as never,
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: {
          stop_reason: 'tool_use',
          stop_sequence: null,
          container: null,
          stop_details: null,
        },
        usage: { input_tokens: 10, output_tokens: 6 } as never,
      },
      { type: 'message_stop' },
    ];

    const out: ResponseStreamEvent[] = [];
    for await (const ev of streamAnthropicToResponses(
      synth(events),
      'resp_t',
      0,
      'claude-haiku-4-5'
    )) {
      out.push(ev);
    }

    const types = out.map((e) => (e as { type?: string }).type);
    expect(types).toContain('response.function_call_arguments.delta');
    expect(types).toContain('response.function_call_arguments.done');
    expect(types).toContain('response.completed');

    // The accumulated arguments should parse as JSON.
    const argsDeltas = out
      .filter(
        (e) =>
          (e as { type?: string }).type ===
          'response.function_call_arguments.delta'
      )
      .map((e) => (e as { delta?: string }).delta ?? '')
      .join('');
    expect(() => JSON.parse(argsDeltas)).not.toThrow();
    expect(JSON.parse(argsDeltas)).toEqual({ location: 'Tokyo' });
  });
});
