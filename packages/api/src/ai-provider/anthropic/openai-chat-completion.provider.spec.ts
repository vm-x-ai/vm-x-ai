import { describe, expect, it, vi } from 'vitest';
import type {
  ChatCompletion,
  ChatCompletionCreateParams,
} from 'openai/resources/index.js';
import {
  AnthropicOpenAICompletionProvider,
  anthropicResponseToChatCompletion,
  anthropicStreamToChatCompletionChunks,
  openAIRequestToAnthropic,
} from './openai-chat-completion.provider';
import type { AnthropicDispatcher } from './shared';
import type { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import type { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import type { AnthropicConnectionConfig } from './shared';
import type {
  AnthropicMessagesResponse,
  AnthropicContentBlockParam,
} from '../../gateway/anthropic/anthropic.types';
import type { RawMessageStreamEvent } from '@anthropic-ai/sdk/resources/messages';

/**
 * Class-layer tests for {@link AnthropicOpenAICompletionProvider} —
 * the cross-format `openAICompletion` handler on the Anthropic
 * provider. Converts OpenAI body via the canonical
 * `openAIRequestToAnthropic` adapter, then delegates to
 * `dispatcher.dispatch` (the converting variant that returns
 * ChatCompletion shape). Adapter is covered by
 * `__integration__/anthropic/adapter.spec.ts`; this spec pins the
 * class's adapter-call → model-substitution → dispatch chain.
 */

function makeConnection(): AIConnectionEntity<AnthropicConnectionConfig> {
  return {
    connectionId: 'conn-1',
    config: { apiKey: 'sk-ant-test' },
  } as unknown as AIConnectionEntity<AnthropicConnectionConfig>;
}

function makeModel(model = 'claude-haiku-4-5'): AIResourceModelConfigEntity {
  return { model } as AIResourceModelConfigEntity;
}

function makeDispatcherStub(): AnthropicDispatcher & {
  dispatch: ReturnType<typeof vi.fn>;
} {
  return { dispatch: vi.fn() } as unknown as AnthropicDispatcher & {
    dispatch: ReturnType<typeof vi.fn>;
  };
}

const openAIRequest: ChatCompletionCreateParams = {
  model: 'will-be-replaced',
  messages: [
    { role: 'system', content: 'Be concise.' },
    { role: 'user', content: 'ping' },
  ],
};

describe('AnthropicOpenAICompletionProvider — class layer', () => {
  it('converts OpenAI request → Anthropic shape and substitutes model', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatch.mockResolvedValue({
      data: {} as ChatCompletion,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AnthropicOpenAICompletionProvider(dispatcher);

    await provider.handle(
      openAIRequest,
      makeConnection(),
      makeModel('claude-haiku-4-5')
    );
    const passedBody = dispatcher.dispatch.mock.calls[0][0];
    expect(passedBody.model).toBe('claude-haiku-4-5');
    // System prompt becomes the top-level Anthropic `system` field.
    expect(passedBody.system).toBeDefined();
    // User message survives.
    expect(passedBody.messages).toEqual([
      expect.objectContaining({ role: 'user' }),
    ]);
  });

  it('forwards options to the dispatcher (signal, maxRetries, forwardHeaders)', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatch.mockResolvedValue({
      data: {} as ChatCompletion,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AnthropicOpenAICompletionProvider(dispatcher);

    const ac = new AbortController();
    const options = {
      signal: ac.signal,
      maxRetries: 2,
      forwardHeaders: { 'anthropic-beta': 'pdfs-2024-09-25' },
    };
    await provider.handle(
      openAIRequest,
      makeConnection(),
      makeModel(),
      options
    );
    expect(dispatcher.dispatch.mock.calls[0][3]).toBe(options);
  });

  it('returns the dispatcher result (already converted to ChatCompletion shape)', async () => {
    const dispatcher = makeDispatcherStub();
    const result = {
      data: { id: 'cmpl_1', object: 'chat.completion' } as ChatCompletion,
      headers: { 'x-request-id': 'req-via-dispatcher' },
      providerRequestPayload: { model: 'claude-haiku-4-5' },
    };
    dispatcher.dispatch.mockResolvedValue(result as never);
    const provider = new AnthropicOpenAICompletionProvider(dispatcher);

    const out = await provider.handle(
      openAIRequest,
      makeConnection(),
      makeModel()
    );
    expect(out).toBe(result);
  });

  it('dispatcher errors propagate untouched', async () => {
    const dispatcher = makeDispatcherStub();
    const err = new Error('dispatch failed');
    dispatcher.dispatch.mockRejectedValue(err);
    const provider = new AnthropicOpenAICompletionProvider(dispatcher);

    await expect(
      provider.handle(openAIRequest, makeConnection(), makeModel())
    ).rejects.toBe(err);
  });
});

describe('openAIRequestToAnthropic — converter', () => {
  it('preserves inline assistant text alongside tool_calls', () => {
    const body = openAIRequestToAnthropic({
      model: 'claude-haiku-4-5',
      messages: [
        { role: 'user', content: 'q' },
        {
          role: 'assistant',
          content: 'thinking out loud',
          tool_calls: [
            {
              id: 'toolu_1',
              type: 'function',
              function: { name: 'lookup', arguments: '{"q":"x"}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'toolu_1', content: 'result' },
      ],
    });
    const assistantMsg = body.messages.find((m) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
    const content = assistantMsg!.content as AnthropicContentBlockParam[];
    expect(content[0]).toEqual({ type: 'text', text: 'thinking out loud' });
    expect(content[1]).toMatchObject({
      type: 'tool_use',
      id: 'toolu_1',
      name: 'lookup',
    });
  });

  it('lifts assistant refusal content parts into text blocks', () => {
    const body = openAIRequestToAnthropic({
      model: 'claude-haiku-4-5',
      messages: [
        { role: 'user', content: 'q' },
        {
          role: 'assistant',
          content: [{ type: 'refusal', refusal: 'I can not help with that.' }],
        },
      ],
    });
    const assistantMsg = body.messages.find((m) => m.role === 'assistant');
    const content = assistantMsg!.content as AnthropicContentBlockParam[];
    expect(content).toEqual([
      { type: 'text', text: 'I can not help with that.' },
    ]);
  });

  it('coalesces consecutive tool messages into one Anthropic user turn', () => {
    const body = openAIRequestToAnthropic({
      model: 'claude-haiku-4-5',
      messages: [
        { role: 'user', content: 'q' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'toolu_a',
              type: 'function',
              function: { name: 'a', arguments: '{}' },
            },
            {
              id: 'toolu_b',
              type: 'function',
              function: { name: 'b', arguments: '{}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'toolu_a', content: 'r1' },
        { role: 'tool', tool_call_id: 'toolu_b', content: 'r2' },
      ],
    });
    const lastUser = body.messages.filter((m) => m.role === 'user').pop();
    const blocks = lastUser!.content as AnthropicContentBlockParam[];
    expect(blocks.filter((b) => b.type === 'tool_result')).toHaveLength(2);
  });

  it('maps tool_choice variants and disable_parallel_tool_use', () => {
    const body = openAIRequestToAnthropic({
      model: 'claude-haiku-4-5',
      messages: [{ role: 'user', content: 'q' }],
      tools: [
        {
          type: 'function',
          function: { name: 'f', parameters: { type: 'object' } },
        },
      ],
      tool_choice: 'required',
      parallel_tool_calls: false,
    });
    expect(body.tool_choice).toMatchObject({
      type: 'any',
      disable_parallel_tool_use: true,
    });
  });

  it('forwards reasoning_effort=high into thinking config with budget', () => {
    const body = openAIRequestToAnthropic({
      model: 'claude-haiku-4-5',
      messages: [{ role: 'user', content: 'q' }],
      reasoning_effort: 'high',
      max_completion_tokens: 8192,
    });
    expect(body.thinking).toMatchObject({
      type: 'enabled',
      budget_tokens: expect.any(Number),
    });
  });

  it('lifts an image data URL into a base64 image source block', () => {
    const body = openAIRequestToAnthropic({
      model: 'claude-haiku-4-5',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'describe' },
            {
              type: 'image_url',
              image_url: { url: 'data:image/png;base64,iVBORw0' },
            },
          ],
        },
      ],
    });
    const user = body.messages[0];
    const content = user.content as AnthropicContentBlockParam[];
    expect(content[1]).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0' },
    });
  });

  it('rejectExternalImageUrls=true throws for external URLs', () => {
    expect(() =>
      openAIRequestToAnthropic(
        {
          model: 'claude-haiku-4-5',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: { url: 'https://example.com/cat.png' },
                },
              ],
            },
          ],
        },
        { rejectExternalImageUrls: true }
      )
    ).toThrow();
  });

  it('filters empty stop strings before sending', () => {
    const body = openAIRequestToAnthropic({
      model: 'claude-haiku-4-5',
      messages: [{ role: 'user', content: 'q' }],
      stop: ['END', '', '##'],
    });
    expect(body.stop_sequences).toEqual(['END', '##']);
  });

  it('defaults max_tokens to 4096 when neither field set', () => {
    const body = openAIRequestToAnthropic({
      model: 'claude-haiku-4-5',
      messages: [{ role: 'user', content: 'q' }],
    });
    expect(body.max_tokens).toBe(4096);
  });

  it('honors max_completion_tokens over max_tokens', () => {
    const body = openAIRequestToAnthropic({
      model: 'claude-haiku-4-5',
      messages: [{ role: 'user', content: 'q' }],
      max_tokens: 100,
      max_completion_tokens: 200,
    });
    expect(body.max_tokens).toBe(200);
  });

  it('rejects n > 1 with a clean BAD_REQUEST', () => {
    expect(() =>
      openAIRequestToAnthropic({
        model: 'claude-haiku-4-5',
        messages: [{ role: 'user', content: 'q' }],
        n: 2,
      })
    ).toThrow(/single completion/i);
  });

  it('does not reject n === 1 (default) or n === null', () => {
    expect(() =>
      openAIRequestToAnthropic({
        model: 'claude-haiku-4-5',
        messages: [{ role: 'user', content: 'q' }],
        n: 1,
      })
    ).not.toThrow();
    expect(() =>
      openAIRequestToAnthropic({
        model: 'claude-haiku-4-5',
        messages: [{ role: 'user', content: 'q' }],
        n: null,
      })
    ).not.toThrow();
  });

  it('skips empty assistant messages with no content and no tool_calls', () => {
    const body = openAIRequestToAnthropic({
      model: 'claude-haiku-4-5',
      messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: '' },
        { role: 'user', content: 'follow-up' },
      ],
    });
    // The empty assistant turn must be dropped so Anthropic does not
    // 400 on `content: []`. The two user turns survive.
    expect(body.messages.map((m) => m.role)).toEqual(['user', 'user']);
  });

  it('skips empty assistant messages with content: null and no tool_calls', () => {
    const body = openAIRequestToAnthropic({
      model: 'claude-haiku-4-5',
      messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: null },
      ],
    });
    expect(body.messages.map((m) => m.role)).toEqual(['user']);
  });

  it('maps allowed_tools tool_choice (mode=required) to Anthropic any', () => {
    const body = openAIRequestToAnthropic({
      model: 'claude-haiku-4-5',
      messages: [{ role: 'user', content: 'q' }],
      tools: [
        {
          type: 'function',
          function: { name: 'f', parameters: { type: 'object' } },
        },
      ],
      tool_choice: {
        type: 'allowed_tools',
        allowed_tools: {
          mode: 'required',
          tools: [{ type: 'function', function: { name: 'f' } }],
        },
      },
    });
    expect(body.tool_choice).toMatchObject({ type: 'any' });
  });

  it('maps allowed_tools tool_choice (mode=auto) to Anthropic auto', () => {
    const body = openAIRequestToAnthropic({
      model: 'claude-haiku-4-5',
      messages: [{ role: 'user', content: 'q' }],
      tools: [
        {
          type: 'function',
          function: { name: 'f', parameters: { type: 'object' } },
        },
      ],
      tool_choice: {
        type: 'allowed_tools',
        allowed_tools: {
          mode: 'auto',
          tools: [{ type: 'function', function: { name: 'f' } }],
        },
      },
    });
    expect(body.tool_choice).toMatchObject({ type: 'auto' });
  });

  it('maps custom tool_choice to a named Anthropic tool', () => {
    const body = openAIRequestToAnthropic({
      model: 'claude-haiku-4-5',
      messages: [{ role: 'user', content: 'q' }],
      tools: [
        {
          type: 'custom',
          custom: { name: 'shell', description: 'shell runner' },
        } as unknown as ChatCompletionCreateParams['tools'] extends Array<
          infer T
        >
          ? T
          : never,
      ],
      tool_choice: {
        type: 'custom',
        custom: { name: 'shell' },
      } as unknown as ChatCompletionCreateParams['tool_choice'],
    });
    expect(body.tool_choice).toMatchObject({ type: 'tool', name: 'shell' });
  });

  it('coerces custom tool definitions into a function-shape Anthropic tool', () => {
    const body = openAIRequestToAnthropic({
      model: 'claude-haiku-4-5',
      messages: [{ role: 'user', content: 'q' }],
      tools: [
        {
          type: 'custom',
          custom: { name: 'shell', description: 'shell runner' },
        } as unknown as ChatCompletionCreateParams['tools'] extends Array<
          infer T
        >
          ? T
          : never,
      ],
    });
    expect(body.tools).toHaveLength(1);
    const synth = body.tools?.[0] as {
      name: string;
      description?: string;
      input_schema: Record<string, unknown>;
    };
    expect(synth).toMatchObject({
      name: 'shell',
      description: 'shell runner',
    });
    // Custom tools have no JSON schema; we synthesise one taking a
    // single `input: string` so the model can still invoke it.
    expect(synth.input_schema).toMatchObject({
      type: 'object',
      properties: { input: { type: 'string' } },
    });
  });

  it('converts custom assistant tool_calls into tool_use blocks', () => {
    const body = openAIRequestToAnthropic({
      model: 'claude-haiku-4-5',
      messages: [
        { role: 'user', content: 'q' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_custom_1',
              type: 'custom',
              custom: { name: 'shell', input: 'ls -la' },
            } as unknown as NonNullable<
              import('openai/resources/index.js').ChatCompletionAssistantMessageParam['tool_calls']
            >[number],
          ],
        },
      ],
    });
    const assistantMsg = body.messages.find((m) => m.role === 'assistant');
    const blocks = assistantMsg!.content as AnthropicContentBlockParam[];
    expect(blocks[0]).toMatchObject({
      type: 'tool_use',
      id: 'call_custom_1',
      name: 'shell',
      input: { input: 'ls -la' },
    });
  });

  it('parallel_tool_calls=false without explicit tool_choice defaults to auto+disable', () => {
    const body = openAIRequestToAnthropic({
      model: 'claude-haiku-4-5',
      messages: [{ role: 'user', content: 'q' }],
      tools: [
        {
          type: 'function',
          function: { name: 'f', parameters: { type: 'object' } },
        },
      ],
      parallel_tool_calls: false,
    });
    expect(body.tool_choice).toMatchObject({
      type: 'auto',
      disable_parallel_tool_use: true,
    });
  });

  it('forwards `user` into Anthropic metadata.user_id', () => {
    const body = openAIRequestToAnthropic({
      model: 'claude-haiku-4-5',
      messages: [{ role: 'user', content: 'q' }],
      user: 'user-abc-123',
    });
    expect(body.metadata).toMatchObject({ user_id: 'user-abc-123' });
  });

  it('json_object response_format appends a JSON system instruction', () => {
    const body = openAIRequestToAnthropic({
      model: 'claude-haiku-4-5',
      messages: [
        { role: 'system', content: 'Be terse.' },
        { role: 'user', content: 'q' },
      ],
      response_format: { type: 'json_object' },
    });
    expect(Array.isArray(body.system)).toBe(true);
    const parts = body.system as Array<{ type: 'text'; text: string }>;
    // Original system text is preserved; the JSON hint is appended.
    expect(parts[0].text).toBe('Be terse.');
    expect(parts[parts.length - 1].text).toMatch(/valid JSON/i);
  });
});

describe('anthropicResponseToChatCompletion', () => {
  const baseUsage: AnthropicMessagesResponse['usage'] = {
    input_tokens: 10,
    output_tokens: 5,
    cache_creation_input_tokens: null,
    cache_read_input_tokens: null,
    cache_creation: null,
    server_tool_use: null,
    service_tier: null,
    inference_geo: null,
  };

  it('maps text + tool_use blocks into message.content + tool_calls', () => {
    const response: AnthropicMessagesResponse = {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      container: null,
      model: 'claude-haiku-4-5',
      content: [
        { type: 'text', text: 'hello ', citations: null },
        {
          type: 'tool_use',
          id: 'toolu_a',
          name: 'lookup',
          input: { q: 'x' },
          caller: { type: 'direct' },
        },
      ],
      stop_reason: 'tool_use',
      stop_sequence: null,
      stop_details: null,
      usage: baseUsage,
    } as unknown as AnthropicMessagesResponse;

    const cc = anthropicResponseToChatCompletion(response, {
      model: 'claude-haiku-4-5',
    } as AIResourceModelConfigEntity);
    expect(cc.choices[0].message.content).toBe('hello ');
    expect(cc.choices[0].message.tool_calls).toHaveLength(1);
    expect(cc.choices[0].message.tool_calls?.[0]).toMatchObject({
      id: 'toolu_a',
      type: 'function',
      function: { name: 'lookup', arguments: JSON.stringify({ q: 'x' }) },
    });
    expect(cc.choices[0].finish_reason).toBe('tool_calls');
    expect(cc.usage?.prompt_tokens).toBe(10);
    expect(cc.usage?.completion_tokens).toBe(5);
    expect(cc.usage?.total_tokens).toBe(15);
  });

  it('surfaces refusal stop_details as message.refusal', () => {
    const response: AnthropicMessagesResponse = {
      id: 'msg_2',
      type: 'message',
      role: 'assistant',
      container: null,
      model: 'claude-haiku-4-5',
      content: [],
      stop_reason: 'refusal',
      stop_sequence: null,
      stop_details: {
        type: 'refusal',
        category: null,
        explanation: 'unsafe',
      },
      usage: baseUsage,
    } as unknown as AnthropicMessagesResponse;
    const cc = anthropicResponseToChatCompletion(response, {
      model: 'claude-haiku-4-5',
    } as AIResourceModelConfigEntity);
    expect(cc.choices[0].finish_reason).toBe('content_filter');
    expect(cc.choices[0].message.refusal).toBe('unsafe');
  });

  it('reports cache_read tokens under prompt_tokens_details.cached_tokens', () => {
    const response: AnthropicMessagesResponse = {
      id: 'msg_3',
      type: 'message',
      role: 'assistant',
      container: null,
      model: 'claude-haiku-4-5',
      content: [{ type: 'text', text: 'x', citations: null }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      stop_details: null,
      usage: { ...baseUsage, cache_read_input_tokens: 42 },
    } as unknown as AnthropicMessagesResponse;
    const cc = anthropicResponseToChatCompletion(response, {
      model: 'claude-haiku-4-5',
    } as AIResourceModelConfigEntity);
    expect(cc.usage?.prompt_tokens_details?.cached_tokens).toBe(42);
  });
});

describe('anthropicStreamToChatCompletionChunks', () => {
  async function* eventsFromArray(
    events: RawMessageStreamEvent[]
  ): AsyncIterable<RawMessageStreamEvent> {
    for (const e of events) yield e;
  }

  async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
    const out: T[] = [];
    for await (const v of iter) out.push(v);
    return out;
  }

  it('emits text deltas + a finish chunk with usage from message_stop', async () => {
    const events: RawMessageStreamEvent[] = [
      {
        type: 'message_start',
        message: {
          id: 'msg_x',
          type: 'message',
          role: 'assistant',
          content: [],
          model: 'claude',
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 10,
            output_tokens: 0,
            cache_read_input_tokens: 2,
            cache_creation_input_tokens: null,
          },
        },
      } as unknown as RawMessageStreamEvent,
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '', citations: null },
      } as unknown as RawMessageStreamEvent,
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'hello' },
      } as unknown as RawMessageStreamEvent,
      {
        type: 'content_block_stop',
        index: 0,
      } as unknown as RawMessageStreamEvent,
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 3 },
      } as unknown as RawMessageStreamEvent,
      { type: 'message_stop' } as unknown as RawMessageStreamEvent,
    ];
    const chunks = await collect(
      anthropicStreamToChatCompletionChunks(eventsFromArray(events), {
        model: 'claude',
      })
    );
    const textChunks = chunks.filter(
      (c) => typeof c.choices[0]?.delta?.content === 'string'
    );
    expect(
      textChunks.map((c) => c.choices[0].delta.content as string).join('')
    ).toBe('hello');
    const last = chunks[chunks.length - 1];
    expect(last.choices[0].finish_reason).toBe('stop');
    expect(last.usage?.prompt_tokens).toBe(10);
    expect(last.usage?.completion_tokens).toBe(3);
    expect(last.usage?.total_tokens).toBe(13);
    expect(last.usage?.prompt_tokens_details?.cached_tokens).toBe(2);
  });

  it('emits tool_call preamble + arg deltas keyed by tool index', async () => {
    const events: RawMessageStreamEvent[] = [
      {
        type: 'message_start',
        message: {
          id: 'm',
          type: 'message',
          role: 'assistant',
          content: [],
          model: 'claude',
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 5, output_tokens: 0 },
        },
      } as unknown as RawMessageStreamEvent,
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu_1', name: 'lookup' },
      } as unknown as RawMessageStreamEvent,
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"q":' },
      } as unknown as RawMessageStreamEvent,
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '"x"}' },
      } as unknown as RawMessageStreamEvent,
      {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use' },
        usage: { output_tokens: 1 },
      } as unknown as RawMessageStreamEvent,
      { type: 'message_stop' } as unknown as RawMessageStreamEvent,
    ];
    const chunks = await collect(
      anthropicStreamToChatCompletionChunks(eventsFromArray(events), {
        model: 'claude',
      })
    );
    const toolChunks = chunks.filter(
      (c) => c.choices[0]?.delta?.tool_calls != null
    );
    // First tool chunk has the id/name; subsequent ones carry arg deltas.
    expect(toolChunks[0].choices[0].delta.tool_calls?.[0]).toMatchObject({
      index: 0,
      id: 'toolu_1',
      function: { name: 'lookup', arguments: '' },
    });
    const args = toolChunks
      .slice(1)
      .map((c) => c.choices[0].delta.tool_calls?.[0]?.function?.arguments ?? '')
      .join('');
    expect(args).toBe('{"q":"x"}');
    expect(chunks[chunks.length - 1].choices[0].finish_reason).toBe(
      'tool_calls'
    );
  });

  it('honors message_delta cumulative usage updates (input + cache_read)', async () => {
    // Anthropic emits cumulative-last-wins values for input_tokens and
    // cache_read_input_tokens on `message_delta`. The converter must
    // adopt the later values; before the fix the gateway always read
    // from `message_start` and missed mid-stream updates.
    const events: RawMessageStreamEvent[] = [
      {
        type: 'message_start',
        message: {
          id: 'm',
          type: 'message',
          role: 'assistant',
          content: [],
          model: 'claude',
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 5,
            output_tokens: 0,
            cache_read_input_tokens: 1,
            cache_creation_input_tokens: null,
          },
        },
      } as unknown as RawMessageStreamEvent,
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '', citations: null },
      } as unknown as RawMessageStreamEvent,
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'ok' },
      } as unknown as RawMessageStreamEvent,
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        // Cumulative update: actual prompt cost was higher than the
        // tentative figure from message_start.
        usage: {
          input_tokens: 12,
          output_tokens: 2,
          cache_read_input_tokens: 7,
        },
      } as unknown as RawMessageStreamEvent,
      { type: 'message_stop' } as unknown as RawMessageStreamEvent,
    ];
    const chunks = await collect(
      anthropicStreamToChatCompletionChunks(eventsFromArray(events), {
        model: 'claude',
      })
    );
    const last = chunks[chunks.length - 1];
    expect(last.usage?.prompt_tokens).toBe(12);
    expect(last.usage?.completion_tokens).toBe(2);
    expect(last.usage?.prompt_tokens_details?.cached_tokens).toBe(7);
  });
});
