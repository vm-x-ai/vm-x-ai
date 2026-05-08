import { describe, expect, it } from 'vitest';
import { isAsyncIterable } from '../../utils/async';
import { assertNonEmptyText, collectStream } from '../helpers/assertions';
import { LIVE_PROVIDERS, shouldRunLive } from '../helpers/live-flow';
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';
import type { ChatCompletion } from 'openai/resources/index.js';

/**
 * **Live** integration tests for the Anthropic Messages endpoint
 * across every supported provider.
 *
 * Goes through `provider.complete({ format: 'anthropic', body })`
 * — the same code path the gateway uses when a client hits
 * `POST /v1/messages`. For Anthropic + Bedrock-Invoke, that's a
 * native passthrough; for OpenAI / Gemini / Groq / Perplexity, the
 * provider class converts to OpenAI Chat Completions internally.
 *
 * Live tests run via `nx run api:test:live`; per-spec
 * `describe.skipIf(!hasKeys(cfg.envKey))` skips providers whose key
 * env var is unset so the matrix degrades gracefully.
 */

const TIMEOUT = 60_000;

const ANTHROPIC_MODELS: Partial<Record<string, string>> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5',
  gemini: 'gemini-2.5-flash-lite',
  groq: 'llama-3.3-70b-versatile',
  perplexity: 'sonar',
};

const WEATHER_TOOL = {
  name: 'get_weather',
  description: 'Get the current weather in a city',
  input_schema: {
    type: 'object',
    properties: {
      location: { type: 'string', description: 'City name' },
    },
    required: ['location'],
  },
};

const TIME_TOOL = {
  name: 'get_time',
  description: 'Get the current local time in a city',
  input_schema: {
    type: 'object',
    properties: {
      location: { type: 'string', description: 'City name' },
    },
    required: ['location'],
  },
};

const baseRequest = (
  model: string,
  messages: AnthropicMessagesRequest['messages'],
  extra: Partial<AnthropicMessagesRequest> = {}
): AnthropicMessagesRequest =>
  ({
    model,
    max_tokens: 256,
    messages,
    ...extra,
  } as AnthropicMessagesRequest);

/** Drain whatever shape the provider returned + extract assertable text. */
async function getResponseText(data: unknown): Promise<string> {
  if (isAsyncIterable(data)) {
    // Detect chunk shape on the fly. The orchestrator now forwards
    // native Anthropic SSE event streams verbatim (no conversion to
    // ChatCompletionChunk); `collectStream` only understands
    // ChatCompletionChunks, so we pre-drain and dispatch by shape.
    let text = '';
    let sawNative = false;
    const chunks: unknown[] = [];
    for await (const chunk of data as AsyncIterable<unknown>) {
      chunks.push(chunk);
      const ev = chunk as { type?: string; delta?: unknown };
      if (
        typeof ev.type === 'string' &&
        (ev.type === 'message_start' ||
          ev.type === 'content_block_delta' ||
          ev.type === 'message_delta' ||
          ev.type === 'message_stop' ||
          ev.type === 'content_block_start' ||
          ev.type === 'content_block_stop')
      ) {
        sawNative = true;
        if (ev.type === 'content_block_delta') {
          const d = ev.delta as { type?: string; text?: string };
          if (d?.type === 'text_delta' && typeof d.text === 'string') {
            text += d.text;
          }
        }
        continue;
      }
      if (typeof ev.type === 'string' && ev.type.startsWith('response.')) {
        sawNative = true;
        if (
          ev.type === 'response.output_text.delta' &&
          typeof ev.delta === 'string'
        ) {
          text += ev.delta;
        }
      }
    }
    if (sawNative) return text;
    // Fallback to ChatCompletion stream collector.
    const collected = await collectStream(
      (async function* () {
        for (const c of chunks) yield c as never;
      })() as never
    );
    return collected.text;
  }
  const cc = data as ChatCompletion & {
    content?: Array<{ type: string; text?: string }>;
  };
  if (Array.isArray(cc.content)) {
    return cc.content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text!)
      .join('');
  }
  return cc.choices?.[0]?.message?.content ?? '';
}

describe.each(LIVE_PROVIDERS)('Live: Anthropic Messages × $id', (cfg) => {
  const run = shouldRunLive(cfg);

  describe.skipIf(!run)('scenarios', () => {
    const provider = cfg.build();
    const connection = run ? cfg.buildConnection() : (null as never);
    const model = run ? cfg.buildModel() : (null as never);
    const modelId = ANTHROPIC_MODELS[cfg.id] ?? cfg.model;

    const dispatch = async (body: AnthropicMessagesRequest, stream = false) => {
      const payload = { ...body, stream } as AnthropicMessagesRequest;
      return provider.anthropicMessages(payload, connection, model);
    };

    it(
      'simple single message (non-streaming)',
      async () => {
        const response = await dispatch(
          baseRequest(modelId, [
            { role: 'user', content: 'Reply with the single word: pong' },
          ])
        );
        const text = await getResponseText(response.data);
        assertNonEmptyText(text);
      },
      TIMEOUT
    );

    it(
      'simple single message (streaming)',
      async () => {
        const response = await dispatch(
          baseRequest(modelId, [
            { role: 'user', content: 'Reply with the single word: pong' },
          ]),
          true
        );
        const text = await getResponseText(response.data);
        assertNonEmptyText(text);
      },
      TIMEOUT
    );

    it(
      'multi-message conversation (non-streaming)',
      async () => {
        const response = await dispatch(
          baseRequest(modelId, [
            { role: 'user', content: 'My name is Lucas.' },
            { role: 'assistant', content: 'Hello Lucas, nice to meet you.' },
            {
              role: 'user',
              content: 'What is my name? Reply with just my name.',
            },
          ])
        );
        const text = await getResponseText(response.data);
        expect(text).toMatch(/Lucas/i);
      },
      TIMEOUT
    );

    it(
      'multi-message conversation (streaming)',
      async () => {
        const response = await dispatch(
          baseRequest(modelId, [
            { role: 'user', content: 'My name is Lucas.' },
            { role: 'assistant', content: 'Hello Lucas.' },
            { role: 'user', content: 'What is my name?' },
          ]),
          true
        );
        const text = await getResponseText(response.data);
        expect(text).toMatch(/Lucas/i);
      },
      TIMEOUT
    );

    it(
      'with system prompt (non-streaming)',
      async () => {
        const response = await dispatch(
          baseRequest(modelId, [{ role: 'user', content: 'say hello' }], {
            system: 'Reply ONLY in ALL CAPS. Never lowercase.',
          })
        );
        const text = await getResponseText(response.data);
        assertNonEmptyText(text);
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
        const response = await dispatch(
          baseRequest(
            modelId,
            [
              {
                role: 'user',
                content:
                  "What's the temperature in Tokyo? Use the get_weather tool.",
              },
            ],
            { tools: [WEATHER_TOOL] as never }
          )
        );
        const text = await getResponseText(response.data);
        // Either tool was called (no text content) or model answered
        // inline. Both are acceptable; we just verify the request
        // round-tripped the tools schema without crashing.
        if (text.length === 0) {
          // Likely tool_use was emitted. Verify the response carries
          // SOME kind of content.
          const data = response.data as {
            content?: unknown[];
            choices?: unknown[];
          };
          expect(data.content || data.choices).toBeDefined();
        }
      },
      TIMEOUT
    );

    it.skipIf(!cfg.supportsTools)(
      'with tool call (streaming)',
      async () => {
        const response = await dispatch(
          baseRequest(
            modelId,
            [
              {
                role: 'user',
                content:
                  "What's the temperature in Tokyo? Use the get_weather tool.",
              },
            ],
            { tools: [WEATHER_TOOL] as never }
          ),
          true
        );
        const text = await getResponseText(response.data);
        // Stream produced something — text or tool_use deltas.
        expect(text).toBeDefined();
      },
      TIMEOUT
    );

    it.skipIf(!cfg.supportsTools)(
      'with multiple tool calls (parallel) — non-streaming',
      async () => {
        const response = await dispatch(
          baseRequest(
            modelId,
            [
              {
                role: 'user',
                content:
                  'Tell me both the weather AND local time in Tokyo. Use the get_weather and get_time tools in parallel.',
              },
            ],
            { tools: [WEATHER_TOOL, TIME_TOOL] as never }
          )
        );
        // Either way, the request must not throw. If the provider
        // returned tool_use blocks they're nested inside `content`.
        expect(response.data).toBeDefined();
      },
      TIMEOUT
    );

    it.skipIf(!cfg.supportsTools)(
      'tool result follow-up (assistant uses tool output)',
      async () => {
        const response = await dispatch(
          baseRequest(
            modelId,
            [
              {
                role: 'user',
                content: "What's the temperature in Tokyo?",
              },
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
            ],
            { tools: [WEATHER_TOOL] as never }
          )
        );
        const text = await getResponseText(response.data);
        assertNonEmptyText(text);
        expect(text).toMatch(/15/);
      },
      TIMEOUT
    );

    it.skipIf(cfg.id !== 'anthropic')(
      'no conversion: Anthropic body to Anthropic provider preserves the wire shape (input passthrough)',
      async () => {
        const body = baseRequest(modelId, [
          { role: 'user', content: 'Reply pong' },
        ]);
        const response = await dispatch(body);
        const captured = response.providerRequestPayload as Record<
          string,
          unknown
        >;
        expect(captured.model).toBe(modelId);
        expect(captured.messages).toEqual(body.messages);
        // Output-side: Anthropic provider returns the native Message
        // object, not a ChatCompletion shape.
        const data = response.data as unknown as Record<string, unknown>;
        expect(data.content || data.choices).toBeDefined();
      },
      TIMEOUT
    );

    if (cfg.providerSpecificArgs) {
      it(
        `accepts provider-native field passthrough on Anthropic shape (${Object.keys(
          cfg.providerSpecificArgs
        ).join(', ')})`,
        async () => {
          // The user's `provider_args` escape hatch lands here as
          // top-level fields on the Anthropic body before the
          // provider sees it (the gateway merge in
          // CompletionService). Simulate that here by dropping the
          // fields directly on the body.
          const response = await dispatch(
            baseRequest(
              modelId,
              [{ role: 'user', content: 'Reply with the word: pong' }],
              cfg.providerSpecificArgs as Partial<AnthropicMessagesRequest>
            )
          );
          const text = await getResponseText(response.data);
          assertNonEmptyText(text);
        },
        TIMEOUT
      );
    }
  });
});
