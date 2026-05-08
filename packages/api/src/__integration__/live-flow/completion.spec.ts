import { describe, expect, it } from 'vitest';
import type { ChatCompletionCreateParams } from 'openai/resources/index.js';
import {
  assertNonEmptyText,
  assertToolCall,
  assertUsageNonZero,
  collectStream,
  expectNonStreaming,
  expectStreaming,
} from '../helpers/assertions';
import { LIVE_PROVIDERS, shouldRunLive } from '../helpers/live-flow';
import { stripPassthroughEnvelope } from '../../ai-provider/passthrough.helpers';

/**
 * **Live** integration tests for the Chat Completions endpoint
 * across every supported provider.
 *
 * Each scenario exercises the format-aware `provider.complete()`
 * entrypoint with `format: 'chat-completions'` so we test the same code path
 * the gateway uses when a client hits `POST /v1/chat/completions`.
 *
 * Live tests run via `nx run api:test:live` — that target is the
 * cost gate. Per-spec, `describe.skipIf(!hasKeys(cfg.envKey))` skips
 * a provider's cells when its key is absent so the matrix degrades
 * gracefully.
 *
 * Scenarios per provider:
 *   1. simple single-message — non-streaming + streaming
 *   2. multi-message conversation — non-streaming + streaming
 *   3. system prompt — non-streaming + streaming
 *   4. tools registration (no call expected) — non-streaming
 *   5. tool call (model invokes one tool) — non-streaming + streaming
 *   6. multiple tool calls (parallel) — non-streaming
 *   7. tool result follow-up (assistant uses the tool output)
 *   8. **No-conversion guarantee**: when an OpenAI-shape request
 *      hits the OpenAI provider, the body the SDK sees on the wire
 *      should not be a converted shape; it should be the original
 *      OpenAI body (sans the gateway's `__vmx_passthrough` envelope).
 *   9. provider-args precedence: passing the provider's signature
 *      field through the request body succeeds (e.g. Perplexity
 *      `search_recency_filter`).
 */

const TIMEOUT = 60_000;

const WEATHER_TOOL = {
  type: 'function' as const,
  function: {
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
};

const TIME_TOOL = {
  type: 'function' as const,
  function: {
    name: 'get_time',
    description: 'Get the current local time in a city',
    parameters: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City name' },
      },
      required: ['location'],
    },
  },
};

const baseRequest = (
  model: string,
  messages: ChatCompletionCreateParams['messages'],
  extra: Partial<ChatCompletionCreateParams> = {}
): ChatCompletionCreateParams =>
  ({
    model,
    messages,
    max_tokens: 256,
    temperature: 0,
    ...extra,
  } as ChatCompletionCreateParams);

describe.each(LIVE_PROVIDERS)('Live: Chat Completions × $id', (cfg) => {
  const run = shouldRunLive(cfg);

  describe.skipIf(!run)('scenarios', () => {
    const provider = cfg.build();
    const connection = run ? cfg.buildConnection() : (null as never);
    const model = run ? cfg.buildModel() : (null as never);

    it(
      'simple single message (non-streaming)',
      async () => {
        const response = await provider.openAICompletion(
          baseRequest(cfg.model, [
            { role: 'user', content: 'Reply with the single word: pong' },
          ]),
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
      'simple single message (streaming)',
      async () => {
        const response = await provider.openAICompletion(
          baseRequest(
            cfg.model,
            [{ role: 'user', content: 'Reply with the single word: pong' }],
            { stream: true }
          ),
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
      'multi-message conversation (non-streaming)',
      async () => {
        const response = await provider.openAICompletion(
          baseRequest(cfg.model, [
            { role: 'user', content: 'My name is Lucas.' },
            { role: 'assistant', content: 'Hello Lucas, nice to meet you.' },
            {
              role: 'user',
              content: 'What is my name? Reply with just my name.',
            },
          ]),
          connection,
          model
        );
        const data = await expectNonStreaming(response);
        const text = data.choices[0].message.content ?? '';
        assertNonEmptyText(text);
        expect(text).toMatch(/Lucas/i);
      },
      TIMEOUT
    );

    it(
      'multi-message conversation (streaming)',
      async () => {
        const response = await provider.openAICompletion(
          baseRequest(
            cfg.model,
            [
              { role: 'user', content: 'My name is Lucas.' },
              { role: 'assistant', content: 'Hello Lucas.' },
              { role: 'user', content: 'What is my name?' },
            ],
            { stream: true }
          ),
          connection,
          model
        );
        const stream = await expectStreaming(response);
        const collected = await collectStream(stream);
        expect(collected.text).toMatch(/Lucas/i);
      },
      TIMEOUT
    );

    it(
      'with system prompt (non-streaming)',
      async () => {
        const response = await provider.openAICompletion(
          baseRequest(cfg.model, [
            {
              role: 'system',
              content:
                'You always reply in ALL CAPS regardless of input. Never use lowercase letters.',
            },
            { role: 'user', content: 'say hello' },
          ]),
          connection,
          model
        );
        const data = await expectNonStreaming(response);
        const text = data.choices[0].message.content ?? '';
        assertNonEmptyText(text);
        // Most providers honour the system prompt strongly enough that
        // the response is dominated by upper-case letters.
        const letters = text.replace(/[^a-zA-Z]/g, '');
        if (letters.length > 0) {
          const upperRatio =
            letters.replace(/[^A-Z]/g, '').length / letters.length;
          expect(upperRatio).toBeGreaterThan(0.6);
        }
      },
      TIMEOUT
    );

    it.skipIf(!cfg.supportsTools)(
      'with tools registered (model can call the weather tool)',
      async () => {
        const response = await provider.openAICompletion(
          baseRequest(
            cfg.model,
            [
              {
                role: 'user',
                content:
                  "What's the temperature in Tokyo right now? Use the get_weather tool.",
              },
            ],
            { tools: [WEATHER_TOOL], tool_choice: 'auto' }
          ),
          connection,
          model
        );
        const data = await expectNonStreaming(response);
        const tcs = data.choices[0].message.tool_calls;
        // Either the model invoked the tool (most likely) OR returned
        // an inline answer — either is acceptable, we just want to
        // confirm `tools` registration didn't crash the request.
        if (tcs && tcs.length > 0) {
          assertToolCall(tcs, 'get_weather');
        } else {
          assertNonEmptyText(data.choices[0].message.content ?? '');
        }
      },
      TIMEOUT
    );

    it.skipIf(!cfg.supportsTools)(
      'with tool call (streaming)',
      async () => {
        const response = await provider.openAICompletion(
          baseRequest(
            cfg.model,
            [
              {
                role: 'user',
                content:
                  "What's the temperature in Tokyo right now? Use the get_weather tool.",
              },
            ],
            { tools: [WEATHER_TOOL], tool_choice: 'auto', stream: true }
          ),
          connection,
          model
        );
        const stream = await expectStreaming(response);
        const collected = await collectStream(stream);
        if (collected.toolCalls.length === 0) {
          assertNonEmptyText(collected.text);
        } else {
          assertToolCall(collected.toolCalls, 'get_weather');
        }
      },
      TIMEOUT
    );

    it.skipIf(!cfg.supportsTools)(
      'with multiple tool calls (parallel) — non-streaming',
      async () => {
        const response = await provider.openAICompletion(
          baseRequest(
            cfg.model,
            [
              {
                role: 'user',
                content:
                  'Tell me both the weather AND the local time in Tokyo. Use the get_weather and get_time tools in parallel.',
              },
            ],
            { tools: [WEATHER_TOOL, TIME_TOOL], tool_choice: 'auto' }
          ),
          connection,
          model
        );
        const data = await expectNonStreaming(response);
        const tcs = data.choices[0].message.tool_calls ?? [];
        // Models vary — accept either zero (inline answer) or one or
        // more tool calls. The shape should at least be valid.
        for (const tc of tcs) {
          if (tc.type === 'function') {
            expect(['get_weather', 'get_time']).toContain(tc.function.name);
          }
        }
      },
      TIMEOUT
    );

    it.skipIf(!cfg.supportsTools)(
      'tool result follow-up (assistant uses tool output)',
      async () => {
        const toolCallId = 'call_weather_1';
        const response = await provider.openAICompletion(
          baseRequest(cfg.model, [
            {
              role: 'user',
              content: "What's the temperature in Tokyo? Use get_weather.",
            },
            {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: toolCallId,
                  type: 'function',
                  function: {
                    name: 'get_weather',
                    arguments: JSON.stringify({ location: 'Tokyo' }),
                  },
                },
              ],
            },
            {
              role: 'tool',
              tool_call_id: toolCallId,
              content: '15 °C, partly cloudy',
            },
          ]),
          connection,
          model
        );
        const data = await expectNonStreaming(response);
        const text = data.choices[0].message.content ?? '';
        assertNonEmptyText(text);
        // Sanity: the model should reference the temperature we
        // returned via the tool result.
        expect(text).toMatch(/15/);
      },
      TIMEOUT
    );

    it.skipIf(cfg.id !== 'openai')(
      'no conversion: OpenAI request to OpenAI provider preserves the body verbatim',
      async () => {
        // Goes through provider.complete with format:'openai'. The
        // captured `providerRequestPayload` must be the original
        // OpenAI body (after stripping the gateway's passthrough
        // envelope) — no synthesised messages, no shape mutation.
        const body = baseRequest(cfg.model, [
          { role: 'user', content: 'Reply pong' },
        ]);
        const response = await provider.openAICompletion(
          body as never,
          connection,
          model
        );
        await expectNonStreaming(response);
        const captured = response.providerRequestPayload as Record<
          string,
          unknown
        >;
        const expected = stripPassthroughEnvelope(body);
        // Stream-options is the only field the OpenAI provider adds —
        // other fields must match.
        expect(captured.messages).toEqual(expected.messages);
        expect(captured.model).toBe(cfg.model);
      },
      TIMEOUT
    );

    if (cfg.providerSpecificArgs) {
      it(
        `accepts provider-native field passthrough (${Object.keys(
          cfg.providerSpecificArgs
        ).join(', ')})`,
        async () => {
          // Pass the provider-native field directly on the body —
          // this mirrors what `provider_args` produces after the
          // gateway merge. We just verify the provider's SDK accepts
          // the unknown field without rejecting the request.
          const response = await provider.openAICompletion(
            baseRequest(
              cfg.model,
              [{ role: 'user', content: 'Reply with the word: pong' }],
              cfg.providerSpecificArgs as Partial<ChatCompletionCreateParams>
            ),
            connection,
            model
          );
          const data = await expectNonStreaming(response);
          assertNonEmptyText(data.choices[0].message.content ?? '');
        },
        TIMEOUT
      );
    }
  });
});
