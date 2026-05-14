import { describe, expect, it, vi } from 'vitest';
import {
  OpenAIAnthropicMessagesProvider,
  requestAnthropicToResponses,
  responseResponsesToAnthropic,
  streamResponsesToAnthropic,
} from './anthropic-messages.provider';
import type { OpenAIResponseProvider } from './openai-response.provider';
import type { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import type { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import type { OpenAIConnectionConfig } from './shared';
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';
import type {
  Message as AnthropicMessage,
  RawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages';
import type {
  Response as OpenAIResponse,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses.js';
import { CompletionError } from '../../gateway/completion.types';

/**
 * Class-layer unit tests for {@link OpenAIAnthropicMessagesProvider} —
 * the D5 path: Anthropic Messages input pivots through OpenAI
 * **Responses** (not Chat Completions). The Anthropic↔Responses
 * adapter is canonical-owned by this file; the pure converter
 * functions are covered by `__integration__/anthropic/responses-adapter.spec.ts`.
 *
 * What's tested here:
 * 1. The class converts the request via `requestAnthropicToResponses`,
 *    delegates to `OpenAIResponseProvider.handle()`, then converts the
 *    response back via `responseResponsesToAnthropic` (non-stream) or
 *    `streamResponsesToAnthropic` (stream).
 * 2. The class doesn't strip vmx itself — the inner `OpenAIResponseProvider`
 *    does. We just assert the inner provider was called.
 * 3. `providerRequestPayload` from the inner provider flows back
 *    verbatim (the audit row records the Responses-shape body the SDK
 *    saw, not the original Anthropic request).
 */

function makeConnection(): AIConnectionEntity<OpenAIConnectionConfig> {
  return {
    connectionId: 'conn-1',
    config: { apiKey: 'sk-test' },
  } as unknown as AIConnectionEntity<OpenAIConnectionConfig>;
}

function makeModel(model = 'gpt-4o-mini'): AIResourceModelConfigEntity {
  return { model } as AIResourceModelConfigEntity;
}

/** Build a stub `OpenAIResponseProvider` whose `handle` is a vi spy. */
function makeResponseProviderStub(): OpenAIResponseProvider & {
  handle: ReturnType<typeof vi.fn>;
} {
  return { handle: vi.fn() } as unknown as OpenAIResponseProvider & {
    handle: ReturnType<typeof vi.fn>;
  };
}

const anthropicRequest: AnthropicMessagesRequest = {
  model: 'will-be-replaced',
  max_tokens: 100,
  messages: [{ role: 'user', content: 'ping' }],
};

const fakeResponsesShape: OpenAIResponse = {
  id: 'resp_1',
  object: 'response',
  created_at: 1715000000,
  status: 'completed',
  model: 'gpt-4o-mini',
  output: [
    {
      type: 'message',
      id: 'msg_1',
      role: 'assistant',
      status: 'completed',
      content: [
        { type: 'output_text', text: 'pong', annotations: [], logprobs: [] },
      ],
    },
  ],
  usage: {
    input_tokens: 5,
    output_tokens: 1,
    total_tokens: 6,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 },
  },
} as unknown as OpenAIResponse;

describe('OpenAIAnthropicMessagesProvider — class layer', () => {
  it('delegates to OpenAIResponseProvider with a Responses-shape body', async () => {
    const responseProvider = makeResponseProviderStub();
    responseProvider.handle.mockResolvedValue({
      data: fakeResponsesShape,
      headers: { 'x-request-id': 'req-1' },
      providerRequestPayload: { model: 'gpt-4o-mini', input: [] },
    });
    const provider = new OpenAIAnthropicMessagesProvider(responseProvider);

    await provider.handle(anthropicRequest, makeConnection(), makeModel());

    expect(responseProvider.handle).toHaveBeenCalledOnce();
    const responsesBody = responseProvider.handle.mock.calls[0][0];
    expect(responsesBody).toMatchObject({ model: 'will-be-replaced' });
    // Anthropic `messages` becomes Responses `input`.
    expect(responsesBody.input).toBeDefined();
    expect(Array.isArray(responsesBody.input)).toBe(true);
  });

  it('non-streaming response: converts Responses → Anthropic Message shape', async () => {
    const responseProvider = makeResponseProviderStub();
    responseProvider.handle.mockResolvedValue({
      data: fakeResponsesShape,
      headers: {},
      providerRequestPayload: { model: 'gpt-4o-mini', input: [] },
    });
    const provider = new OpenAIAnthropicMessagesProvider(responseProvider);

    const result = await provider.handle(
      anthropicRequest,
      makeConnection(),
      makeModel()
    );
    const data = result.data as AnthropicMessage;
    expect(data.type).toBe('message');
    expect(data.role).toBe('assistant');
    expect(data.content[0]).toMatchObject({ type: 'text', text: 'pong' });
    expect(data.usage.input_tokens).toBe(5);
    expect(data.usage.output_tokens).toBe(1);
  });

  it('streaming response: converts ResponseStreamEvent → RawMessageStreamEvent iterable', async () => {
    const responseProvider = makeResponseProviderStub();
    async function* fakeRespStream() {
      yield {
        type: 'response.created',
        response: { id: 'r1' },
      } as never;
      yield {
        type: 'response.output_item.added',
        output_index: 0,
        item: {
          type: 'message',
          id: 'msg_1',
          role: 'assistant',
          status: 'in_progress',
          content: [],
        },
      } as never;
      yield {
        type: 'response.output_text.delta',
        item_id: 'msg_1',
        output_index: 0,
        content_index: 0,
        delta: 'pong',
      } as never;
      yield {
        type: 'response.completed',
        response: fakeResponsesShape,
      } as never;
    }
    responseProvider.handle.mockResolvedValue({
      data: fakeRespStream(),
      headers: {},
      providerRequestPayload: { model: 'gpt-4o-mini', input: [] },
    });
    const provider = new OpenAIAnthropicMessagesProvider(responseProvider);

    const result = await provider.handle(
      { ...anthropicRequest, stream: true },
      makeConnection(),
      makeModel()
    );

    const events: Array<{ type: string }> = [];
    for await (const ev of result.data as AsyncIterable<{ type: string }>) {
      events.push(ev);
    }
    const types = events.map((e) => e.type);
    // Anthropic streaming envelope must contain at least the
    // canonical lifecycle events.
    expect(types).toContain('message_start');
    expect(types).toContain('content_block_delta');
    expect(types).toContain('message_stop');
  });

  it('forwards providerRequestPayload + headers from the inner Response provider', async () => {
    const responseProvider = makeResponseProviderStub();
    const innerPayload = {
      model: 'gpt-4o-mini',
      input: [{ role: 'user' }],
      instructions: 'hi',
    };
    responseProvider.handle.mockResolvedValue({
      data: fakeResponsesShape,
      headers: { 'x-request-id': 'req-via-inner' },
      providerRequestPayload: innerPayload,
    });
    const provider = new OpenAIAnthropicMessagesProvider(responseProvider);

    const result = await provider.handle(
      anthropicRequest,
      makeConnection(),
      makeModel()
    );
    expect(result.providerRequestPayload).toBe(innerPayload);
    expect(result.headers).toEqual({ 'x-request-id': 'req-via-inner' });
  });

  it('inner errors propagate (this class never converts errors)', async () => {
    const responseProvider = makeResponseProviderStub();
    const innerError = new Error('inner failed');
    responseProvider.handle.mockRejectedValue(innerError);
    const provider = new OpenAIAnthropicMessagesProvider(responseProvider);

    await expect(
      provider.handle(anthropicRequest, makeConnection(), makeModel())
    ).rejects.toBe(innerError);
  });

  it('forwards options (signal, maxRetries, forwardHeaders) to the inner provider', async () => {
    const responseProvider = makeResponseProviderStub();
    responseProvider.handle.mockResolvedValue({
      data: fakeResponsesShape,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new OpenAIAnthropicMessagesProvider(responseProvider);
    const ac = new AbortController();
    const options = {
      signal: ac.signal,
      maxRetries: 4,
      forwardHeaders: { 'OpenAI-Beta': 'b' },
    };
    await provider.handle(
      anthropicRequest,
      makeConnection(),
      makeModel(),
      options
    );
    expect(responseProvider.handle.mock.calls[0][3]).toBe(options);
  });
});

describe('requestAnthropicToResponses — request adapter', () => {
  it('maps Anthropic `metadata.user_id` to Responses `safety_identifier`', () => {
    const out = requestAnthropicToResponses({
      model: 'gpt-4o-mini',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'hi' }],
      metadata: { user_id: 'opaque-hash-123' },
    } as AnthropicMessagesRequest);
    expect(out.safety_identifier).toBe('opaque-hash-123');
  });

  it('maps Anthropic `service_tier` onto the Responses tier enum', () => {
    const priority = requestAnthropicToResponses({
      model: 'm',
      max_tokens: 8,
      messages: [{ role: 'user', content: 'x' }],
      service_tier: 'priority',
    } as unknown as AnthropicMessagesRequest);
    expect(priority.service_tier).toBe('priority');

    const standardOnly = requestAnthropicToResponses({
      model: 'm',
      max_tokens: 8,
      messages: [{ role: 'user', content: 'x' }],
      service_tier: 'standard_only',
    } as AnthropicMessagesRequest);
    expect(standardOnly.service_tier).toBe('default');

    const batch = requestAnthropicToResponses({
      model: 'm',
      max_tokens: 8,
      messages: [{ role: 'user', content: 'x' }],
      service_tier: 'batch' as never,
    } as AnthropicMessagesRequest);
    // Responses has no `batch` tier; `flex` is the closest match for
    // throughput-class workloads.
    expect(batch.service_tier).toBe('flex');
  });

  it('maps `tool_choice.disable_parallel_tool_use: true` to top-level `parallel_tool_calls: false`', () => {
    const out = requestAnthropicToResponses({
      model: 'm',
      max_tokens: 8,
      messages: [{ role: 'user', content: 'x' }],
      tools: [
        {
          name: 'get_weather',
          description: 'd',
          input_schema: { type: 'object', properties: {} },
        },
      ] as never,
      tool_choice: { type: 'auto', disable_parallel_tool_use: true } as never,
    } as AnthropicMessagesRequest);
    expect(out.parallel_tool_calls).toBe(false);
    expect(out.tool_choice).toBe('auto');
  });

  it('forwards Anthropic `thinking.budget_tokens` as `reasoning.effort`', () => {
    const out = requestAnthropicToResponses({
      model: 'm',
      max_tokens: 8000,
      messages: [{ role: 'user', content: 'x' }],
      thinking: { type: 'enabled', budget_tokens: 4096 } as never,
    } as AnthropicMessagesRequest);
    expect(out.reasoning?.effort).toBe('medium');
  });

  it('emits `stream: true` when the Anthropic request is streaming', () => {
    const out = requestAnthropicToResponses({
      model: 'm',
      max_tokens: 8,
      messages: [{ role: 'user', content: 'x' }],
      stream: true,
    } as AnthropicMessagesRequest);
    expect((out as { stream?: boolean }).stream).toBe(true);
  });

  it('drops Anthropic-only knobs (`stop_sequences`, `top_k`) with no equivalent on Responses', () => {
    const out = requestAnthropicToResponses({
      model: 'm',
      max_tokens: 8,
      messages: [{ role: 'user', content: 'x' }],
      stop_sequences: ['STOP'],
      top_k: 50,
    } as AnthropicMessagesRequest);
    expect((out as { stop?: unknown }).stop).toBeUndefined();
    expect((out as { top_k?: unknown }).top_k).toBeUndefined();
  });

  it('flattens `system: TextBlockParam[]` into a single `instructions` string', () => {
    const out = requestAnthropicToResponses({
      model: 'm',
      max_tokens: 8,
      messages: [{ role: 'user', content: 'x' }],
      system: [
        { type: 'text', text: 'be brief' },
        { type: 'text', text: 'and polite' },
      ] as never,
    } as AnthropicMessagesRequest);
    expect(out.instructions).toBe('be brief\nand polite');
  });

  it('converts `tool_use` + `tool_result` content blocks into function_call / function_call_output items', () => {
    const out = requestAnthropicToResponses({
      model: 'm',
      max_tokens: 64,
      messages: [
        { role: 'user', content: 'weather?' },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tu_1',
              name: 'get_weather',
              input: { location: 'Tokyo' },
            },
          ] as never,
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_1',
              content: '15 °C',
            },
          ] as never,
        },
      ],
    } as AnthropicMessagesRequest);
    const items = (out.input ?? []) as unknown as Array<
      Record<string, unknown>
    >;
    const fnCall = items.find((i) => i.type === 'function_call') as {
      call_id?: string;
      arguments?: string;
    };
    expect(fnCall).toBeDefined();
    expect(fnCall.call_id).toBe('tu_1');
    expect(JSON.parse(fnCall.arguments ?? '{}')).toEqual({
      location: 'Tokyo',
    });

    const fnOut = items.find((i) => i.type === 'function_call_output') as {
      call_id?: string;
      output?: string;
    };
    expect(fnOut).toBeDefined();
    expect(fnOut.call_id).toBe('tu_1');
    expect(fnOut.output).toBe('15 °C');
  });

  it('preserves multimodal `tool_result` content by emitting the input_text/input_image array shape', () => {
    const out = requestAnthropicToResponses({
      model: 'm',
      max_tokens: 64,
      messages: [
        { role: 'user', content: 'render' },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'tu_1',
              name: 'render',
              input: {},
            },
          ] as never,
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_1',
              content: [
                { type: 'text', text: 'see:' },
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: 'AAAA',
                  },
                },
              ],
            },
          ] as never,
        },
      ],
    } as AnthropicMessagesRequest);
    const fnOut = (out.input as unknown as Array<Record<string, unknown>>).find(
      (i) => i.type === 'function_call_output'
    ) as { output?: unknown };
    expect(Array.isArray(fnOut.output)).toBe(true);
    expect(fnOut.output).toEqual([
      { type: 'input_text', text: 'see:' },
      { type: 'input_image', image_url: 'data:image/png;base64,AAAA' },
    ]);
  });

  it('orders prior `thinking` reasoning items BEFORE the assistant message in the same turn', () => {
    const out = requestAnthropicToResponses({
      model: 'm',
      max_tokens: 64,
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'thinking',
              thinking: 'reasoning step',
              signature: 'sig-1',
            },
            { type: 'text', text: 'final answer' },
          ] as never,
        },
      ],
    } as AnthropicMessagesRequest);
    const items = (out.input ?? []) as unknown as Array<
      Record<string, unknown>
    >;
    expect(items[0].type).toBe('reasoning');
    expect((items[0] as { encrypted_content?: string }).encrypted_content).toBe(
      'sig-1'
    );
    expect(items[1].type).toBe('message');
  });

  it('drops the tool_choice when no tools are provided (Responses 400s on a tool_choice without tools)', () => {
    const out = requestAnthropicToResponses({
      model: 'm',
      max_tokens: 8,
      messages: [{ role: 'user', content: 'x' }],
      tool_choice: { type: 'auto' } as never,
    } as AnthropicMessagesRequest);
    expect(out.tools).toBeUndefined();
    expect(out.tool_choice).toBeUndefined();
  });

  it('maps `tool_choice = "none"` to the Responses string literal', () => {
    const out = requestAnthropicToResponses({
      model: 'm',
      max_tokens: 8,
      messages: [{ role: 'user', content: 'x' }],
      tools: [
        {
          name: 't',
          description: 'd',
          input_schema: { type: 'object', properties: {} },
        },
      ] as never,
      tool_choice: { type: 'none' } as never,
    } as AnthropicMessagesRequest);
    expect(out.tool_choice).toBe('none');
  });
});

describe('responseResponsesToAnthropic — response adapter', () => {
  function makeResp(overrides: Partial<OpenAIResponse> = {}): OpenAIResponse {
    return {
      id: 'resp_1',
      object: 'response',
      created_at: 1715000000,
      status: 'completed',
      model: 'gpt-4o-mini',
      output: [
        {
          type: 'message',
          id: 'm1',
          role: 'assistant',
          status: 'completed',
          content: [
            { type: 'output_text', text: 'hi', annotations: [], logprobs: [] },
          ],
        },
      ],
      usage: {
        input_tokens: 4,
        output_tokens: 1,
        total_tokens: 5,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
      ...overrides,
    } as unknown as OpenAIResponse;
  }

  it('populates all 8 SDK 0.95.1 `Usage` fields (nulls where unknown)', () => {
    const msg = responseResponsesToAnthropic(
      makeResp({
        usage: {
          input_tokens: 12,
          output_tokens: 7,
          total_tokens: 19,
          input_tokens_details: {
            cached_tokens: 3,
            cache_creation_input_tokens: 2,
          },
          output_tokens_details: { reasoning_tokens: 5 },
        } as never,
      }),
      'gpt-4o-mini'
    );
    const u = msg.usage as unknown as Record<string, unknown>;
    expect(u.input_tokens).toBe(12);
    expect(u.output_tokens).toBe(7);
    expect(u.cache_read_input_tokens).toBe(3);
    expect(u.cache_creation_input_tokens).toBe(2);
    expect(u.cache_creation).toBeNull();
    expect(u.inference_geo).toBeNull();
    expect(u.server_tool_use).toBeNull();
    expect(u.service_tier).toBeNull();
  });

  it('populates Message-level `container` and `stop_details` as null (SDK 0.95.1 required fields)', () => {
    const msg = responseResponsesToAnthropic(makeResp(), 'gpt-4o-mini');
    expect((msg as unknown as { container: null }).container).toBeNull();
    expect((msg as unknown as { stop_details: null }).stop_details).toBeNull();
  });

  it('TextBlock carries `citations: null` (SDK 0.95.1 required field)', () => {
    const msg = responseResponsesToAnthropic(makeResp(), 'gpt-4o-mini');
    expect(msg.content[0]).toMatchObject({
      type: 'text',
      text: 'hi',
      citations: null,
    });
  });

  it('ToolUseBlock carries `caller: { type: "direct" }` (SDK 0.95.1 required field)', () => {
    const msg = responseResponsesToAnthropic(
      makeResp({
        output: [
          {
            type: 'function_call',
            id: 'fc_1',
            call_id: 'tu_1',
            name: 'get_weather',
            arguments: '{"location":"Tokyo"}',
            status: 'completed',
          },
        ] as never,
      }),
      'gpt-4o-mini'
    );
    const tool = msg.content[0] as unknown as {
      type: string;
      id: string;
      caller: { type: string };
    };
    expect(tool.type).toBe('tool_use');
    expect(tool.id).toBe('tu_1');
    expect(tool.caller).toEqual({ type: 'direct' });
  });

  it('surfaces a Responses `refusal` content part as a plain text block', () => {
    const msg = responseResponsesToAnthropic(
      makeResp({
        output: [
          {
            type: 'message',
            id: 'm1',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'refusal', refusal: 'I cannot help with that.' }],
          },
        ] as never,
      }),
      'gpt-4o-mini'
    );
    expect(msg.content).toHaveLength(1);
    expect(msg.content[0]).toMatchObject({
      type: 'text',
      text: 'I cannot help with that.',
      citations: null,
    });
  });

  it('maps `status: incomplete` + `reason: content_filter` to `stop_reason: refusal`', () => {
    const msg = responseResponsesToAnthropic(
      makeResp({
        status: 'incomplete',
        incomplete_details: { reason: 'content_filter' } as never,
      }),
      'gpt-4o-mini'
    );
    expect(msg.stop_reason).toBe('refusal');
  });

  it('maps `status: incomplete` + `reason: max_output_tokens` to `stop_reason: max_tokens`', () => {
    const msg = responseResponsesToAnthropic(
      makeResp({
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' } as never,
      }),
      'gpt-4o-mini'
    );
    expect(msg.stop_reason).toBe('max_tokens');
  });

  it('maps presence of a function_call output item to `stop_reason: tool_use`', () => {
    const msg = responseResponsesToAnthropic(
      makeResp({
        output: [
          {
            type: 'function_call',
            id: 'fc_1',
            call_id: 'tu_1',
            name: 'tool',
            arguments: '{}',
            status: 'completed',
          },
        ] as never,
      }),
      'gpt-4o-mini'
    );
    expect(msg.stop_reason).toBe('tool_use');
  });

  it('surfaces reasoning `summary[].text` and `encrypted_content` as a ThinkingBlock', () => {
    const msg = responseResponsesToAnthropic(
      makeResp({
        output: [
          {
            type: 'reasoning',
            id: 'rs_1',
            summary: [{ type: 'summary_text', text: 'step-by-step…' }],
            encrypted_content: 'sig-blob',
          },
          {
            type: 'message',
            id: 'm1',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: 'answer', annotations: [] }],
          },
        ] as never,
      }),
      'gpt-4o-mini'
    );
    const thinking = msg.content.find((c) => c.type === 'thinking') as {
      thinking: string;
      signature: string;
    };
    expect(thinking).toBeDefined();
    expect(thinking.thinking).toBe('step-by-step…');
    expect(thinking.signature).toBe('sig-blob');
  });

  it('round-trips the `__vmx_redacted__:` sentinel back to a `redacted_thinking` block', () => {
    const msg = responseResponsesToAnthropic(
      makeResp({
        output: [
          {
            type: 'reasoning',
            id: 'rs_1',
            summary: [],
            encrypted_content: '__vmx_redacted__:OPAQUE',
          },
        ] as never,
      }),
      'gpt-4o-mini'
    );
    expect(msg.content[0]).toMatchObject({
      type: 'redacted_thinking',
      data: 'OPAQUE',
    });
  });
});

describe('streamResponsesToAnthropic — stream adapter', () => {
  async function* synth(events: ResponseStreamEvent[]) {
    for (const e of events) yield e;
  }

  it('emits message_start with all 8 Usage fields (zero-initialised)', async () => {
    const out: RawMessageStreamEvent[] = [];
    for await (const ev of streamResponsesToAnthropic(
      synth([
        {
          type: 'response.created',
          response: { id: 'resp_1' },
        } as never,
        {
          type: 'response.completed',
          response: {
            status: 'completed',
            output: [],
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        } as never,
      ]),
      'gpt-4o-mini'
    )) {
      out.push(ev);
    }
    const start = out.find((e) => e.type === 'message_start') as unknown as {
      message: { usage: Record<string, unknown> };
    };
    expect(start).toBeDefined();
    const usage = start.message.usage;
    expect(usage.input_tokens).toBe(0);
    expect(usage.output_tokens).toBe(0);
    expect(usage.cache_creation).toBeNull();
    expect(usage.cache_creation_input_tokens).toBeNull();
    expect(usage.cache_read_input_tokens).toBeNull();
    expect(usage.inference_geo).toBeNull();
    expect(usage.server_tool_use).toBeNull();
    expect(usage.service_tier).toBeNull();
  });

  it('surfaces a `response.refusal.delta` as an Anthropic `text_delta`', async () => {
    const out: RawMessageStreamEvent[] = [];
    for await (const ev of streamResponsesToAnthropic(
      synth([
        { type: 'response.created', response: { id: 'r' } } as never,
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: { type: 'message', id: 'm1', role: 'assistant', content: [] },
        } as never,
        {
          type: 'response.refusal.delta',
          output_index: 0,
          delta: 'I cannot',
        } as never,
        {
          type: 'response.output_item.done',
          output_index: 0,
          item: { type: 'message' },
        } as never,
        {
          type: 'response.completed',
          response: { status: 'completed', output: [{ type: 'message' }] },
        } as never,
      ]),
      'gpt-4o-mini'
    )) {
      out.push(ev);
    }
    const delta = out.find(
      (e) =>
        e.type === 'content_block_delta' &&
        (e as { delta: { type: string } }).delta.type === 'text_delta'
    ) as { delta: { type: string; text: string } };
    expect(delta).toBeDefined();
    expect(delta.delta.text).toBe('I cannot');
  });

  it('emits content_block_start with `caller: { type: "direct" }` for function_call items', async () => {
    const out: RawMessageStreamEvent[] = [];
    for await (const ev of streamResponsesToAnthropic(
      synth([
        { type: 'response.created', response: { id: 'r' } } as never,
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: {
            type: 'function_call',
            id: 'fc',
            call_id: 'tu_1',
            name: 'get_weather',
            arguments: '',
          },
        } as never,
        {
          type: 'response.function_call_arguments.delta',
          output_index: 0,
          delta: '{"x":1}',
        } as never,
        {
          type: 'response.output_item.done',
          output_index: 0,
          item: { type: 'function_call' },
        } as never,
        {
          type: 'response.completed',
          response: {
            status: 'completed',
            output: [{ type: 'function_call' }],
            usage: { input_tokens: 5, output_tokens: 2 },
          },
        } as never,
      ]),
      'gpt-4o-mini'
    )) {
      out.push(ev);
    }
    const blockStart = out.find(
      (e) =>
        e.type === 'content_block_start' &&
        (e as { content_block: { type: string } }).content_block.type ===
          'tool_use'
    ) as unknown as { content_block: Record<string, unknown> };
    expect(blockStart).toBeDefined();
    expect(blockStart.content_block.caller).toEqual({ type: 'direct' });

    const final = out.find((e) => e.type === 'message_delta') as {
      delta: { stop_reason: string };
    };
    expect(final.delta.stop_reason).toBe('tool_use');
  });

  it('emits signature_delta before content_block_stop on reasoning items with encrypted_content', async () => {
    const out: RawMessageStreamEvent[] = [];
    for await (const ev of streamResponsesToAnthropic(
      synth([
        { type: 'response.created', response: { id: 'r' } } as never,
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: { type: 'reasoning', id: 'rs_1', summary: [] },
        } as never,
        {
          type: 'response.reasoning_summary_text.delta',
          output_index: 0,
          delta: 'step',
        } as never,
        {
          type: 'response.output_item.done',
          output_index: 0,
          item: { type: 'reasoning', encrypted_content: 'sig-1' },
        } as never,
        {
          type: 'response.completed',
          response: {
            status: 'completed',
            output: [{ type: 'reasoning' }],
            usage: { input_tokens: 1, output_tokens: 1 },
          },
        } as never,
      ]),
      'gpt-4o-mini'
    )) {
      out.push(ev);
    }
    const idxSig = out.findIndex(
      (e) =>
        e.type === 'content_block_delta' &&
        (e as { delta: { type: string } }).delta.type === 'signature_delta'
    );
    const idxStop = out.findIndex((e) => e.type === 'content_block_stop');
    expect(idxSig).toBeGreaterThanOrEqual(0);
    expect(idxStop).toBeGreaterThan(idxSig);
  });

  it('throws CompletionError on `response.failed`', async () => {
    await expect(async () => {
      const out: RawMessageStreamEvent[] = [];
      for await (const ev of streamResponsesToAnthropic(
        synth([
          { type: 'response.created', response: { id: 'r' } } as never,
          {
            type: 'response.failed',
            response: {
              error: { code: 'server_error', message: 'boom' },
            },
          } as never,
        ]),
        'gpt-4o-mini'
      )) {
        out.push(ev);
      }
    }).rejects.toBeInstanceOf(CompletionError);
  });

  it('throws CompletionError on a standalone `error` stream event', async () => {
    await expect(async () => {
      const out: RawMessageStreamEvent[] = [];
      for await (const ev of streamResponsesToAnthropic(
        synth([
          { type: 'response.created', response: { id: 'r' } } as never,
          {
            type: 'error',
            code: 'invalid_request',
            message: 'malformed',
            param: 'input',
          } as never,
        ]),
        'gpt-4o-mini'
      )) {
        out.push(ev);
      }
    }).rejects.toBeInstanceOf(CompletionError);
  });

  it('final message_delta carries the cumulative usage from `response.completed`', async () => {
    const out: RawMessageStreamEvent[] = [];
    for await (const ev of streamResponsesToAnthropic(
      synth([
        { type: 'response.created', response: { id: 'r' } } as never,
        {
          type: 'response.completed',
          response: {
            status: 'completed',
            output: [],
            usage: {
              input_tokens: 11,
              output_tokens: 3,
              input_tokens_details: {
                cached_tokens: 5,
                cache_creation_input_tokens: 2,
              },
            },
          },
        } as never,
      ]),
      'gpt-4o-mini'
    )) {
      out.push(ev);
    }
    const final = out.find((e) => e.type === 'message_delta') as unknown as {
      usage: Record<string, unknown>;
    };
    expect(final.usage.input_tokens).toBe(11);
    expect(final.usage.output_tokens).toBe(3);
    expect(final.usage.cache_read_input_tokens).toBe(5);
    expect(final.usage.cache_creation_input_tokens).toBe(2);
  });
});

describe('requestAnthropicToResponses — server tool fidelity', () => {
  it('maps Anthropic web_search onto Responses { type: "web_search" } with user_location + allowed_domains', () => {
    const out = requestAnthropicToResponses({
      model: 'm',
      max_tokens: 8,
      messages: [{ role: 'user', content: 'x' }],
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search',
          user_location: {
            type: 'approximate',
            city: 'Tokyo',
            country: 'JP',
            region: null,
            timezone: 'Asia/Tokyo',
          },
          allowed_domains: ['example.test'],
        },
      ] as never,
    } as AnthropicMessagesRequest);
    const tools = (out.tools ?? []) as unknown as Array<
      Record<string, unknown>
    >;
    expect(tools[0]).toMatchObject({
      type: 'web_search',
      user_location: { city: 'Tokyo', country: 'JP', timezone: 'Asia/Tokyo' },
      filters: { allowed_domains: ['example.test'] },
    });
  });

  it('maps Anthropic code_execution onto Responses code_interpreter with an auto container', () => {
    const out = requestAnthropicToResponses({
      model: 'm',
      max_tokens: 8,
      messages: [{ role: 'user', content: 'x' }],
      tools: [
        { type: 'code_execution_20260120', name: 'code_execution' },
      ] as never,
    } as AnthropicMessagesRequest);
    const tools = (out.tools ?? []) as unknown as Array<
      Record<string, unknown>
    >;
    expect(tools[0]).toEqual({
      type: 'code_interpreter',
      container: { type: 'auto' },
    });
  });

  it.each([
    ['bash_20250124', 'bash'],
    ['text_editor_20250728', 'str_replace_based_edit_tool'],
    ['memory_20250818', 'memory'],
    ['web_fetch_20260309', 'web_fetch'],
    ['tool_search_tool_regex_20251119', 'tool_search_tool_regex'],
  ])(
    'rejects %s with anthropic_server_tool_unsupported_on_openai_responses',
    (type, name) => {
      expect(() =>
        requestAnthropicToResponses({
          model: 'm',
          max_tokens: 8,
          messages: [{ role: 'user', content: 'x' }],
          tools: [{ type, name }] as never,
        } as AnthropicMessagesRequest)
      ).toThrowError(
        expect.objectContaining({
          data: expect.objectContaining({
            statusCode: 400,
            retryable: false,
            openAICompatibleError: expect.objectContaining({
              code: 'anthropic_server_tool_unsupported_on_openai_responses',
            }),
          }),
        })
      );
    }
  );

  it('lifts web_search_tool_result history blocks into a Responses output_text part', () => {
    const out = requestAnthropicToResponses({
      model: 'm',
      max_tokens: 16,
      messages: [
        { role: 'user', content: 'go' },
        {
          role: 'assistant',
          content: [
            {
              type: 'web_search_tool_result',
              tool_use_id: 'srv_1',
              content: [
                {
                  type: 'web_search_result',
                  title: 'Hit',
                  url: 'https://example.test/r',
                  encrypted_content: 'e',
                },
              ],
            },
          ] as never,
        },
      ],
    } as AnthropicMessagesRequest);
    const items = (out.input ?? []) as unknown as Array<{
      type?: string;
      role?: string;
      content?: Array<{ type?: string; text?: string }>;
    }>;
    const assistantMsg = items.find(
      (i) => i.type === 'message' && i.role === 'assistant'
    );
    const text = (assistantMsg?.content ?? [])
      .map((c) => c.text ?? '')
      .join('\n');
    expect(text).toContain('[web_search_tool_result]');
    expect(text).toContain('Hit');
  });

  it('lifts container_upload history blocks into a marker text part', () => {
    const out = requestAnthropicToResponses({
      model: 'm',
      max_tokens: 16,
      messages: [
        {
          role: 'user',
          content: [{ type: 'container_upload', file_id: 'file_123' }] as never,
        },
      ],
    } as AnthropicMessagesRequest);
    const items = (out.input ?? []) as unknown as Array<{
      type?: string;
      role?: string;
      content?: Array<{ type?: string; text?: string }>;
    }>;
    const userMsg = items.find(
      (i) => i.type === 'message' && i.role === 'user'
    );
    const text = (userMsg?.content ?? []).map((c) => c.text ?? '').join('\n');
    expect(text).toContain('[container_upload]');
    expect(text).toContain('file_id=file_123');
  });

  it('still maps custom function tools (regression guard)', () => {
    const out = requestAnthropicToResponses({
      model: 'm',
      max_tokens: 8,
      messages: [{ role: 'user', content: 'x' }],
      tools: [
        {
          name: 'get_weather',
          description: 'd',
          input_schema: { type: 'object', properties: {} },
        },
      ] as never,
    } as AnthropicMessagesRequest);
    expect(out.tools?.[0]).toMatchObject({
      type: 'function',
      name: 'get_weather',
    });
  });
});
