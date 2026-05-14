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

  it('promotes role:system/developer items into `system` (TextBlockParam[])', () => {
    const out = requestResponsesToAnthropic({
      model: 'claude-haiku-4-5',
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: 'be terse' }],
        },
        {
          role: 'developer',
          content: [{ type: 'input_text', text: 'use markdown' }],
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'hi' }],
        },
      ] as never,
      instructions: 'top-level prelude',
    } as ResponseCreateParams);
    // The top-level `instructions` lands first, then each system /
    // developer item appends a TextBlockParam — Anthropic accepts
    // multi-part `system` so the converter no longer fakes them as
    // `[system]`-prefixed user turns.
    expect(out.system).toEqual([
      { type: 'text', text: 'top-level prelude' },
      { type: 'text', text: 'be terse' },
      { type: 'text', text: 'use markdown' },
    ]);
    expect(out.messages).toHaveLength(1);
    expect(out.messages[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'hi' }],
    });
  });

  it('maps user-message `input_file` (data URL) → document base64 block', () => {
    const out = requestResponsesToAnthropic({
      model: 'claude-haiku-4-5',
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_file',
              file_data: 'data:application/pdf;base64,JVBERi0x',
              filename: 'spec.pdf',
            },
          ],
        },
      ] as never,
    } as ResponseCreateParams);
    const msg = out.messages[0] as unknown as {
      content: Array<Record<string, unknown>>;
    };
    expect(msg.content).toHaveLength(1);
    expect(msg.content[0]).toMatchObject({
      type: 'document',
      title: 'spec.pdf',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: 'JVBERi0x',
      },
    });
  });

  it('maps user-message `input_file` (file_url) → document url block', () => {
    const out = requestResponsesToAnthropic({
      model: 'claude-haiku-4-5',
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_file',
              file_url: 'https://files.example/spec.pdf',
              filename: 'spec.pdf',
            },
          ],
        },
      ] as never,
    } as ResponseCreateParams);
    const msg = out.messages[0] as unknown as {
      content: Array<Record<string, unknown>>;
    };
    expect(msg.content[0]).toMatchObject({
      type: 'document',
      title: 'spec.pdf',
      source: { type: 'url', url: 'https://files.example/spec.pdf' },
    });
  });

  it('passes function tool `strict` and `defer_loading` through to Anthropic', () => {
    const out = requestResponsesToAnthropic({
      model: 'claude-haiku-4-5',
      input: 'hi',
      tools: [
        {
          type: 'function',
          name: 'get_weather',
          description: 'd',
          parameters: { type: 'object', properties: {} },
          strict: true,
          defer_loading: true,
        },
      ] as never,
    } as ResponseCreateParams);
    expect(out.tools).toHaveLength(1);
    const tool = out.tools![0] as {
      strict?: boolean;
      defer_loading?: boolean;
    };
    expect(tool.strict).toBe(true);
    expect(tool.defer_loading).toBe(true);
  });

  it('omits tool `strict` / `defer_loading` when the Responses tool did not set them', () => {
    const out = requestResponsesToAnthropic({
      model: 'claude-haiku-4-5',
      input: 'hi',
      tools: [
        {
          type: 'function',
          name: 'get_weather',
          description: 'd',
          parameters: { type: 'object', properties: {} },
        },
      ] as never,
    } as ResponseCreateParams);
    const tool = out.tools![0] as {
      strict?: boolean;
      defer_loading?: boolean;
    };
    expect('strict' in tool).toBe(false);
    expect('defer_loading' in tool).toBe(false);
  });

  it('preserves multimodal function_call_output → tool_result content array', () => {
    const out = requestResponsesToAnthropic({
      model: 'claude-haiku-4-5',
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'go' }],
        },
        {
          type: 'function_call',
          call_id: 'c1',
          name: 'render',
          arguments: '{}',
        },
        {
          type: 'function_call_output',
          call_id: 'c1',
          output: [
            { type: 'input_text', text: 'see chart:' },
            {
              type: 'input_image',
              image_url: 'data:image/png;base64,AAAA',
            },
          ],
        },
      ] as never,
    } as ResponseCreateParams);
    // The function_call_output flows into a user-role tool_result block.
    const userTurns = out.messages.filter((m) => m.role === 'user');
    const last = userTurns[userTurns.length - 1] as unknown as {
      content: Array<Record<string, unknown>>;
    };
    const toolResult = last.content.find(
      (b) => (b as { type?: string }).type === 'tool_result'
    ) as { content?: unknown };
    expect(Array.isArray(toolResult?.content)).toBe(true);
    expect(toolResult?.content).toEqual([
      { type: 'text', text: 'see chart:' },
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: 'AAAA',
        },
      },
    ]);
  });

  it('folds text-only function_call_output content array back to a string', () => {
    const out = requestResponsesToAnthropic({
      model: 'claude-haiku-4-5',
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'go' }],
        },
        {
          type: 'function_call',
          call_id: 'c1',
          name: 'render',
          arguments: '{}',
        },
        {
          type: 'function_call_output',
          call_id: 'c1',
          output: [
            { type: 'input_text', text: 'part-a;' },
            { type: 'input_text', text: 'part-b' },
          ],
        },
      ] as never,
    } as ResponseCreateParams);
    const userTurns = out.messages.filter((m) => m.role === 'user');
    const last = userTurns[userTurns.length - 1] as unknown as {
      content: Array<Record<string, unknown>>;
    };
    const toolResult = last.content.find(
      (b) => (b as { type?: string }).type === 'tool_result'
    ) as { content?: unknown };
    expect(toolResult?.content).toBe('part-a;part-b');
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

  it('clamps the thinking budget below `max_output_tokens`', () => {
    // Anthropic rejects budgets ≥ max_tokens. The converter must clamp
    // so a callable Responses request with `max_output_tokens: 2048` +
    // `effort: 'high'` (raw 16384) does not 400 on Anthropic.
    const out = requestResponsesToAnthropic({
      model: 'claude-haiku-4-5',
      input: 'pong',
      reasoning: { effort: 'high' },
      max_output_tokens: 2048,
    } as ResponseCreateParams);
    const thinking = (
      out as { thinking?: { type: string; budget_tokens: number } }
    ).thinking;
    expect(thinking).toBeDefined();
    expect(thinking!.budget_tokens).toBeLessThan(2048);
    expect(thinking!.budget_tokens).toBeGreaterThanOrEqual(1024);
  });

  it('maps `reasoning.effort = "xhigh"` onto the high budget tier', () => {
    // The Responses API recently added `xhigh`; without an explicit
    // map the helper would return `null` and silently drop the
    // thinking config.
    const out = requestResponsesToAnthropic({
      model: 'claude-haiku-4-5',
      input: 'pong',
      reasoning: { effort: 'xhigh' as never },
    } as ResponseCreateParams);
    const thinking = (
      out as { thinking?: { type: string; budget_tokens: number } }
    ).thinking;
    expect(thinking).toBeDefined();
    expect(thinking!.budget_tokens).toBeGreaterThanOrEqual(1024);
  });

  it('maps `tool_choice = "none"` to Anthropic `{ type: "none" }`', () => {
    const out = requestResponsesToAnthropic({
      model: 'claude-haiku-4-5',
      input: 'x',
      tool_choice: 'none',
      tools: [{ type: 'function', name: 't', parameters: {} }] as never,
    } as ResponseCreateParams);
    expect(out.tool_choice).toEqual({ type: 'none' });
  });

  it('propagates `parallel_tool_calls: false` as `disable_parallel_tool_use`', () => {
    const out = requestResponsesToAnthropic({
      model: 'claude-haiku-4-5',
      input: 'x',
      tool_choice: 'auto',
      parallel_tool_calls: false,
      tools: [{ type: 'function', name: 't', parameters: {} }] as never,
    } as ResponseCreateParams);
    expect(out.tool_choice).toMatchObject({
      type: 'auto',
      disable_parallel_tool_use: true,
    });
  });

  it('defaults to `{ type: "auto", disable_parallel_tool_use: true }` when only `parallel_tool_calls: false` is set', () => {
    const out = requestResponsesToAnthropic({
      model: 'claude-haiku-4-5',
      input: 'x',
      parallel_tool_calls: false,
      tools: [{ type: 'function', name: 't', parameters: {} }] as never,
    } as ResponseCreateParams);
    expect(out.tool_choice).toMatchObject({
      type: 'auto',
      disable_parallel_tool_use: true,
    });
  });

  it('promotes a previous assistant `refusal` block into a text content block', () => {
    // `ResponseOutputRefusal` items on prior assistant turns carry
    // necessary conversation context. Anthropic has no `refusal`
    // ContentBlock — surface the refusal text as plain text so the
    // model sees what was previously refused on multi-turn flows.
    const out = requestResponsesToAnthropic({
      model: 'claude-haiku-4-5',
      input: [
        {
          type: 'message',
          role: 'assistant',
          content: [
            { type: 'refusal', refusal: 'I cannot help with that.' },
          ] as never,
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'why?' }],
        },
      ] as never,
    } as ResponseCreateParams);
    const assistant = out.messages.find(
      (m) => (m as { role?: string }).role === 'assistant'
    ) as unknown as { content: Array<Record<string, unknown>> };
    expect(assistant).toBeDefined();
    expect(assistant.content[0]).toMatchObject({
      type: 'text',
      text: 'I cannot help with that.',
    });
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

  it('populates `incomplete_details.reason = "max_output_tokens"` on max_tokens stop', () => {
    const message = {
      id: 'msg_id',
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku-4-5',
      content: [{ type: 'text', text: '...' }],
      stop_reason: 'max_tokens',
      stop_sequence: null,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
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
    expect(resp.incomplete_details).toEqual({ reason: 'max_output_tokens' });
  });

  it('maps stop_reason: refusal → status: incomplete + content_filter incomplete_details', () => {
    const message = {
      id: 'msg_refusal',
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku-4-5',
      content: [{ type: 'text', text: 'I cannot help with that.' }],
      stop_reason: 'refusal',
      stop_sequence: null,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
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
    expect(resp.incomplete_details).toEqual({ reason: 'content_filter' });
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

  it('captures cumulative cache tokens off message_delta into the final usage', async () => {
    // Anthropic's `MessageDeltaUsage` carries cumulative
    // `cache_read_input_tokens` / `cache_creation_input_tokens` on
    // every `message_delta`. Without propagation the final
    // `response.completed.usage.input_tokens_details.cached_tokens`
    // would lag the wire response on cache-hot turns.
    const events: RawMessageStreamEvent[] = [
      {
        type: 'message_start',
        message: {
          id: 'msg_cache',
          type: 'message',
          role: 'assistant',
          model: 'claude-haiku-4-5',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 3,
            output_tokens: 0,
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
        delta: { type: 'text_delta', text: 'ok' } as never,
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
          input_tokens: 3,
          output_tokens: 1,
          cache_read_input_tokens: 42,
          cache_creation_input_tokens: 7,
        } as never,
      },
      { type: 'message_stop' },
    ];

    const out: ResponseStreamEvent[] = [];
    for await (const ev of streamAnthropicToResponses(
      synth(events),
      'r',
      0,
      'claude-haiku-4-5'
    )) {
      out.push(ev);
    }
    const completed = out.find(
      (e) => (e as { type?: string }).type === 'response.completed'
    ) as {
      response: {
        usage: {
          input_tokens_details: {
            cached_tokens: number;
            cache_creation_input_tokens?: number;
          };
        };
      };
    };
    expect(completed.response.usage.input_tokens_details.cached_tokens).toBe(
      42
    );
    expect(
      completed.response.usage.input_tokens_details.cache_creation_input_tokens
    ).toBe(7);
  });
});
