import { describe, expect, it, vi } from 'vitest';
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParams,
} from 'openai/resources/index.js';
import type {
  ConverseCommandOutput,
  ConverseStreamOutput,
} from '@aws-sdk/client-bedrock-runtime';
import { PinoLogger } from 'nestjs-pino';
import {
  AWSBedrockConverseOpenAICompletionProvider,
  CONVERSE_STRUCTURED_OUTPUT_TOOL_NAME,
  __TEST_ONLY__streamConverseToChatCompletionChunks,
} from './openai-chat-completion.provider';
import type { AWSBedrockConverseDispatcher } from './shared';
import type { AWSBedrockAIConnectionConfig } from './shared';
import type { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import type { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';

/**
 * Class-layer tests for {@link AWSBedrockConverseOpenAICompletionProvider}.
 * The provider now owns the Chat↔Converse conversion outright and
 * dispatches via `dispatcher.dispatchConverseRaw`. These tests pin the
 * delegation contract — the converter functions themselves are
 * exercised via the live `__integration__/providers/bedrock.spec.ts`
 * and `__integration__/converse/structured-output.spec.ts`.
 */

function makeLogger(): PinoLogger {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    setContext: vi.fn(),
  } as unknown as PinoLogger;
}

function makeConnection(
  overrides: Partial<AWSBedrockAIConnectionConfig> = {}
): AIConnectionEntity<AWSBedrockAIConnectionConfig> {
  return {
    connectionId: 'conn-1',
    config: {
      iamRoleArn: 'arn:aws:iam::123456789012:role/test',
      region: 'us-east-1',
      ...overrides,
    },
  } as unknown as AIConnectionEntity<AWSBedrockAIConnectionConfig>;
}

function makeModel(
  model = 'us.anthropic.claude-haiku-4-5-20251001-v1:0'
): AIResourceModelConfigEntity {
  return { model } as AIResourceModelConfigEntity;
}

type DispatchSpy = ReturnType<typeof vi.fn>;
type NormaliseSpy = ReturnType<typeof vi.fn>;

function makeDispatcherStub(): AWSBedrockConverseDispatcher & {
  dispatchConverseRaw: DispatchSpy;
  normaliseUsage: NormaliseSpy;
} {
  return {
    dispatchConverseRaw: vi.fn(),
    normaliseUsage: vi.fn().mockReturnValue(undefined),
  } as unknown as AWSBedrockConverseDispatcher & {
    dispatchConverseRaw: DispatchSpy;
    normaliseUsage: NormaliseSpy;
  };
}

const baseRequest: ChatCompletionCreateParams = {
  model: 'test',
  messages: [{ role: 'user', content: 'ping' }],
};

const fakeConverseOutput: ConverseCommandOutput = {
  $metadata: { requestId: 'req-1', extendedRequestId: 'req-1' },
  output: {
    message: {
      role: 'assistant',
      content: [{ text: 'hello' }],
    },
  },
  stopReason: 'end_turn',
  usage: undefined,
  metrics: { latencyMs: 42 },
} as unknown as ConverseCommandOutput;

describe('AWSBedrockConverseOpenAICompletionProvider — class layer', () => {
  it('builds a ConverseCommandInput, dispatches via dispatchConverseRaw, returns ChatCompletion', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchConverseRaw.mockResolvedValue({
      data: fakeConverseOutput,
      headers: { 'x-request-id': 'req-1' },
      providerRequestPayload: { modelId: 'test' },
    });
    const provider = new AWSBedrockConverseOpenAICompletionProvider(
      dispatcher,
      makeLogger()
    );

    const out = await provider.handle(
      baseRequest,
      makeConnection(),
      makeModel()
    );
    expect(dispatcher.dispatchConverseRaw).toHaveBeenCalledOnce();
    const [, streaming] = dispatcher.dispatchConverseRaw.mock.calls[0];
    expect(streaming).toBe(false);
    const data = out.data as ChatCompletion;
    expect(data.object).toBe('chat.completion');
    expect(data.choices[0].message.content).toBe('hello');
    expect(data.choices[0].finish_reason).toBe('stop');
  });

  it('passes through providerRequestPayload from the dispatcher', async () => {
    const dispatcher = makeDispatcherStub();
    const wireBody = {
      modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      messages: [],
    };
    dispatcher.dispatchConverseRaw.mockResolvedValue({
      data: fakeConverseOutput,
      headers: { 'x-request-id': 'req-1' },
      providerRequestPayload: wireBody,
    });
    const provider = new AWSBedrockConverseOpenAICompletionProvider(
      dispatcher,
      makeLogger()
    );

    const out = await provider.handle(
      baseRequest,
      makeConnection(),
      makeModel()
    );
    expect(out.providerRequestPayload).toBe(wireBody);
  });

  it('dispatcher errors propagate untouched', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchConverseRaw.mockRejectedValue(new Error('aws down'));
    const provider = new AWSBedrockConverseOpenAICompletionProvider(
      dispatcher,
      makeLogger()
    );

    await expect(
      provider.handle(baseRequest, makeConnection(), makeModel())
    ).rejects.toThrow('aws down');
  });

  it('passes streaming=true on the dispatch call when the request asks for a stream', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchConverseRaw.mockResolvedValue({
      data: (async function* () {
        yield {} as never;
      })(),
      headers: { 'x-request-id': 'req-1' },
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockConverseOpenAICompletionProvider(
      dispatcher,
      makeLogger()
    );

    await provider.handle(
      { ...baseRequest, stream: true },
      makeConnection(),
      makeModel()
    );
    expect(dispatcher.dispatchConverseRaw).toHaveBeenCalledOnce();
    const [, streaming] = dispatcher.dispatchConverseRaw.mock.calls[0];
    expect(streaming).toBe(true);
  });

  it('emits ToolChoice as an empty object, not boolean (Converse union shape)', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchConverseRaw.mockResolvedValue({
      data: fakeConverseOutput,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockConverseOpenAICompletionProvider(
      dispatcher,
      makeLogger()
    );
    await provider.handle(
      {
        ...baseRequest,
        tool_choice: 'auto',
        tools: [
          {
            type: 'function',
            function: {
              name: 'echo',
              description: 'echo',
              parameters: { type: 'object', properties: {} },
            },
          },
        ],
      } as ChatCompletionCreateParams,
      makeConnection(),
      makeModel()
    );
    const input = dispatcher.dispatchConverseRaw.mock.calls[0][0] as {
      toolConfig?: { toolChoice?: { auto?: unknown; any?: unknown } };
    };
    expect(input.toolConfig?.toolChoice).toEqual({ auto: {} });
  });

  it('maps tool_choice: "required" to { any: {} }', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchConverseRaw.mockResolvedValue({
      data: fakeConverseOutput,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockConverseOpenAICompletionProvider(
      dispatcher,
      makeLogger()
    );
    await provider.handle(
      {
        ...baseRequest,
        tool_choice: 'required',
        tools: [
          {
            type: 'function',
            function: {
              name: 'echo',
              description: 'echo',
              parameters: { type: 'object', properties: {} },
            },
          },
        ],
      } as ChatCompletionCreateParams,
      makeConnection(),
      makeModel()
    );
    const input = dispatcher.dispatchConverseRaw.mock.calls[0][0] as {
      toolConfig?: { toolChoice?: { auto?: unknown; any?: unknown } };
    };
    expect(input.toolConfig?.toolChoice).toEqual({ any: {} });
  });

  it('tool with omitted parameters falls back to an empty JSON schema', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchConverseRaw.mockResolvedValue({
      data: fakeConverseOutput,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockConverseOpenAICompletionProvider(
      dispatcher,
      makeLogger()
    );
    await provider.handle(
      {
        ...baseRequest,
        tools: [
          {
            type: 'function',
            function: { name: 'no_args' },
          },
        ],
      } as unknown as ChatCompletionCreateParams,
      makeConnection(),
      makeModel()
    );
    const input = dispatcher.dispatchConverseRaw.mock.calls[0][0] as {
      toolConfig?: { tools?: Array<{ toolSpec?: { inputSchema?: unknown } }> };
    };
    expect(
      (input.toolConfig?.tools?.[0]?.toolSpec?.inputSchema as { json: unknown })
        .json
    ).toEqual({ type: 'object', properties: {} });
  });

  it('substitutes a placeholder text block for empty assistant content', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchConverseRaw.mockResolvedValue({
      data: fakeConverseOutput,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockConverseOpenAICompletionProvider(
      dispatcher,
      makeLogger()
    );
    await provider.handle(
      {
        ...baseRequest,
        messages: [
          { role: 'user', content: 'q' },
          // Assistant turn that would otherwise serialise to `content: []`.
          { role: 'assistant', content: null } as never,
          { role: 'user', content: 'follow up' },
        ],
      } as ChatCompletionCreateParams,
      makeConnection(),
      makeModel()
    );
    const input = dispatcher.dispatchConverseRaw.mock.calls[0][0] as {
      messages: Array<{ role: string; content: Array<{ text?: string }> }>;
    };
    const assistant = input.messages.find((m) => m.role === 'assistant');
    expect(assistant?.content.length).toBeGreaterThan(0);
    expect(assistant?.content[0]).toHaveProperty('text');
  });

  it('maps data-URL image_url to ImageBlock with format inferred from media type', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchConverseRaw.mockResolvedValue({
      data: fakeConverseOutput,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockConverseOpenAICompletionProvider(
      dispatcher,
      makeLogger()
    );
    const tinyPngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGP4DwABAQEAG7buVgAAAABJRU5ErkJggg==';
    await provider.handle(
      {
        ...baseRequest,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'describe' },
              {
                type: 'image_url',
                image_url: { url: `data:image/png;base64,${tinyPngBase64}` },
              },
            ],
          },
        ],
      } as ChatCompletionCreateParams,
      makeConnection(),
      makeModel()
    );
    const input = dispatcher.dispatchConverseRaw.mock.calls[0][0] as {
      messages: Array<{
        role: string;
        content: Array<{ image?: { format?: string; source?: unknown } }>;
      }>;
    };
    const imgBlock = input.messages[0].content.find((b) => b.image)?.image;
    expect(imgBlock?.format).toBe('png');
    expect(imgBlock?.source).toBeDefined();
  });

  it('rejects an unknown image MIME with a 400 ValidationException', async () => {
    const dispatcher = makeDispatcherStub();
    const provider = new AWSBedrockConverseOpenAICompletionProvider(
      dispatcher,
      makeLogger()
    );
    await expect(
      provider.handle(
        {
          ...baseRequest,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: {
                    url: 'data:image/bmp;base64,aGVsbG8=',
                  },
                },
              ],
            },
          ],
        } as ChatCompletionCreateParams,
        makeConnection(),
        makeModel()
      )
    ).rejects.toThrow(/Unsupported image format/);
  });

  it('synthesizes a tool id for the deprecated assistant.function_call + tool/function pair', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchConverseRaw.mockResolvedValue({
      data: fakeConverseOutput,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockConverseOpenAICompletionProvider(
      dispatcher,
      makeLogger()
    );
    await provider.handle(
      {
        ...baseRequest,
        messages: [
          { role: 'user', content: 'lookup it' },
          {
            role: 'assistant',
            content: null,
            function_call: { name: 'lookup', arguments: '{}' },
          },
          { role: 'function', name: 'lookup', content: 'r1' } as never,
        ],
      } as ChatCompletionCreateParams,
      makeConnection(),
      makeModel()
    );
    const input = dispatcher.dispatchConverseRaw.mock.calls[0][0] as {
      messages: Array<{
        role: string;
        content: Array<{
          toolUse?: { toolUseId?: string };
          toolResult?: { toolUseId?: string };
        }>;
      }>;
    };
    const toolUseId = input.messages
      .flatMap((m) => m.content)
      .find((b) => b.toolUse)?.toolUse?.toolUseId;
    const toolResultId = input.messages
      .flatMap((m) => m.content)
      .find((b) => b.toolResult)?.toolResult?.toolUseId;
    expect(toolUseId).toBeDefined();
    expect(toolUseId).toBe(toolResultId);
  });

  it('forwards OpenAI reasoning_effort to additionalModelRequestFields.thinking', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchConverseRaw.mockResolvedValue({
      data: fakeConverseOutput,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockConverseOpenAICompletionProvider(
      dispatcher,
      makeLogger()
    );
    await provider.handle(
      {
        ...baseRequest,
        reasoning_effort: 'medium',
        max_tokens: 8192,
      } as ChatCompletionCreateParams,
      makeConnection(),
      makeModel()
    );
    const input = dispatcher.dispatchConverseRaw.mock.calls[0][0] as {
      additionalModelRequestFields?: {
        thinking?: { type?: string; budget_tokens?: number };
      };
    };
    expect(input.additionalModelRequestFields?.thinking).toMatchObject({
      type: 'enabled',
      budget_tokens: expect.any(Number),
    });
  });

  it('drops temperature and raises maxTokens above budget_tokens when thinking is enabled', async () => {
    // Anthropic on Bedrock rejects `temperature !== 1` whenever
    // `thinking.type === 'enabled'`, and requires
    // `max_tokens > budget_tokens`. The converter must enforce both
    // since callers using OpenAI's `reasoning_effort` have no way to
    // know the constraints exist.
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchConverseRaw.mockResolvedValue({
      data: fakeConverseOutput,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockConverseOpenAICompletionProvider(
      dispatcher,
      makeLogger()
    );
    await provider.handle(
      {
        ...baseRequest,
        reasoning_effort: 'high',
        temperature: 0.2,
        max_tokens: 512,
      } as ChatCompletionCreateParams,
      makeConnection(),
      makeModel()
    );
    const input = dispatcher.dispatchConverseRaw.mock.calls[0][0] as {
      inferenceConfig?: { temperature?: number; maxTokens?: number };
      additionalModelRequestFields?: {
        thinking?: { type?: string; budget_tokens?: number };
      };
    };
    expect(input.inferenceConfig?.temperature).toBeUndefined();
    const budget = input.additionalModelRequestFields?.thinking?.budget_tokens;
    expect(typeof budget).toBe('number');
    expect(input.inferenceConfig?.maxTokens).toBeGreaterThan(budget as number);
  });

  it('synthesises toolConfig.tools from history when caller omits tools[] but messages contain tool_use/tool_result', async () => {
    // Bedrock rejects any request whose `messages[]` references
    // `toolUse` / `toolResult` blocks without a matching
    // `toolConfig.tools[]`. The converter must synthesise minimal
    // placeholders from historical tool names so multi-turn
    // tool-result follow-ups (where the caller didn't redeclare tools)
    // pass Bedrock's pairing validator.
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchConverseRaw.mockResolvedValue({
      data: fakeConverseOutput,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockConverseOpenAICompletionProvider(
      dispatcher,
      makeLogger()
    );
    await provider.handle(
      {
        ...baseRequest,
        messages: [
          { role: 'user', content: "What's the temperature in Tokyo?" },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_weather_1',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: '{"location":"Tokyo"}',
                },
              },
            ],
          },
          {
            role: 'tool',
            tool_call_id: 'call_weather_1',
            content: '15 °C, partly cloudy',
          },
        ],
      } as ChatCompletionCreateParams,
      makeConnection(),
      makeModel()
    );
    const input = dispatcher.dispatchConverseRaw.mock.calls[0][0] as {
      toolConfig?: {
        tools?: Array<{ toolSpec?: { name?: string; inputSchema?: unknown } }>;
        toolChoice?: unknown;
      };
    };
    expect(input.toolConfig?.tools).toBeDefined();
    expect(input.toolConfig?.tools).toHaveLength(1);
    expect(input.toolConfig?.tools?.[0]?.toolSpec?.name).toBe('get_weather');
    // No toolChoice for synthesised history — let Bedrock pick auto.
    expect(input.toolConfig?.toolChoice).toBeUndefined();
  });

  it('does not double-up tools when caller provides tools[] explicitly even if history contains toolUse', async () => {
    // When the caller redeclares tools on the continuation turn the
    // converter must NOT also synthesise placeholders — that would
    // emit two entries for the same tool name (one with the real
    // schema, one with the empty placeholder) and the validator
    // rejects duplicates.
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchConverseRaw.mockResolvedValue({
      data: fakeConverseOutput,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockConverseOpenAICompletionProvider(
      dispatcher,
      makeLogger()
    );
    await provider.handle(
      {
        ...baseRequest,
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get the weather for a location',
              parameters: {
                type: 'object',
                properties: { location: { type: 'string' } },
                required: ['location'],
              },
            },
          },
        ],
        messages: [
          { role: 'user', content: "What's the temperature in Tokyo?" },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_weather_1',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: '{"location":"Tokyo"}',
                },
              },
            ],
          },
          {
            role: 'tool',
            tool_call_id: 'call_weather_1',
            content: '15 °C',
          },
        ],
      } as ChatCompletionCreateParams,
      makeConnection(),
      makeModel()
    );
    const input = dispatcher.dispatchConverseRaw.mock.calls[0][0] as {
      toolConfig?: {
        tools?: Array<{
          toolSpec?: {
            name?: string;
            description?: string;
            inputSchema?: { json?: { required?: string[] } };
          };
        }>;
      };
    };
    expect(input.toolConfig?.tools).toHaveLength(1);
    const spec = input.toolConfig?.tools?.[0]?.toolSpec;
    expect(spec?.name).toBe('get_weather');
    // The caller's real schema (with `required`) survives — proves we
    // didn't replace with the placeholder.
    expect(spec?.description).toBe('Get the weather for a location');
    expect(spec?.inputSchema?.json?.required).toEqual(['location']);
  });

  it('preserves inline assistant text alongside tool_calls', async () => {
    const dispatcher = makeDispatcherStub();
    dispatcher.dispatchConverseRaw.mockResolvedValue({
      data: fakeConverseOutput,
      headers: {},
      providerRequestPayload: {},
    });
    const provider = new AWSBedrockConverseOpenAICompletionProvider(
      dispatcher,
      makeLogger()
    );
    await provider.handle(
      {
        ...baseRequest,
        messages: [
          { role: 'user', content: 'q' },
          {
            role: 'assistant',
            content: 'thinking out loud',
            tool_calls: [
              {
                id: 'toolu_1',
                type: 'function',
                function: { name: 'lookup', arguments: '{}' },
              },
            ],
          },
          { role: 'tool', tool_call_id: 'toolu_1', content: 'r1' },
        ],
      } as ChatCompletionCreateParams,
      makeConnection(),
      makeModel()
    );
    const input = dispatcher.dispatchConverseRaw.mock.calls[0][0] as {
      messages: Array<{
        role: string;
        content: Array<{ text?: string; toolUse?: unknown }>;
      }>;
    };
    const assistant = input.messages.find((m) => m.role === 'assistant');
    expect(assistant?.content[0]).toEqual({ text: 'thinking out loud' });
    expect(assistant?.content[1]).toMatchObject({
      toolUse: expect.objectContaining({ name: 'lookup' }),
    });
  });
});

describe('streamConverseToChatCompletionChunks — converter', () => {
  async function* eventsFromArray(
    events: Array<Partial<ConverseStreamOutput>>
  ): AsyncIterable<ConverseStreamOutput> {
    for (const e of events) yield e as ConverseStreamOutput;
  }

  async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
    const out: T[] = [];
    for await (const v of iter) out.push(v);
    return out;
  }

  const fakeDispatcher = {
    normaliseUsage: vi.fn().mockReturnValue({
      prompt_tokens: 3,
      completion_tokens: 2,
      total_tokens: 5,
    }),
  } as unknown as AWSBedrockConverseDispatcher;

  it('skips unrecognised events instead of emitting empty chunks', async () => {
    const out = await collect(
      __TEST_ONLY__streamConverseToChatCompletionChunks(
        eventsFromArray([
          { messageStart: { role: 'assistant' } } as never,
          // Unrelated metadata block with no usage — must NOT yield an
          // empty `choices: []` chunk that downstream consumers can't parse.
          { metadata: { metrics: { latencyMs: 1 } } } as never,
          {
            messageStop: { stopReason: 'end_turn' },
          } as never,
        ]),
        { model: 'm' } as AIResourceModelConfigEntity,
        'req-1',
        fakeDispatcher
      )
    );
    // We only expect a single chunk: the message_stop → finish_reason.
    expect(out).toHaveLength(1);
    expect(out[0].choices[0].finish_reason).toBe('stop');
  });

  it('text deltas do not carry tool_calls and tool deltas do not carry content', async () => {
    const out = await collect(
      __TEST_ONLY__streamConverseToChatCompletionChunks(
        eventsFromArray([
          {
            contentBlockStart: {
              contentBlockIndex: 0,
              start: { toolUse: { name: 'lookup', toolUseId: 'tu_1' } },
            },
          } as never,
          {
            contentBlockDelta: {
              contentBlockIndex: 0,
              delta: { toolUse: { input: '{"q":"x"}' } },
            },
          } as never,
          {
            messageStop: { stopReason: 'tool_use' },
          } as never,
        ]),
        { model: 'm' } as AIResourceModelConfigEntity,
        'req-2',
        fakeDispatcher
      )
    );
    const toolStart = out[0];
    expect(toolStart.choices[0].delta.content).toBeUndefined();
    expect(toolStart.choices[0].delta.tool_calls?.[0]).toMatchObject({
      id: 'tu_1',
      function: { name: 'lookup' },
    });
    const toolDelta = out[1];
    expect(toolDelta.choices[0].delta.content).toBeUndefined();
    expect(toolDelta.choices[0].delta.tool_calls?.[0].function?.arguments).toBe(
      '{"q":"x"}'
    );
  });

  it('emits text content chunks for empty-string deltas (preserves stream parity)', async () => {
    const out = await collect(
      __TEST_ONLY__streamConverseToChatCompletionChunks(
        eventsFromArray([
          {
            contentBlockDelta: {
              contentBlockIndex: 0,
              delta: { text: '' },
            },
          } as never,
          {
            contentBlockDelta: {
              contentBlockIndex: 0,
              delta: { text: 'hello' },
            },
          } as never,
          { messageStop: { stopReason: 'end_turn' } } as never,
        ]),
        { model: 'm' } as AIResourceModelConfigEntity,
        'req-3',
        fakeDispatcher
      )
    );
    // The empty-string chunk is preserved (typeof guard) — second chunk has the real content.
    expect(out[0].choices[0].delta.content).toBe('');
    expect(out[1].choices[0].delta.content).toBe('hello');
  });

  it('unwraps synthetic structured-output tool fragments as content deltas (streaming)', async () => {
    const out = await collect(
      __TEST_ONLY__streamConverseToChatCompletionChunks(
        eventsFromArray([
          { messageStart: { role: 'assistant' } } as never,
          {
            contentBlockStart: {
              contentBlockIndex: 0,
              start: {
                toolUse: {
                  name: CONVERSE_STRUCTURED_OUTPUT_TOOL_NAME,
                  toolUseId: 'syn_1',
                },
              },
            },
          } as never,
          {
            contentBlockDelta: {
              contentBlockIndex: 0,
              delta: { toolUse: { input: '{"city":"Tokyo"}' } },
            },
          } as never,
          { messageStop: { stopReason: 'tool_use' } } as never,
        ]),
        { model: 'm' } as AIResourceModelConfigEntity,
        'req-so',
        fakeDispatcher,
        true
      )
    );
    // No `tool_calls` should ever surface for the synthetic tool — only
    // the content delta carrying the schema-shaped JSON and a `stop`
    // finish reason.
    const hasToolCallDelta = out.some((c) => c.choices?.[0]?.delta?.tool_calls);
    expect(hasToolCallDelta).toBe(false);
    const contentChunk = out.find((c) => c.choices?.[0]?.delta?.content);
    expect(contentChunk?.choices?.[0]?.delta?.content).toBe('{"city":"Tokyo"}');
    const stopChunk = out.find((c) => c.choices?.[0]?.finish_reason);
    expect(stopChunk?.choices?.[0]?.finish_reason).toBe('stop');
  });

  it('still surfaces real tool_calls when structuredOutputApplied is true', async () => {
    // Co-resident user tools must continue to flow normally even when
    // the structured-output shim is active on a separate block.
    const out = await collect(
      __TEST_ONLY__streamConverseToChatCompletionChunks(
        eventsFromArray([
          { messageStart: { role: 'assistant' } } as never,
          {
            contentBlockStart: {
              contentBlockIndex: 0,
              start: { toolUse: { name: 'lookup', toolUseId: 'tu_1' } },
            },
          } as never,
          {
            contentBlockDelta: {
              contentBlockIndex: 0,
              delta: { toolUse: { input: '{"q":"x"}' } },
            },
          } as never,
          { messageStop: { stopReason: 'tool_use' } } as never,
        ]),
        { model: 'm' } as AIResourceModelConfigEntity,
        'req-mixed',
        fakeDispatcher,
        true
      )
    );
    const toolStart = out.find((c) =>
      c.choices?.[0]?.delta?.tool_calls?.some(
        (tc) => tc.function?.name === 'lookup'
      )
    );
    expect(toolStart).toBeDefined();
  });

  it('attaches usage from metadata.usage events without emitting choices', async () => {
    const out = await collect(
      __TEST_ONLY__streamConverseToChatCompletionChunks(
        eventsFromArray([
          {
            metadata: {
              usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
            },
          } as never,
        ]),
        { model: 'm' } as AIResourceModelConfigEntity,
        'req-4',
        fakeDispatcher
      )
    );
    expect(out).toHaveLength(1);
    expect((out[0] as ChatCompletionChunk).choices).toEqual([]);
    expect((out[0] as ChatCompletionChunk).usage).toEqual({
      prompt_tokens: 3,
      completion_tokens: 2,
      total_tokens: 5,
    });
  });
});
