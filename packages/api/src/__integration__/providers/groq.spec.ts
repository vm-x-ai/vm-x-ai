import { describe, expect, it } from 'vitest';
import type {
  Response as OpenAIResponse,
  ResponseCreateParams,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses.js';
import type {
  Message as AnthropicSDKMessage,
  RawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages';
import { hasKeys, requiredEnv } from '../helpers/env';
import {
  buildGroqProvider,
  makeConnection,
  makeModel,
} from '../helpers/factories';
import {
  simplePrompt,
  type StructuredOutputShape,
  structuredOutputPrompt,
  toolCallPrompt,
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
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';

const SHOULD_RUN = hasKeys('GROQ_API_KEY');
const TEST_MODEL = process.env.GROQ_TEST_MODEL ?? 'llama-3.3-70b-versatile';
/**
 * GPT-OSS 20B is one of Groq's hosted reasoning models. It honours the
 * Groq-specific `reasoning_effort` and `reasoning_format` fields the
 * cell forwards verbatim through the OpenAI SDK passthrough.
 */
const REASONING_MODEL =
  process.env.GROQ_REASONING_TEST_MODEL ?? 'openai/gpt-oss-20b';
// llama-3.3-70b-versatile rejects response_format=json_schema. Use a
// model on Groq's structured-outputs allowlist; gpt-oss-20b accepts the
// strict schema shape used by `structuredOutputPrompt`.
const STRUCTURED_OUTPUT_MODEL =
  process.env.GROQ_STRUCTURED_OUTPUT_TEST_MODEL ?? 'openai/gpt-oss-20b';
const TIMEOUT = 60_000;

describe.skipIf(!SHOULD_RUN)('Groq provider (live)', () => {
  const provider = buildGroqProvider();
  const connection = makeConnection('groq', {
    apiKey: SHOULD_RUN ? requiredEnv('GROQ_API_KEY') : '',
  });
  const model = makeModel('groq', TEST_MODEL);

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
    'structured output (json_schema)',
    async () => {
      const structuredModel = makeModel('groq', STRUCTURED_OUTPUT_MODEL);
      const response = await provider.openAICompletion(
        { ...structuredOutputPrompt },
        connection,
        structuredModel
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

  it(
    'reasoning model (gpt-oss) honours reasoning_effort + emits reasoning text',
    async () => {
      const reasoningModel = makeModel('groq', REASONING_MODEL);
      const response = await provider.openAICompletion(
        {
          model: REASONING_MODEL,
          messages: [
            {
              role: 'user',
              content:
                'Think briefly, then answer: what is the smallest 3-digit prime number? Reply with just the number.',
            },
          ],
          max_tokens: 1024,
          temperature: 0,
          // Groq-specific fields forwarded verbatim through the OpenAI
          // SDK. `reasoning_format: 'parsed'` surfaces reasoning in a
          // dedicated `message.reasoning` field; `reasoning_effort` is
          // accepted by gpt-oss models.
          reasoning_effort: 'low',
          reasoning_format: 'parsed',
        } as Parameters<typeof provider.openAICompletion>[0],
        connection,
        reasoningModel
      );
      const data = await expectNonStreaming(response);
      assertNonEmptyText(data.choices[0].message.content ?? '');
      assertUsageNonZero(data.usage);
      // Hard assertion: the cell-internal passthrough surfaces Groq's
      // `message.reasoning` extension without stripping it. Downstream
      // agents may read this; if we ever clamp the SDK response shape
      // to a strict OpenAI subset, this assertion catches it.
      const message = data.choices[0].message as { reasoning?: string };
      expect(
        typeof message.reasoning === 'string' && message.reasoning.length > 0,
        'gpt-oss with reasoning_format=parsed returned no reasoning text'
      ).toBe(true);
    },
    TIMEOUT
  );

  // Responses-shape live tests exercise the native Groq Responses
  // endpoint (`/openai/v1/responses`) via the OpenAI SDK passthrough.
  // The cell only overrides `createClient`; the parent
  // `OpenAIResponseProvider.handle()` strips the gateway envelope,
  // substitutes `model`, and forwards the body verbatim. Each test
  // goes through `provider.openAIResponse(...)` so the full pipeline
  // runs against the live API.
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
      // The sequence numbers must be strictly monotonic for a
      // spec-conformant Responses stream — assert here so a regression
      // in Groq's SSE encoder is caught at the cell boundary.
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
    'openAIResponse: reasoning model (gpt-oss) honours reasoning.effort',
    async () => {
      // Per Groq's Responses API docs, built-in reasoning (`reasoning.effort`)
      // is gated on the GPT-OSS family. Per-token cost lookups for
      // `openai/gpt-oss-20b` already exist in the model_pricing seed, so
      // this stays consistent with the rest of the suite.
      const reasoningModel = makeModel('groq', REASONING_MODEL);
      const req: ResponseCreateParams = {
        model: 'placeholder',
        input:
          'Think briefly, then answer: what is the smallest 3-digit prime number? Reply with just the number.',
        max_output_tokens: 1024,
        reasoning: { effort: 'low' },
      } as ResponseCreateParams;
      const response = await provider.openAIResponse(
        req,
        connection,
        reasoningModel
      );
      expect(isAsyncIterable(response.data)).toBe(false);
      const data = response.data as OpenAIResponse;
      assertNonEmptyText(data.output_text);
      expect(data.usage?.input_tokens).toBeGreaterThan(0);
      expect(data.usage?.output_tokens).toBeGreaterThan(0);
    },
    TIMEOUT
  );

  it(
    'openAIResponse: invalid model surfaces upstream 400 with providerRequestPayload',
    async () => {
      // The parent's error-mapping path captures the request body on
      // every error — verify Groq's 400 (unknown model) round-trips
      // through `CompletionError` with the payload attached so the
      // gateway's audit log can correlate failures to the wire body.
      const bogusModel = makeModel('groq', 'this-model-does-not-exist-xyz');
      const req: ResponseCreateParams = {
        model: 'placeholder',
        input: 'ping',
        max_output_tokens: 8,
      } as ResponseCreateParams;
      await expect(
        provider.openAIResponse(req, connection, bogusModel)
      ).rejects.toMatchObject({
        data: expect.objectContaining({
          rate: false,
          retryable: false,
          providerRequestPayload: expect.objectContaining({
            model: 'this-model-does-not-exist-xyz',
          }),
        }),
      });
    },
    TIMEOUT
  );

  // Anthropic Messages live tests exercise the two-hop dispatcher:
  // Anthropic Messages → Responses (canonical adapter) → Groq's
  // OpenAI-compat endpoint → Responses response → Anthropic Messages.
  // Conversion fidelity is unit-tested in
  // `ai-provider/groq/anthropic-messages.provider.spec.ts`; these
  // assert the wire round-trip is healthy against the real upstream.
  it(
    'anthropicMessages: simple completion (non-streaming)',
    async () => {
      const req: AnthropicMessagesRequest = {
        model: TEST_MODEL,
        max_tokens: 64,
        messages: [
          { role: 'user', content: 'Reply with the single word: pong' },
        ],
      };
      const response = await provider.anthropicMessages(req, connection, model);
      expect(isAsyncIterable(response.data)).toBe(false);
      const data = response.data as AnthropicSDKMessage;
      expect(data.type).toBe('message');
      expect(data.role).toBe('assistant');
      const text = data.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text: string }).text)
        .join('');
      assertNonEmptyText(text);
      // SDK 0.95.1 wire-shape invariants.
      expect(data.container).toBeNull();
      expect(data.usage.input_tokens).toBeGreaterThan(0);
      expect(data.usage.output_tokens).toBeGreaterThan(0);
      // Audit invariant: providerRequestPayload is the Responses-shape
      // body Groq saw, NOT the original Anthropic body — the dispatcher
      // forwards the inner provider's payload verbatim.
      const captured = response.providerRequestPayload as Record<
        string,
        unknown
      >;
      expect(captured.model).toBe(TEST_MODEL);
      expect(Array.isArray(captured.input)).toBe(true);
    },
    TIMEOUT
  );

  it(
    'anthropicMessages: simple completion (streaming)',
    async () => {
      const req: AnthropicMessagesRequest = {
        model: TEST_MODEL,
        max_tokens: 64,
        messages: [
          { role: 'user', content: 'Reply with the single word: pong' },
        ],
        stream: true,
      };
      const response = await provider.anthropicMessages(req, connection, model);
      expect(isAsyncIterable(response.data)).toBe(true);
      const events: RawMessageStreamEvent[] = [];
      for await (const ev of response.data as AsyncIterable<RawMessageStreamEvent>) {
        events.push(ev);
      }
      const types = events.map((e) => e.type);
      // Canonical Anthropic streaming envelope must be intact end-to-end.
      expect(types).toContain('message_start');
      expect(types).toContain('content_block_delta');
      expect(types).toContain('message_stop');
      const text = events
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
      assertNonEmptyText(text);
    },
    TIMEOUT
  );

  it(
    'anthropicMessages: tool calling (non-streaming) — emits tool_use with caller field',
    async () => {
      const req: AnthropicMessagesRequest = {
        model: TEST_MODEL,
        max_tokens: 256,
        messages: [
          {
            role: 'user',
            content:
              "What's the current temperature in Tokyo? Use get_weather.",
          },
        ],
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
      };
      const response = await provider.anthropicMessages(req, connection, model);
      const data = response.data as AnthropicSDKMessage;
      const toolUse = data.content.find((b) => b.type === 'tool_use') as
        | { name: string; input: unknown; caller?: { type: string } }
        | undefined;
      expect(toolUse, 'expected a tool_use block').toBeDefined();
      expect(toolUse!.name).toBe('get_weather');
      // SDK 0.95.1: tool_use blocks must carry `caller: { type: 'direct' }`.
      expect(toolUse!.caller).toEqual({ type: 'direct' });
    },
    TIMEOUT
  );

  it(
    'anthropicMessages: invalid model surfaces upstream error with providerRequestPayload',
    async () => {
      const bogusModel = makeModel('groq', 'this-model-does-not-exist-xyz');
      const req: AnthropicMessagesRequest = {
        model: 'this-model-does-not-exist-xyz',
        max_tokens: 16,
        messages: [{ role: 'user', content: 'ping' }],
      };
      await expect(
        provider.anthropicMessages(req, connection, bogusModel)
      ).rejects.toMatchObject({
        data: expect.objectContaining({
          rate: false,
          retryable: false,
          // The payload reflects the Chat-Completions wire body the
          // inner provider built — `model` was substituted from the
          // AIResourceModelConfigEntity, not the request top-level.
          providerRequestPayload: expect.objectContaining({
            model: 'this-model-does-not-exist-xyz',
          }),
        }),
      });
    },
    TIMEOUT
  );
});
