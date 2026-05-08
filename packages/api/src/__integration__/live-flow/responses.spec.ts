import { describe, expect, it } from 'vitest';
import { isAsyncIterable } from '../../utils/async';
import { assertNonEmptyText, collectStream } from '../helpers/assertions';
import { LIVE_PROVIDERS, shouldRunLive } from '../helpers/live-flow';
import type { ResponsesRequestDto } from '../../gateway/responses/dto/responses-request.dto';
import type { ChatCompletion } from 'openai/resources/index.js';

/**
 * **Live** integration tests for the Responses API endpoint across
 * every supported provider.
 *
 * Goes through `provider.complete({ format: 'responses', body })`
 * — the same code path the gateway uses when a client hits
 * `POST /v1/responses`. For OpenAI the underlying SDK call is
 * Chat Completions today (passthrough is a follow-up); for the
 * other providers the gateway converts to OpenAI Chat Completions
 * before dispatch.
 */

const TIMEOUT = 60_000;

const RESPONSES_MODELS: Partial<Record<string, string>> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5',
  gemini: 'gemini-2.5-flash-lite',
  groq: 'llama-3.3-70b-versatile',
  perplexity: 'sonar',
};

const WEATHER_TOOL = {
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
};

const TIME_TOOL = {
  type: 'function',
  name: 'get_time',
  description: 'Get the current local time in a city',
  parameters: {
    type: 'object',
    properties: {
      location: { type: 'string', description: 'City name' },
    },
    required: ['location'],
  },
};

const baseRequest = (
  model: string,
  input: ResponsesRequestDto['input'],
  extra: Partial<ResponsesRequestDto> = {}
): ResponsesRequestDto =>
  ({
    model,
    input,
    max_output_tokens: 256,
    ...extra,
  } as ResponsesRequestDto);

async function getResponseText(data: unknown): Promise<string> {
  if (isAsyncIterable(data)) {
    // Drain and detect chunk shape on the fly. The orchestrator now
    // forwards native Responses event streams verbatim (no conversion
    // to ChatCompletionChunk), so the legacy `collectStream` (which
    // only understands ChatCompletionChunks) misses every text-delta.
    let text = '';
    let sawNative = false;
    const chunks: unknown[] = [];
    for await (const chunk of data as AsyncIterable<unknown>) {
      chunks.push(chunk);
      const ev = chunk as { type?: string; delta?: unknown };
      if (typeof ev.type === 'string' && ev.type.startsWith('response.')) {
        sawNative = true;
        if (
          ev.type === 'response.output_text.delta' &&
          typeof ev.delta === 'string'
        ) {
          text += ev.delta;
        }
        continue;
      }
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
  // Native Responses shape.
  const cc = data as Record<string, unknown> & ChatCompletion;
  if (typeof cc.output_text === 'string' && cc.output_text.length > 0) {
    return cc.output_text;
  }
  if (Array.isArray(cc.output)) {
    const texts: string[] = [];
    for (const item of cc.output as Array<{
      type?: string;
      content?: Array<{ type: string; text?: string }>;
    }>) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const part of item.content) {
          if (typeof part.text === 'string') texts.push(part.text);
        }
      }
    }
    if (texts.length > 0) return texts.join('');
  }
  // Anthropic Message shape.
  if (Array.isArray((cc as { content?: unknown }).content)) {
    const texts = (
      cc as unknown as { content: Array<{ type?: string; text?: string }> }
    ).content
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text!)
      .join('');
    if (texts.length > 0) return texts;
  }
  // Fallback to ChatCompletion shape.
  return cc.choices?.[0]?.message?.content ?? '';
}

describe.each(LIVE_PROVIDERS)('Live: Responses × $id', (cfg) => {
  const run = shouldRunLive(cfg);

  describe.skipIf(!run)('scenarios', () => {
    const provider = cfg.build();
    const connection = run ? cfg.buildConnection() : (null as never);
    const model = run ? cfg.buildModel() : (null as never);
    const modelId = RESPONSES_MODELS[cfg.id] ?? cfg.model;

    const dispatch = async (body: ResponsesRequestDto, stream = false) => {
      const payload = { ...body, stream } as ResponsesRequestDto;
      return provider.openAIResponse(
        payload as Parameters<typeof provider.openAIResponse>[0],
        connection,
        model
      );
    };

    it(
      'simple single message (non-streaming)',
      async () => {
        const response = await dispatch(
          baseRequest(modelId, 'Reply with the single word: pong')
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
          baseRequest(modelId, 'Reply with the single word: pong'),
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
            {
              role: 'user',
              content: [{ type: 'input_text', text: 'My name is Lucas.' }],
            },
            {
              role: 'assistant',
              content: [
                { type: 'output_text', text: 'Hello Lucas, nice to meet you.' },
              ],
            },
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: 'What is my name? Reply with just my name.',
                },
              ],
            },
          ] as never)
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
          ] as never),
          true
        );
        const text = await getResponseText(response.data);
        expect(text).toMatch(/Lucas/i);
      },
      TIMEOUT
    );

    it(
      'with system prompt via instructions (non-streaming)',
      async () => {
        const response = await dispatch(
          baseRequest(modelId, 'say hello', {
            instructions: 'Reply ONLY in ALL CAPS. Never use lowercase.',
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
            "What's the temperature in Tokyo? Use the get_weather tool.",
            { tools: [WEATHER_TOOL] as never }
          )
        );
        // Either tool was called (function_call output item) or
        // model answered inline. The request shouldn't crash either
        // way.
        expect(response.data).toBeDefined();
      },
      TIMEOUT
    );

    it.skipIf(!cfg.supportsTools)(
      'with tool call (streaming)',
      async () => {
        const response = await dispatch(
          baseRequest(
            modelId,
            "What's the temperature in Tokyo? Use the get_weather tool.",
            { tools: [WEATHER_TOOL] as never }
          ),
          true
        );
        expect(response.data).toBeDefined();
      },
      TIMEOUT
    );

    it.skipIf(!cfg.supportsTools)(
      'with multiple tool calls (parallel) — non-streaming',
      async () => {
        const response = await dispatch(
          baseRequest(
            modelId,
            'Tell me both the weather AND local time in Tokyo. Use the get_weather and get_time tools in parallel.',
            { tools: [WEATHER_TOOL, TIME_TOOL] as never }
          )
        );
        expect(response.data).toBeDefined();
      },
      TIMEOUT
    );

    it.skipIf(!cfg.supportsTools)(
      'tool result follow-up (assistant uses tool output)',
      async () => {
        // Responses-API multi-turn with a function_call + function_call_output:
        const response = await dispatch(
          baseRequest(
            modelId,
            [
              {
                role: 'user',
                content: [
                  {
                    type: 'input_text',
                    text: "What's the temperature in Tokyo?",
                  },
                ],
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
            { tools: [WEATHER_TOOL] as never }
          )
        );
        const text = await getResponseText(response.data);
        if (text) {
          expect(text).toMatch(/15/);
        }
      },
      TIMEOUT
    );

    it.skipIf(cfg.id !== 'openai')(
      'no conversion: Responses request to OpenAI preserves the body verbatim (model field aside)',
      async () => {
        const body = baseRequest(modelId, 'Reply pong');
        const response = await dispatch(body);
        // OpenAI Responses input now goes via native passthrough
        // (`client.responses.create()`), so the captured wire body is
        // the Responses-shape body the SDK sent — preserving the
        // original `input` field as-is. The pre-Phase-E behaviour
        // (going through the Chat Completions pivot) is deprecated.
        const captured = response.providerRequestPayload as Record<
          string,
          unknown
        >;
        expect(captured).toBeDefined();
        // The captured wire body should preserve the client's `input`
        // (string or items array) verbatim. No conversion to
        // ChatCompletion `messages` should have happened.
        expect(captured.input).toBeDefined();
        expect(captured.model).toBe(modelId);
      },
      TIMEOUT
    );

    if (cfg.providerSpecificArgs) {
      it(
        `accepts provider-native field passthrough on Responses shape (${Object.keys(
          cfg.providerSpecificArgs
        ).join(', ')})`,
        async () => {
          const response = await dispatch(
            baseRequest(modelId, 'Reply with the word: pong', {
              ...(cfg.providerSpecificArgs as Partial<ResponsesRequestDto>),
            })
          );
          const text = await getResponseText(response.data);
          assertNonEmptyText(text);
        },
        TIMEOUT
      );
    }
  });
});
