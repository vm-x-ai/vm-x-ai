import { describe, expect, it, vi } from 'vitest';
import type {
  Response as OpenAIResponse,
  ResponseCreateParams,
} from 'openai/resources/responses/responses.js';
import type {
  Message as AnthropicSDKMessage,
  RawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages';
import { GroqAnthropicMessagesProvider } from './anthropic-messages.provider';
import type { GroqResponseProvider } from './openai-response.provider';
import type { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import type { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import type { OpenAIConnectionConfig } from '../openai/shared';
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';

/**
 * Class-layer unit tests for {@link GroqAnthropicMessagesProvider} —
 * the two-hop Anthropic Messages → Responses → Groq → Responses →
 * Anthropic Messages dispatcher.
 *
 * Conversion fidelity is owned by the canonical Anthropic ↔ Responses
 * adapter in `openai/anthropic-messages.provider.ts` (covered by its
 * spec and `__integration__/anthropic/responses-adapter.spec.ts`).
 * What this spec pins is the dispatcher seam:
 *
 * 1. The dispatcher hands a Responses-shape body (not the original
 *    Anthropic body) to the inner `GroqResponseProvider`. The inner
 *    provider's model substitution + envelope strip + Groq-specific
 *    typed-assistant-content normalisation + error mapping are
 *    exercised in `openai-response.provider.spec.ts`.
 * 2. Non-streaming response shape conforms to Anthropic SDK 0.95.1:
 *    `Message.container: null`, `TextBlock.citations: null`,
 *    `ToolUseBlock.caller: { type: 'direct' }`, full 8-field usage.
 * 3. Streaming response delegates to the canonical
 *    `streamResponsesToAnthropic` adapter — the dispatcher forwards
 *    the iterable verbatim with no per-event re-wrapping.
 * 4. Audit invariant: `providerRequestPayload` carries the Responses
 *    wire body (what the SDK saw), not the original Anthropic body.
 * 5. Anthropic-side `thinking.budget_tokens` is translated to
 *    `reasoning.effort` so Groq's GPT-OSS / Qwen3 / DeepSeek-R1
 *    reasoning models honour it.
 * 6. Anthropic-side `tool_choice.disable_parallel_tool_use` is
 *    translated to `parallel_tool_calls: false`.
 */

function makeConnection(): AIConnectionEntity<OpenAIConnectionConfig> {
  return {
    connectionId: 'conn-groq',
    config: { apiKey: 'gsk-test' },
  } as unknown as AIConnectionEntity<OpenAIConnectionConfig>;
}

function makeModel(
  model = 'llama-3.3-70b-versatile'
): AIResourceModelConfigEntity {
  return { model } as AIResourceModelConfigEntity;
}

function makeResponseStub(): GroqResponseProvider & {
  handle: ReturnType<typeof vi.fn>;
} {
  return { handle: vi.fn() } as unknown as GroqResponseProvider & {
    handle: ReturnType<typeof vi.fn>;
  };
}

const fakeResponsesShape: OpenAIResponse = {
  id: 'resp_groq_1',
  object: 'response',
  created_at: 1715000000,
  status: 'completed',
  model: 'llama-3.3-70b-versatile',
  output: [
    {
      type: 'message',
      id: 'msg_groq_1',
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
  },
} as unknown as OpenAIResponse;

const anthropicRequest: AnthropicMessagesRequest = {
  model: 'llama-3.3-70b-versatile',
  max_tokens: 128,
  messages: [{ role: 'user', content: 'ping' }],
};

describe('GroqAnthropicMessagesProvider — class layer', () => {
  it('delegates to GroqResponseProvider with a Responses-shape body', async () => {
    const responses = makeResponseStub();
    responses.handle.mockResolvedValue({
      data: fakeResponsesShape,
      headers: { 'x-groq-request-id': 'req-1' },
      providerRequestPayload: {
        model: 'llama-3.3-70b-versatile',
        input: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'ping' }],
          },
        ],
      },
    });
    const provider = new GroqAnthropicMessagesProvider(responses);

    await provider.handle(anthropicRequest, makeConnection(), makeModel());

    expect(responses.handle).toHaveBeenCalledOnce();
    const body = responses.handle.mock.calls[0][0] as ResponseCreateParams;
    // Anthropic `messages` was converted into Responses `input` items.
    // The user turn surfaces as a `message` item with typed input_text
    // content parts.
    expect(Array.isArray(body.input)).toBe(true);
    expect(body.input).toMatchObject([
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'ping' }],
      },
    ]);
    // The dispatcher forwards the model id from the request — the
    // inner provider substitutes `model.model` onto the wire body
    // itself.
    expect(body.model).toBe('llama-3.3-70b-versatile');
  });

  it('non-streaming response: Response → Anthropic Message with SDK 0.95.1 wire shape', async () => {
    const responses = makeResponseStub();
    responses.handle.mockResolvedValue({
      data: fakeResponsesShape,
      headers: {},
      providerRequestPayload: { model: 'llama-3.3-70b-versatile', input: [] },
    });
    const provider = new GroqAnthropicMessagesProvider(responses);

    const result = await provider.handle(
      anthropicRequest,
      makeConnection(),
      makeModel()
    );
    const data = result.data as AnthropicSDKMessage;
    expect(data.type).toBe('message');
    expect(data.role).toBe('assistant');
    expect(data.container).toBeNull();
    expect(data.stop_details).toBeNull();
    expect(data.content[0]).toMatchObject({
      type: 'text',
      text: 'pong',
      citations: null,
    });
    expect(Object.keys(data.usage).sort()).toEqual(
      [
        'cache_creation',
        'cache_creation_input_tokens',
        'cache_read_input_tokens',
        'input_tokens',
        'inference_geo',
        'output_tokens',
        'server_tool_use',
        'service_tier',
      ].sort()
    );
    expect(data.usage.input_tokens).toBe(5);
    expect(data.usage.output_tokens).toBe(1);
    expect(data.usage.cache_creation_input_tokens).toBeNull();
    expect(data.usage.cache_read_input_tokens).toBe(0);
    expect(data.usage.cache_creation).toBeNull();
    expect(data.usage.server_tool_use).toBeNull();
    expect(data.usage.service_tier).toBeNull();
    expect(data.usage.inference_geo).toBeNull();
  });

  it('non-streaming response: tool_use blocks carry `caller: { type: "direct" }`', async () => {
    const responses = makeResponseStub();
    const respWithTool: OpenAIResponse = {
      ...fakeResponsesShape,
      output: [
        {
          type: 'function_call',
          id: 'fc_groq_1',
          call_id: 'tool_groq_1',
          name: 'get_weather',
          arguments: '{"location":"Tokyo"}',
          status: 'completed',
        },
      ],
    } as unknown as OpenAIResponse;
    responses.handle.mockResolvedValue({
      data: respWithTool,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new GroqAnthropicMessagesProvider(responses);

    const result = await provider.handle(
      anthropicRequest,
      makeConnection(),
      makeModel()
    );
    const data = result.data as AnthropicSDKMessage;
    expect(data.content[0]).toEqual({
      type: 'tool_use',
      id: 'tool_groq_1',
      name: 'get_weather',
      input: { location: 'Tokyo' },
      caller: { type: 'direct' },
    });
    expect(data.stop_reason).toBe('tool_use');
  });

  it('streaming response: forwards ResponseStreamEvent stream through canonical Anthropic-event converter', async () => {
    const responses = makeResponseStub();
    async function* fakeRespStream() {
      yield {
        type: 'response.created',
        response: { id: 'resp_groq_stream' },
      } as never;
      yield {
        type: 'response.output_item.added',
        output_index: 0,
        item: {
          type: 'message',
          id: 'm1',
          role: 'assistant',
          status: 'in_progress',
          content: [],
        },
      } as never;
      yield {
        type: 'response.output_text.delta',
        item_id: 'm1',
        output_index: 0,
        content_index: 0,
        delta: 'po',
      } as never;
      yield {
        type: 'response.output_text.delta',
        item_id: 'm1',
        output_index: 0,
        content_index: 0,
        delta: 'ng',
      } as never;
      yield {
        type: 'response.output_item.done',
        output_index: 0,
        item: { type: 'message' },
      } as never;
      yield {
        type: 'response.completed',
        response: {
          status: 'completed',
          output: [{ type: 'message' }],
          usage: { input_tokens: 5, output_tokens: 2 },
        },
      } as never;
    }
    responses.handle.mockResolvedValue({
      data: fakeRespStream(),
      headers: {},
      providerRequestPayload: { model: 'llama-3.3-70b-versatile', input: [] },
    });
    const provider = new GroqAnthropicMessagesProvider(responses);

    const result = await provider.handle(
      { ...anthropicRequest, stream: true },
      makeConnection(),
      makeModel()
    );

    const events: RawMessageStreamEvent[] = [];
    for await (const ev of result.data as AsyncIterable<RawMessageStreamEvent>) {
      events.push(ev);
    }
    const types = events.map((e) => e.type);
    expect(types).toContain('message_start');
    expect(types).toContain('content_block_start');
    expect(types).toContain('content_block_delta');
    expect(types).toContain('content_block_stop');
    expect(types).toContain('message_delta');
    expect(types).toContain('message_stop');
    const start = events.find((e) => e.type === 'message_start');
    expect(start).toBeDefined();
    const startMsg = (start as { message: AnthropicSDKMessage }).message;
    expect(startMsg.model).toBe('llama-3.3-70b-versatile');
    expect(startMsg.container).toBeNull();
    expect(Object.keys(startMsg.usage).sort()).toEqual(
      [
        'cache_creation',
        'cache_creation_input_tokens',
        'cache_read_input_tokens',
        'input_tokens',
        'inference_geo',
        'output_tokens',
        'server_tool_use',
        'service_tier',
      ].sort()
    );
    const textParts = events
      .filter(
        (
          e
        ): e is Extract<
          RawMessageStreamEvent,
          { type: 'content_block_delta' }
        > => e.type === 'content_block_delta'
      )
      .map((e) => {
        const d = e.delta as { type: string; text?: string };
        return d.type === 'text_delta' ? d.text ?? '' : '';
      })
      .join('');
    expect(textParts).toBe('pong');
  });

  it('audit invariant: providerRequestPayload carries the Responses wire body (not the Anthropic body)', async () => {
    const responses = makeResponseStub();
    const innerWireBody = {
      model: 'llama-3.3-70b-versatile',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'ping' }],
        },
      ],
    };
    responses.handle.mockResolvedValue({
      data: fakeResponsesShape,
      headers: { 'x-groq-request-id': 'req-audit' },
      providerRequestPayload: innerWireBody,
    });
    const provider = new GroqAnthropicMessagesProvider(responses);

    const result = await provider.handle(
      anthropicRequest,
      makeConnection(),
      makeModel()
    );
    expect(result.providerRequestPayload).toBe(innerWireBody);
    expect(result.headers).toEqual({ 'x-groq-request-id': 'req-audit' });
  });

  it('translates Anthropic `thinking.budget_tokens` → Responses `reasoning.effort`', async () => {
    const responses = makeResponseStub();
    responses.handle.mockResolvedValue({
      data: fakeResponsesShape,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new GroqAnthropicMessagesProvider(responses);

    await provider.handle(
      {
        ...anthropicRequest,
        thinking: { type: 'enabled', budget_tokens: 4096 },
      },
      makeConnection(),
      makeModel()
    );
    const body = responses.handle.mock.calls[0][0] as ResponseCreateParams;
    expect(body.reasoning?.effort).toBe('medium');
  });

  it('translates Anthropic `tool_choice.disable_parallel_tool_use` → Responses `parallel_tool_calls: false`', async () => {
    const responses = makeResponseStub();
    responses.handle.mockResolvedValue({
      data: fakeResponsesShape,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new GroqAnthropicMessagesProvider(responses);

    await provider.handle(
      {
        ...anthropicRequest,
        tools: [
          {
            name: 'get_weather',
            input_schema: {
              type: 'object',
              properties: { location: { type: 'string' } },
            },
          },
        ],
        tool_choice: {
          type: 'auto',
          disable_parallel_tool_use: true,
        },
      },
      makeConnection(),
      makeModel()
    );
    const body = responses.handle.mock.calls[0][0] as ResponseCreateParams;
    expect(body.parallel_tool_calls).toBe(false);
  });

  it('forwards options (signal, maxRetries, forwardHeaders, timeoutMs) to the inner provider verbatim', async () => {
    const responses = makeResponseStub();
    responses.handle.mockResolvedValue({
      data: fakeResponsesShape,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new GroqAnthropicMessagesProvider(responses);

    const ac = new AbortController();
    const options = {
      signal: ac.signal,
      maxRetries: 3,
      timeoutMs: 5_000,
      forwardHeaders: { 'OpenAI-Beta': 'demo' },
    };
    await provider.handle(
      anthropicRequest,
      makeConnection(),
      makeModel(),
      options
    );
    expect(responses.handle.mock.calls[0][3]).toBe(options);
  });

  it('inner errors propagate (this class never converts errors)', async () => {
    const responses = makeResponseStub();
    const innerError = new Error('groq upstream 500');
    responses.handle.mockRejectedValue(innerError);
    const provider = new GroqAnthropicMessagesProvider(responses);

    await expect(
      provider.handle(anthropicRequest, makeConnection(), makeModel())
    ).rejects.toBe(innerError);
  });
});
