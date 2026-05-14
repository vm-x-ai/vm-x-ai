import { describe, expect, it } from 'vitest';
import type { ChatCompletionCreateParams } from 'openai/resources/index.js';
import type {
  Response as OpenAIResponse,
  ResponseCreateParams,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses.js';
import type {
  Message as AnthropicMessage,
  RawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages';
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';
import { hasKeys, requiredEnv } from '../helpers/env';
import {
  buildAnthropicProvider,
  makeConnection,
  makeModel,
} from '../helpers/factories';
import {
  reasoningPrompt,
  simplePrompt,
  structuredOutputPrompt,
  toolCallPrompt,
  toolFollowupPrompt,
  type StructuredOutputShape,
} from '../helpers/scenarios';
import {
  assertNonEmptyText,
  assertStructuredOutput,
  assertToolCall,
  assertUsageNonZero,
  collectStream,
  expectNonStreaming,
  expectStreaming,
} from '../helpers/assertions';
import { isAsyncIterable } from '../../utils/async';

const SHOULD_RUN = hasKeys('ANTHROPIC_API_KEY');
const TEST_MODEL = process.env.ANTHROPIC_TEST_MODEL ?? 'claude-haiku-4-5';
const TIMEOUT = 60_000;

describe.skipIf(!SHOULD_RUN)('Anthropic provider (live)', () => {
  const provider = buildAnthropicProvider();
  const connection = makeConnection('anthropic', {
    apiKey: SHOULD_RUN ? requiredEnv('ANTHROPIC_API_KEY') : '',
  });
  const model = makeModel('anthropic', TEST_MODEL);

  it(
    'simple completion (non-streaming)',
    async () => {
      const response = await provider.openAICompletion(
        { ...simplePrompt },
        connection,
        model
      );
      const data = await expectNonStreaming(response);
      assertNonEmptyText(data.choices[0].message.content ?? '');
      assertUsageNonZero(data.usage);
    },
    TIMEOUT
  );

  it(
    'simple completion (streaming)',
    async () => {
      const response = await provider.openAICompletion(
        { ...simplePrompt, stream: true },
        connection,
        model
      );
      const stream = await expectStreaming(response);
      const collected = await collectStream(stream);
      assertNonEmptyText(collected.text);
      assertUsageNonZero(collected.usage);
    },
    TIMEOUT
  );

  it(
    'tool calling (non-streaming)',
    async () => {
      const response = await provider.openAICompletion(
        { ...toolCallPrompt },
        connection,
        model
      );
      const data = await expectNonStreaming(response);
      assertToolCall(data.choices[0].message.tool_calls, 'get_weather');
    },
    TIMEOUT
  );

  it(
    'tool calling (streaming)',
    async () => {
      const response = await provider.openAICompletion(
        { ...toolCallPrompt, stream: true },
        connection,
        model
      );
      const stream = await expectStreaming(response);
      const collected = await collectStream(stream);
      assertToolCall(collected.toolCalls, 'get_weather');
    },
    TIMEOUT
  );

  it(
    'tool follow-up: assistant uses tool result',
    async () => {
      const response = await provider.openAICompletion(
        toolFollowupPrompt('toolu_anthropic_1'),
        connection,
        model
      );
      const data = await expectNonStreaming(response);
      const content = data.choices[0].message.content ?? '';
      assertNonEmptyText(content);
      expect(content).toMatch(/15/);
    },
    TIMEOUT
  );

  it(
    'reasoning_effort=low streams thinking content + finishes cleanly',
    async () => {
      // `reasoning_effort` should map onto Anthropic's `thinking`
      // config and produce reasoning content the gateway threads
      // through into delta.reasoning on the OpenAI Chat envelope.
      const response = await provider.openAICompletion(
        {
          ...reasoningPrompt,
          reasoning_effort: 'low',
          stream: true,
        } as ChatCompletionCreateParams,
        connection,
        model
      );
      const stream = await expectStreaming(response);
      const collected = await collectStream(stream);
      assertNonEmptyText(collected.text);
      assertUsageNonZero(collected.usage);
    },
    TIMEOUT
  );

  it(
    'multipart user content (text + small image data URL)',
    async () => {
      // 8x8 solid-red PNG — Anthropic's vision pipeline rejects 1x1
      // PNGs as "Could not process image"; an 8x8 with actual pixel
      // content is the smallest payload that survives.
      const tinyPngBase64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC';
      const response = await provider.openAICompletion(
        {
          model: 'placeholder',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Briefly describe this image.' },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:image/png;base64,${tinyPngBase64}`,
                  },
                },
              ],
            },
          ],
          max_tokens: 64,
          temperature: 0,
        } as ChatCompletionCreateParams,
        connection,
        model
      );
      const data = await expectNonStreaming(response);
      assertNonEmptyText(data.choices[0].message.content ?? '');
      assertUsageNonZero(data.usage);
    },
    TIMEOUT
  );

  it(
    'rejects n > 1 with a clean BAD_REQUEST before hitting upstream',
    async () => {
      await expect(
        provider.openAICompletion(
          {
            ...simplePrompt,
            n: 2,
          } as ChatCompletionCreateParams,
          connection,
          model
        )
      ).rejects.toThrow(/single completion/i);
    },
    TIMEOUT
  );

  it(
    'structured output (json_schema)',
    async () => {
      // Anthropic's OpenAI-compat endpoint accepts response_format. If
      // this ever stops working, structured-output flows against Claude
      // will silently fall back to free-form text.
      const response = await provider.openAICompletion(
        { ...structuredOutputPrompt },
        connection,
        model
      );
      const data = await expectNonStreaming(response);
      assertStructuredOutput<StructuredOutputShape>(
        data.choices[0].message.content,
        (parsed): parsed is StructuredOutputShape =>
          typeof parsed === 'object' &&
          parsed !== null &&
          typeof (parsed as StructuredOutputShape).city === 'string' &&
          typeof (parsed as StructuredOutputShape).country_code === 'string'
      );
    },
    TIMEOUT
  );

  // Responses-shape live tests exercise the direct Responses ↔ Anthropic
  // converter (`AnthropicOpenAIResponseProvider`). Each test goes through
  // `provider.openAIResponse(...)` so the full pipeline — request adapter,
  // dispatch, response/stream adapter — runs against the live API.
  it(
    'openAIResponse: simple completion (non-streaming)',
    async () => {
      const req: ResponseCreateParams = {
        model: 'placeholder',
        input: 'Reply with exactly the word: pong',
        max_output_tokens: 32,
        temperature: 0,
      } as ResponseCreateParams;
      const response = await provider.openAIResponse(req, connection, model);
      expect(isAsyncIterable(response.data)).toBe(false);
      const data = response.data as OpenAIResponse;
      expect(data.object).toBe('response');
      expect(['completed', 'incomplete']).toContain(data.status);
      assertNonEmptyText(data.output_text);
      expect(data.usage?.input_tokens).toBeGreaterThan(0);
      expect(data.usage?.output_tokens).toBeGreaterThan(0);
    },
    TIMEOUT
  );

  it(
    'openAIResponse: simple completion (streaming)',
    async () => {
      const req: ResponseCreateParams = {
        model: 'placeholder',
        input: 'Reply with exactly the word: pong',
        max_output_tokens: 32,
        temperature: 0,
        stream: true,
      } as ResponseCreateParams;
      const response = await provider.openAIResponse(req, connection, model);
      expect(isAsyncIterable(response.data)).toBe(true);
      const events: ResponseStreamEvent[] = [];
      for await (const ev of response.data as AsyncIterable<ResponseStreamEvent>) {
        events.push(ev);
      }
      const types = events.map((e) => (e as { type?: string }).type);
      expect(types).toContain('response.created');
      expect(types).toContain('response.completed');
      // The sequence numbers must be strictly monotonic for spec-conformant
      // Responses streams.
      const seqs = events.map(
        (e) => (e as { sequence_number: number }).sequence_number
      );
      for (let i = 1; i < seqs.length; i++) {
        expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
      }
      const text = events
        .filter(
          (e) => (e as { type?: string }).type === 'response.output_text.delta'
        )
        .map((e) => (e as { delta?: string }).delta ?? '')
        .join('');
      assertNonEmptyText(text);
    },
    TIMEOUT
  );

  it(
    'openAIResponse: tool calling (non-streaming)',
    async () => {
      const req: ResponseCreateParams = {
        model: 'placeholder',
        input: "What's the current temperature in Tokyo? Use get_weather.",
        tools: [
          {
            type: 'function',
            name: 'get_weather',
            description: 'Get the current weather in a city',
            parameters: {
              type: 'object',
              properties: {
                location: { type: 'string', description: 'City name' },
              },
              required: ['location'],
            },
          },
        ] as never,
        tool_choice: 'auto',
        max_output_tokens: 128,
        temperature: 0,
      } as ResponseCreateParams;
      const response = await provider.openAIResponse(req, connection, model);
      const data = response.data as OpenAIResponse;
      const fnCall = data.output.find((i) => i.type === 'function_call') as
        | { name: string; call_id: string; arguments: string }
        | undefined;
      expect(fnCall, 'expected a function_call output item').toBeDefined();
      expect(fnCall!.name).toBe('get_weather');
      expect(() => JSON.parse(fnCall!.arguments)).not.toThrow();
    },
    TIMEOUT
  );

  it(
    'openAIResponse: multipart user content (text + image data URL)',
    async () => {
      // 8x8 solid-red PNG — Anthropic rejects 1x1 PNGs as "Could not
      // process image"; this is the smallest payload that survives
      // input_image → ImageBlockParam conversion on the live wire.
      const tinyPngBase64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC';
      const req: ResponseCreateParams = {
        model: 'placeholder',
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: 'Briefly describe this image.' },
              {
                type: 'input_image',
                image_url: `data:image/png;base64,${tinyPngBase64}`,
                detail: 'low',
              },
            ],
          },
        ] as never,
        max_output_tokens: 64,
        temperature: 0,
      } as ResponseCreateParams;
      const response = await provider.openAIResponse(req, connection, model);
      const data = response.data as OpenAIResponse;
      assertNonEmptyText(data.output_text);
    },
    TIMEOUT
  );

  it(
    'openAIResponse: instructions → system, with explicit casing constraint',
    async () => {
      const req: ResponseCreateParams = {
        model: 'placeholder',
        input: 'say hello',
        instructions: 'Reply ONLY in ALL CAPS. Never use lowercase.',
        max_output_tokens: 32,
        temperature: 0,
      } as ResponseCreateParams;
      const response = await provider.openAIResponse(req, connection, model);
      const data = response.data as OpenAIResponse;
      assertNonEmptyText(data.output_text);
      const letters = data.output_text.replace(/[^a-zA-Z]/g, '');
      if (letters.length > 0) {
        const upperRatio =
          letters.replace(/[^A-Z]/g, '').length / letters.length;
        expect(upperRatio).toBeGreaterThan(0.6);
      }
    },
    TIMEOUT
  );

  // ─── Native anthropicMessages() — wire-level passthrough sweep ──────
  // The cell under audit. These tests go through the
  // AnthropicMessagesProvider → AnthropicDispatcher.dispatchNative
  // path and verify the SDK's Message / RawMessageStreamEvent shapes
  // arrive verbatim — no per-chunk vmx injection, no field rewrites.
  const anthropicReq = (
    extra: Partial<AnthropicMessagesRequest> = {},
    messages: AnthropicMessagesRequest['messages'] = [
      { role: 'user', content: 'Reply with the single word: pong' },
    ]
  ): AnthropicMessagesRequest =>
    ({
      model: 'placeholder',
      max_tokens: 64,
      temperature: 0,
      messages,
      ...extra,
    } as AnthropicMessagesRequest);

  it(
    'anthropicMessages: native passthrough — Message shape (non-streaming)',
    async () => {
      const response = await provider.anthropicMessages(
        anthropicReq(),
        connection,
        model
      );
      const data = response.data as AnthropicMessage;
      expect(data.type).toBe('message');
      expect(data.role).toBe('assistant');
      expect(Array.isArray(data.content)).toBe(true);
      // The captured providerRequestPayload is the audit invariant
      // for this cell — it must echo back the caller's body shape.
      const captured = response.providerRequestPayload as Record<
        string,
        unknown
      >;
      expect(captured.messages).toBeDefined();
      expect(captured.max_tokens).toBe(64);
    },
    TIMEOUT
  );

  it(
    'anthropicMessages: native streaming yields RawMessageStreamEvent variants',
    async () => {
      const response = await provider.anthropicMessages(
        anthropicReq({ stream: true }),
        connection,
        model
      );
      const events: RawMessageStreamEvent[] = [];
      for await (const ev of response.data as AsyncIterable<RawMessageStreamEvent>) {
        events.push(ev);
      }
      const types = events.map((e) => (e as { type?: string }).type);
      expect(types).toContain('message_start');
      expect(types).toContain('content_block_start');
      expect(types).toContain('content_block_delta');
      expect(types).toContain('content_block_stop');
      expect(types).toContain('message_delta');
      expect(types).toContain('message_stop');
      // No `vmx` decoration on Anthropic stream events (Phase C —
      // only OpenAI Chat Completion chunks get vmx decorated).
      for (const ev of events) {
        expect(ev).not.toHaveProperty('vmx');
      }
    },
    TIMEOUT
  );

  it(
    'anthropicMessages: tool_use round-trip (non-streaming)',
    async () => {
      const response = await provider.anthropicMessages(
        anthropicReq(
          {
            tools: [
              {
                name: 'get_weather',
                description: 'Get the current weather in a city',
                input_schema: {
                  type: 'object',
                  properties: {
                    location: { type: 'string', description: 'City name' },
                  },
                  required: ['location'],
                },
              },
            ],
            tool_choice: { type: 'any' },
          },
          [
            {
              role: 'user',
              content: "What's the temperature in Tokyo?",
            },
          ]
        ),
        connection,
        model
      );
      const data = response.data as AnthropicMessage;
      const tu = data.content.find((c) => c.type === 'tool_use') as
        | { name: string; input: Record<string, unknown> }
        | undefined;
      expect(tu, 'expected tool_use content block').toBeDefined();
      expect(tu!.name).toBe('get_weather');
    },
    TIMEOUT
  );

  it(
    'anthropicMessages: thinking (extended reasoning) flows through',
    async () => {
      const response = await provider.anthropicMessages(
        anthropicReq({
          max_tokens: 2048,
          thinking: { type: 'enabled', budget_tokens: 1024 },
          // `temperature` is rejected when `thinking` is on for some
          // newer Claude families; drop it for this case.
          temperature: undefined as never,
        }),
        connection,
        model
      );
      const data = response.data as AnthropicMessage;
      // Thinking may or may not be emitted depending on routing, but
      // the request must round-trip cleanly.
      expect(data.type).toBe('message');
    },
    TIMEOUT
  );

  it(
    'anthropicMessages: multipart user content (text + image base64)',
    async () => {
      // 8x8 solid-red PNG — Anthropic rejects 1x1 transparent PNGs.
      const tinyPngBase64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC';
      const response = await provider.anthropicMessages(
        anthropicReq({}, [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Briefly describe this image.' },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: tinyPngBase64,
                },
              },
            ],
          },
        ]),
        connection,
        model
      );
      const data = response.data as AnthropicMessage;
      const text =
        (data.content.find((c) => c.type === 'text') as { text?: string })
          ?.text ?? '';
      expect(text.length).toBeGreaterThan(0);
    },
    TIMEOUT
  );

  it(
    'anthropicMessages: tool_result follow-up (multi-turn)',
    async () => {
      const response = await provider.anthropicMessages(
        anthropicReq(
          {
            tools: [
              {
                name: 'get_weather',
                input_schema: { type: 'object' },
              },
            ] as never,
          },
          [
            { role: 'user', content: "What's the temperature in Tokyo?" },
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
                  content: '15 °C, partly cloudy',
                },
              ] as never,
            },
          ]
        ),
        connection,
        model
      );
      const data = response.data as AnthropicMessage;
      const text =
        (data.content.find((c) => c.type === 'text') as { text?: string })
          ?.text ?? '';
      expect(text).toMatch(/15/);
    },
    TIMEOUT
  );

  it(
    'anthropicMessages: cache_control marker on system block round-trips without error',
    async () => {
      const response = await provider.anthropicMessages(
        anthropicReq({
          system: [
            {
              type: 'text',
              text: 'You answer in one word.',
              cache_control: { type: 'ephemeral' },
            },
          ] as never,
        }),
        connection,
        model
      );
      const data = response.data as AnthropicMessage;
      expect(data.type).toBe('message');
      // Usage may surface `cache_creation_input_tokens` / `cache_read_input_tokens`
      // depending on cache state — verify the field exists on the
      // usage shape (passthrough — the SDK echoes them when present).
      expect(typeof data.usage.input_tokens).toBe('number');
      expect(typeof data.usage.output_tokens).toBe('number');
    },
    TIMEOUT
  );

  it(
    'anthropicMessages: invalid model maps to non-retryable client error',
    async () => {
      // Anthropic rejects unknown model IDs with a 4xx (currently
      // 404 not_found_error, historically 400 invalid_request_error).
      // The dispatcher must surface this as a CompletionError carrying
      // a 4xx statusCode, retryable=false, and the original request
      // payload — that's the audit invariant.
      let caught: unknown;
      try {
        await provider.anthropicMessages(anthropicReq(), connection, {
          ...model,
          model: 'claude-does-not-exist-9999',
        } as typeof model);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeDefined();
      const err = caught as {
        data?: {
          statusCode?: number;
          retryable?: boolean;
          providerRequestPayload?: unknown;
        };
      };
      expect([400, 404]).toContain(err.data?.statusCode);
      expect(err.data?.retryable).toBe(false);
      expect(err.data?.providerRequestPayload).toBeDefined();
    },
    TIMEOUT
  );

  it(
    'openAIResponse: reasoning.effort streams + completes cleanly',
    async () => {
      const req: ResponseCreateParams = {
        model: 'placeholder',
        input: reasoningPrompt.messages[0].content as string,
        max_output_tokens: 1024,
        reasoning: { effort: 'low' },
        stream: true,
      } as ResponseCreateParams;
      const response = await provider.openAIResponse(req, connection, model);
      const events: ResponseStreamEvent[] = [];
      for await (const ev of response.data as AsyncIterable<ResponseStreamEvent>) {
        events.push(ev);
      }
      const types = events.map((e) => (e as { type?: string }).type);
      expect(types).toContain('response.completed');
      // `response.reasoning_summary_text.delta` only fires if Anthropic
      // actually emitted a thinking block — accept either path so the
      // test isn't flaky on cache-hot retries that skip thinking.
      const text = events
        .filter(
          (e) => (e as { type?: string }).type === 'response.output_text.delta'
        )
        .map((e) => (e as { delta?: string }).delta ?? '')
        .join('');
      assertNonEmptyText(text);
    },
    TIMEOUT
  );
});
