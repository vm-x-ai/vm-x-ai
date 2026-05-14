import { describe, expect, it } from 'vitest';
import type {
  Response as OpenAIResponse,
  ResponseCreateParams,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses.js';
import type {
  Message as AnthropicMessage,
  RawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages';
import { hasKeys, requiredEnv } from '../helpers/env';
import {
  buildOpenAIProvider,
  makeConnection,
  makeModel,
} from '../helpers/factories';
import {
  reasoningPrompt,
  simplePrompt,
  structuredOutputPrompt,
  toolCallPrompt,
  toolFollowupPrompt,
  webSearchPrompt,
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
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';

const SHOULD_RUN = hasKeys('OPENAI_API_KEY');
const TEST_MODEL = process.env.OPENAI_TEST_MODEL ?? 'gpt-4o-mini';
const SEARCH_MODEL =
  process.env.OPENAI_SEARCH_TEST_MODEL ?? 'gpt-4o-mini-search-preview';
const REASONING_MODEL = process.env.OPENAI_REASONING_TEST_MODEL ?? 'o4-mini';
const TIMEOUT = 60_000;

describe.skipIf(!SHOULD_RUN)('OpenAI provider (live)', () => {
  const provider = buildOpenAIProvider();
  const connection = makeConnection('openai', {
    apiKey: SHOULD_RUN ? requiredEnv('OPENAI_API_KEY') : '',
  });
  const model = makeModel('openai', TEST_MODEL);

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
        toolFollowupPrompt('call_weather_1'),
        connection,
        model
      );
      const data = await expectNonStreaming(response);
      const content = data.choices[0].message.content ?? '';
      assertNonEmptyText(content);
      // Sanity: model should have echoed the temperature we returned.
      expect(content).toMatch(/15/);
    },
    TIMEOUT
  );

  it(
    'structured output (json_schema, strict)',
    async () => {
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

  it(
    'web search via search-class model — hard-asserts annotations passthrough',
    async () => {
      const searchModel = makeModel('openai', SEARCH_MODEL);
      const response = await provider.openAICompletion(
        {
          model: SEARCH_MODEL,
          messages: [{ role: 'user', content: webSearchPrompt.question }],
        },
        connection,
        searchModel
      );
      const data = await expectNonStreaming(response);
      const message = data.choices[0]
        .message as (typeof data.choices)[number]['message'] & {
        annotations?: Array<{
          type: string;
          url_citation?: { url: string; title?: string };
        }>;
      };
      assertNonEmptyText(message.content ?? '');

      // Hard assertion: downstream consumers read message.annotations
      // to render [1][2] inline citations. If our gateway ever strips
      // this field (or the SDK changes shape), citation rendering breaks.
      expect(
        message.annotations,
        'OpenAI search-class response had no annotations array'
      ).toBeDefined();
      const urlCitations = (message.annotations ?? []).filter(
        (a) => a.type === 'url_citation' && !!a.url_citation?.url
      );
      expect(
        urlCitations.length,
        'OpenAI search response carried zero url_citation annotations'
      ).toBeGreaterThan(0);
    },
    TIMEOUT * 2
  );

  it(
    'web search (streaming) via search-class model — annotations land on the assembled stream',
    async () => {
      // Streaming companion to the non-stream test above. OpenAI's
      // search-class models stream `delta.annotations[]` entries (the
      // NESTED chat-completions shape `{type:'url_citation', url_citation:{...}}`)
      // alongside text deltas. `collectStream` reassembles them so we
      // can hard-assert at least one url_citation made it through.
      const searchModel = makeModel('openai', SEARCH_MODEL);
      const response = await provider.openAICompletion(
        {
          model: SEARCH_MODEL,
          messages: [{ role: 'user', content: webSearchPrompt.question }],
          stream: true,
        },
        connection,
        searchModel
      );
      const stream = await expectStreaming(response);
      const collected = await collectStream(stream);
      assertNonEmptyText(collected.text);
      // Walk raw chunks for `choice.delta.annotations[]` — search-class
      // models splice url_citations into the delta alongside text deltas.
      // `collectStream` only accumulates text + tool calls; annotations
      // live in the raw chunk shape.
      const urlCitations: Array<{ url: string }> = [];
      for (const chunk of collected.chunks) {
        const choice = chunk.choices?.[0];
        const annotations =
          (
            choice?.delta as {
              annotations?: Array<{
                type?: string;
                url_citation?: { url?: string };
              }>;
            }
          )?.annotations ?? [];
        for (const ann of annotations) {
          if (ann.type === 'url_citation' && ann.url_citation?.url) {
            urlCitations.push({ url: ann.url_citation.url });
          }
        }
      }
      expect(
        urlCitations.length,
        'OpenAI streaming search response carried zero url_citation annotations'
      ).toBeGreaterThan(0);
    },
    TIMEOUT * 2
  );

  it(
    'openAIResponse: web search via web_search_preview tool — annotations on output_text',
    async () => {
      // Responses-canonical opt-in. `gpt-4o-mini` accepts the hosted
      // `web_search_preview` tool and emits `url_citation` annotations
      // attached to the output_text part of the message item. Pins the
      // gateway's non-streaming passthrough of this shape — the
      // playground's Responses tab with Web Search ON routes through
      // exactly this path.
      const responsesModel = makeModel('openai', TEST_MODEL);
      const req: ResponseCreateParams = {
        model: TEST_MODEL,
        input: webSearchPrompt.question,
        max_output_tokens: 512,
        tools: [{ type: 'web_search_preview' }] as never,
      } as ResponseCreateParams;
      const response = await provider.openAIResponse(
        req,
        connection,
        responsesModel
      );
      // Native Responses non-streaming — `expectNonStreaming` is typed for
      // ChatCompletion, so assert the shape inline like perplexity.spec.ts
      // does for its `openAIResponse` cells.
      expect(isAsyncIterable(response.data)).toBe(false);
      const data = response.data as OpenAIResponse;
      assertNonEmptyText(data.output_text);

      // Pull every url_citation annotation off `output[].content[].annotations[]`
      // — OpenAI Responses uses the FLAT shape here (different from Chat
      // Completions which is NESTED).
      const urlAnnotations: Array<{ url: string }> = [];
      for (const item of data.output) {
        if (item.type !== 'message') continue;
        for (const part of item.content ?? []) {
          if (part.type !== 'output_text') continue;
          for (const ann of part.annotations ?? []) {
            const url = (ann as { url?: string }).url;
            if (typeof url === 'string') urlAnnotations.push({ url });
          }
        }
      }
      expect(
        urlAnnotations.length,
        'OpenAI Responses + web_search_preview had no url_citation annotations on output_text'
      ).toBeGreaterThan(0);
    },
    TIMEOUT * 2
  );

  it(
    'openAIResponse streaming: web search via web_search_preview — annotation.added events emit url_citations',
    async () => {
      // Streaming companion. OpenAI emits a stream of typed events
      // including `response.output_text.annotation.added` whose
      // `annotation` payload is the FLAT url_citation shape (matching
      // the non-stream contract above). The closing `response.completed`
      // event's `response.output[]` carries the final annotations
      // bundled onto the message item.
      const responsesModel = makeModel('openai', TEST_MODEL);
      const req: ResponseCreateParams = {
        model: TEST_MODEL,
        input: webSearchPrompt.question,
        max_output_tokens: 512,
        stream: true,
        tools: [{ type: 'web_search_preview' }] as never,
      } as ResponseCreateParams;
      const response = await provider.openAIResponse(
        req,
        connection,
        responsesModel
      );
      expect(isAsyncIterable(response.data)).toBe(true);
      const events: ResponseStreamEvent[] = [];
      for await (const ev of response.data as AsyncIterable<ResponseStreamEvent>) {
        events.push(ev);
      }
      const annotationAdded = events.filter(
        (e) =>
          (e as { type?: string }).type ===
          'response.output_text.annotation.added'
      ) as Array<{ annotation: { type?: string; url?: string } }>;
      expect(
        annotationAdded.length,
        'OpenAI Responses streaming + web_search_preview emitted no annotation.added events'
      ).toBeGreaterThan(0);
      // Each annotation must be a url_citation with a non-empty url —
      // ensures the citation chips will actually render on the client.
      expect(
        annotationAdded.every(
          (e) => e.annotation.type === 'url_citation' && !!e.annotation.url
        )
      ).toBe(true);
    },
    TIMEOUT * 2
  );

  it(
    'anthropicMessages: web search via web_search_20250305 — gateway translates to web_search_preview, passes through',
    async () => {
      // The playground's Anthropic tab attaches Anthropic-canonical
      // `web_search_20250305` when Web Search is on. The gateway's
      // dispatch-via-Responses helper translates that to OpenAI's
      // `web_search_preview` before the upstream call, and converts
      // the Responses response back to an Anthropic Message. This
      // test pins that the round-trip succeeds (text comes back,
      // no upstream 400) — citation passthrough is intentionally
      // a known gap on the Anthropic surface, documented by the
      // Perplexity sibling test.
      const responsesModel = makeModel('openai', TEST_MODEL);
      const req: AnthropicMessagesRequest = {
        model: TEST_MODEL,
        max_tokens: 512,
        messages: [{ role: 'user', content: webSearchPrompt.question }],
        tools: [{ type: 'web_search_20250305', name: 'web_search' } as never],
      } as AnthropicMessagesRequest;
      const response = await provider.anthropicMessages(
        req,
        connection,
        responsesModel
      );
      expect(isAsyncIterable(response.data)).toBe(false);
      const data = response.data as AnthropicMessage;
      const text = data.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text: string }).text)
        .join('');
      assertNonEmptyText(text);
    },
    TIMEOUT * 2
  );

  it(
    'anthropicMessages streaming: web search via web_search_20250305 — events round-trip without upstream error',
    async () => {
      const responsesModel = makeModel('openai', TEST_MODEL);
      const req: AnthropicMessagesRequest = {
        model: TEST_MODEL,
        max_tokens: 512,
        stream: true,
        messages: [{ role: 'user', content: webSearchPrompt.question }],
        tools: [{ type: 'web_search_20250305', name: 'web_search' } as never],
      } as AnthropicMessagesRequest;
      const response = await provider.anthropicMessages(
        req,
        connection,
        responsesModel
      );
      expect(isAsyncIterable(response.data)).toBe(true);
      const events: RawMessageStreamEvent[] = [];
      for await (const ev of response.data as AsyncIterable<RawMessageStreamEvent>) {
        events.push(ev);
      }
      // Must terminate cleanly with message_stop after a closing
      // message_delta — proves the gateway's Responses→Anthropic
      // streaming converter consumed every upstream event without
      // throwing on the search-tool round-trip.
      const types = events.map((e) => e.type);
      expect(types).toContain('message_start');
      expect(types).toContain('message_delta');
      expect(types).toContain('message_stop');
      // At least one text delta must have flowed through — proves the
      // assistant reply actually streamed (not just empty events).
      const textDeltas = events.filter(
        (e) =>
          e.type === 'content_block_delta' &&
          (e as { delta?: { type?: string } }).delta?.type === 'text_delta'
      );
      expect(textDeltas.length).toBeGreaterThan(0);
    },
    TIMEOUT * 2
  );

  it(
    'reasoning model exposes reasoning_tokens in usage',
    async () => {
      const reasoningModel = makeModel('openai', REASONING_MODEL);
      const response = await provider.openAICompletion(
        {
          ...reasoningPrompt,
          // Reasoning models reject sampling params in OpenAI's API.
          temperature: undefined,
          max_tokens: undefined,
          max_completion_tokens: 4096,
        },
        connection,
        reasoningModel
      );
      const data = await expectNonStreaming(response);
      assertNonEmptyText(data.choices[0].message.content ?? '');
      // Hard assertion: completion_tokens_details.reasoning_tokens is
      // the field downstream agents consume (mapped to
      // output_tokens_details.reasoning_tokens in the Responses API
      // converter).
      const details = data.usage?.completion_tokens_details;
      expect(
        details,
        'reasoning model returned no completion_tokens_details'
      ).toBeDefined();
      expect(
        details!.reasoning_tokens,
        'reasoning_tokens missing on usage details'
      ).toBeGreaterThan(0);
    },
    TIMEOUT * 3
  );

  // ─── openAIResponse() — native Responses passthrough live sweep ────
  // The cell under audit. Goes through
  // `OpenAIResponseProvider.handle()` → `client.responses.create()`
  // verbatim and verifies the SDK's `Response` / `ResponseStreamEvent`
  // shapes arrive on the wire (no Chat Completions pivot, no
  // per-chunk vmx decoration).
  it(
    'openAIResponse: simple completion (non-streaming) — usage.input_tokens/output_tokens populated',
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
      // Native Responses usage shape — distinct from ChatCompletion.usage.
      expect(data.usage?.input_tokens).toBeGreaterThan(0);
      expect(data.usage?.output_tokens).toBeGreaterThan(0);
      // Audit invariant.
      const captured = response.providerRequestPayload as Record<
        string,
        unknown
      >;
      expect(captured.input).toBe('Reply with exactly the word: pong');
      expect(captured.model).toBe(TEST_MODEL);
    },
    TIMEOUT
  );

  it(
    'openAIResponse: streaming — strictly monotonic sequence numbers + response.completed',
    async () => {
      const req: ResponseCreateParams = {
        model: 'placeholder',
        input: 'Reply with the single word: pong',
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
      // Strictly monotonic sequence numbers — required by the
      // Responses streaming spec, and the property downstream
      // event-id continuity logic depends on.
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
      // The final `response.completed` event must carry the usage
      // payload — that's the only place Responses streaming surfaces
      // it (no separate usage chunk, unlike Chat Completions).
      const done = events.find(
        (e) => (e as { type?: string }).type === 'response.completed'
      ) as {
        response?: {
          usage?: { input_tokens?: number; output_tokens?: number };
        };
      };
      expect(done?.response?.usage?.input_tokens).toBeGreaterThan(0);
      expect(done?.response?.usage?.output_tokens).toBeGreaterThan(0);
    },
    TIMEOUT
  );

  it(
    'openAIResponse: function tool call — function_call output item',
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
    'openAIResponse: multipart input (text + input_image data URL)',
    async () => {
      // 8x8 solid-red PNG. OpenAI's image processor rejects 1x1
      // transparent PNGs as "not a valid image"; an 8x8 with actual
      // pixel content is the smallest payload that survives.
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
    'openAIResponse: reasoning model with reasoning.effort + reasoning.summary',
    async () => {
      const reasoningModel = makeModel('openai', REASONING_MODEL);
      const req: ResponseCreateParams = {
        model: 'placeholder',
        input:
          'A bat and ball cost $1.10 together. The bat costs $1 more than the ball. How much is the ball?',
        max_output_tokens: 2048,
        reasoning: { effort: 'low', summary: 'auto' },
      } as ResponseCreateParams;
      const response = await provider.openAIResponse(
        req,
        connection,
        reasoningModel
      );
      const data = response.data as OpenAIResponse;
      assertNonEmptyText(data.output_text);
      // Reasoning-token accounting is the headline differentiator —
      // pin that it flows back on usage.output_tokens_details.
      const details = (
        data.usage as { output_tokens_details?: { reasoning_tokens?: number } }
      )?.output_tokens_details;
      expect(
        details?.reasoning_tokens,
        'reasoning_tokens missing'
      ).toBeGreaterThan(0);
    },
    TIMEOUT * 3
  );

  it(
    'openAIResponse: instructions → casing constraint applied',
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

  it(
    'openAIResponse: previous_response_id continuity (memory across turns)',
    async () => {
      // Turn 1 — establish a fact with `store: true` so OpenAI keeps
      // it server-side and Turn 2 can reference it by id.
      const turn1 = await provider.openAIResponse(
        {
          model: 'placeholder',
          input: 'My favourite colour is teal. Reply only with: noted.',
          max_output_tokens: 16,
          temperature: 0,
          store: true,
        } as ResponseCreateParams,
        connection,
        model
      );
      const firstId = (turn1.data as OpenAIResponse).id;
      expect(firstId).toBeTruthy();

      const turn2 = await provider.openAIResponse(
        {
          model: 'placeholder',
          input:
            'What is my favourite colour? Reply with just the colour, lowercase, no punctuation.',
          previous_response_id: firstId,
          max_output_tokens: 16,
          temperature: 0,
        } as ResponseCreateParams,
        connection,
        model
      );
      const followUp = (turn2.data as OpenAIResponse).output_text;
      expect(followUp.toLowerCase()).toContain('teal');
    },
    TIMEOUT * 2
  );

  it(
    'openAIResponse: error mapping — BadRequest on invalid input is non-retryable',
    async () => {
      // `max_output_tokens` of 0 is rejected by the API; the cell must
      // surface this as a non-retryable CompletionError (the gateway
      // should not fall forward to other models on a 4xx).
      await expect(
        provider.openAIResponse(
          {
            model: 'placeholder',
            input: 'hi',
            max_output_tokens: 0,
          } as ResponseCreateParams,
          connection,
          model
        )
      ).rejects.toMatchObject({
        data: expect.objectContaining({
          retryable: false,
          providerRequestPayload: expect.objectContaining({
            model: TEST_MODEL,
          }),
        }),
      });
    },
    TIMEOUT
  );

  // ─── anthropicMessages() — Anthropic-input → Responses pivot ──────
  // The D5 conversion path: Anthropic Messages body is adapted to a
  // ResponseCreateParams, dispatched through `OpenAIResponseProvider`,
  // and the Responses output is converted back to an Anthropic Message
  // / Anthropic SSE event stream. Audit row's
  // `providerRequestPayload` captures the post-conversion Responses
  // wire body, not the original Anthropic request.
  it(
    'anthropicMessages: simple completion (non-streaming) — Anthropic Message shape',
    async () => {
      const req: AnthropicMessagesRequest = {
        model: 'placeholder',
        max_tokens: 32,
        temperature: 0,
        messages: [
          { role: 'user', content: 'Reply with exactly the word: pong' },
        ],
      };
      const response = await provider.anthropicMessages(req, connection, model);
      expect(isAsyncIterable(response.data)).toBe(false);
      const msg = response.data as AnthropicMessage;
      expect(msg.type).toBe('message');
      expect(msg.role).toBe('assistant');
      // SDK 0.95.1 wire-shape compliance.
      expect(msg.container).toBeNull();
      expect(msg.stop_details).toBeNull();
      const text = msg.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text: string }).text)
        .join('');
      assertNonEmptyText(text);
      // Usage all 8 fields, with `input_tokens` / `output_tokens`
      // mapped off the native Responses-shape body.
      const u = msg.usage as unknown as Record<string, unknown>;
      expect(u.input_tokens).toBeGreaterThan(0);
      expect(u.output_tokens).toBeGreaterThan(0);
      expect(u.cache_creation).toBeNull();
      expect(u.inference_geo).toBeNull();
      expect(u.server_tool_use).toBeNull();
      expect(u.service_tier).toBeNull();
      // Audit invariant: provider payload is the Responses-shape body
      // post-conversion (not the Anthropic body).
      const captured = response.providerRequestPayload as Record<
        string,
        unknown
      >;
      expect(captured.model).toBe(TEST_MODEL);
      expect(captured.input).toBeDefined();
      expect(captured.max_output_tokens).toBe(32);
    },
    TIMEOUT
  );

  it(
    'anthropicMessages: simple completion (streaming) — Anthropic RawMessageStream envelope',
    async () => {
      const req: AnthropicMessagesRequest = {
        model: 'placeholder',
        max_tokens: 32,
        temperature: 0,
        stream: true,
        messages: [{ role: 'user', content: 'Reply with the word: pong' }],
      };
      const response = await provider.anthropicMessages(req, connection, model);
      expect(isAsyncIterable(response.data)).toBe(true);
      const events: RawMessageStreamEvent[] = [];
      for await (const ev of response.data as AsyncIterable<RawMessageStreamEvent>) {
        events.push(ev);
      }
      const types = events.map((e) => e.type);
      expect(types[0]).toBe('message_start');
      expect(types).toContain('content_block_start');
      expect(types).toContain('content_block_delta');
      expect(types).toContain('content_block_stop');
      expect(types).toContain('message_delta');
      expect(types[types.length - 1]).toBe('message_stop');
      // Reconstructed text from text_delta events.
      const text = events
        .filter(
          (e) =>
            e.type === 'content_block_delta' &&
            (e as { delta: { type: string } }).delta.type === 'text_delta'
        )
        .map((e) => (e as { delta: { text: string } }).delta.text)
        .join('');
      assertNonEmptyText(text);
      // Final message_delta carries cumulative usage (input + output).
      const finalDelta = events.find((e) => e.type === 'message_delta') as {
        usage: { input_tokens: number; output_tokens: number };
      };
      expect(finalDelta.usage.input_tokens).toBeGreaterThan(0);
      expect(finalDelta.usage.output_tokens).toBeGreaterThan(0);
    },
    TIMEOUT
  );

  it(
    'anthropicMessages: tool call (non-streaming) — tool_use block + stop_reason: tool_use',
    async () => {
      const req: AnthropicMessagesRequest = {
        model: 'placeholder',
        max_tokens: 128,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content:
              "What's the temperature in Tokyo? Use the get_weather tool.",
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
        ] as never,
      };
      const response = await provider.anthropicMessages(req, connection, model);
      const msg = response.data as AnthropicMessage;
      const tool = msg.content.find((b) => b.type === 'tool_use') as
        | {
            type: 'tool_use';
            id: string;
            name: string;
            input: unknown;
            caller: { type: string };
          }
        | undefined;
      expect(tool, 'expected a tool_use content block').toBeDefined();
      expect(tool!.name).toBe('get_weather');
      expect(tool!.caller).toEqual({ type: 'direct' });
      expect(msg.stop_reason).toBe('tool_use');
    },
    TIMEOUT
  );

  it(
    'anthropicMessages: tool call (streaming) — tool_use start + input_json_delta',
    async () => {
      const req: AnthropicMessagesRequest = {
        model: 'placeholder',
        max_tokens: 128,
        temperature: 0,
        stream: true,
        messages: [
          {
            role: 'user',
            content:
              "What's the temperature in Tokyo? Use the get_weather tool.",
          },
        ],
        tools: [
          {
            name: 'get_weather',
            description: 'Get the current weather in a city',
            input_schema: {
              type: 'object',
              properties: { location: { type: 'string' } },
              required: ['location'],
            },
          },
        ] as never,
      };
      const response = await provider.anthropicMessages(req, connection, model);
      const events: RawMessageStreamEvent[] = [];
      for await (const ev of response.data as AsyncIterable<RawMessageStreamEvent>) {
        events.push(ev);
      }
      const toolStart = events.find(
        (e) =>
          e.type === 'content_block_start' &&
          (e as { content_block: { type: string } }).content_block.type ===
            'tool_use'
      ) as { content_block: { name: string; caller: { type: string } } };
      expect(
        toolStart,
        'expected a tool_use content_block_start'
      ).toBeDefined();
      expect(toolStart.content_block.name).toBe('get_weather');
      expect(toolStart.content_block.caller).toEqual({ type: 'direct' });
      // Accumulated arguments via input_json_delta must parse to JSON.
      const argChunks = events
        .filter(
          (e) =>
            e.type === 'content_block_delta' &&
            (e as { delta: { type: string } }).delta.type === 'input_json_delta'
        )
        .map(
          (e) => (e as { delta: { partial_json: string } }).delta.partial_json
        )
        .join('');
      expect(() => JSON.parse(argChunks)).not.toThrow();
      const finalDelta = events.find((e) => e.type === 'message_delta') as {
        delta: { stop_reason: string };
      };
      expect(finalDelta.delta.stop_reason).toBe('tool_use');
    },
    TIMEOUT
  );

  it(
    'anthropicMessages: tool_result followup (assistant uses prior tool output)',
    async () => {
      const req: AnthropicMessagesRequest = {
        model: 'placeholder',
        max_tokens: 64,
        temperature: 0,
        messages: [
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
        ],
        tools: [
          {
            name: 'get_weather',
            description: 'Get the current weather in a city',
            input_schema: {
              type: 'object',
              properties: { location: { type: 'string' } },
              required: ['location'],
            },
          },
        ] as never,
      };
      const response = await provider.anthropicMessages(req, connection, model);
      const msg = response.data as AnthropicMessage;
      const text = msg.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text: string }).text)
        .join('');
      assertNonEmptyText(text);
      expect(text).toMatch(/15/);
    },
    TIMEOUT
  );

  it(
    'anthropicMessages: multipart input (text + image base64 source)',
    async () => {
      // 8x8 solid-red PNG; the OpenAI image processor (via Responses
      // under the hood) rejects 1x1 transparent payloads.
      const tinyPngBase64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC';
      const req: AnthropicMessagesRequest = {
        model: 'placeholder',
        max_tokens: 64,
        temperature: 0,
        messages: [
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
            ] as never,
          },
        ],
      };
      const response = await provider.anthropicMessages(req, connection, model);
      const msg = response.data as AnthropicMessage;
      const text = msg.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text: string }).text)
        .join('');
      assertNonEmptyText(text);
    },
    TIMEOUT
  );

  it(
    'anthropicMessages: thinking → reasoning roundtrip on a reasoning model',
    async () => {
      const reasoningModel = makeModel('openai', REASONING_MODEL);
      const req: AnthropicMessagesRequest = {
        model: 'placeholder',
        max_tokens: 2048,
        messages: [
          {
            role: 'user',
            content:
              'A bat and ball cost $1.10 together. The bat costs $1 more than the ball. How much is the ball?',
          },
        ],
        thinking: { type: 'enabled', budget_tokens: 1024 } as never,
      };
      const response = await provider.anthropicMessages(
        req,
        connection,
        reasoningModel
      );
      const msg = response.data as AnthropicMessage;
      const text = msg.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text: string }).text)
        .join('');
      assertNonEmptyText(text);
      // Audit row should record `reasoning.effort` on the Responses
      // wire body — that's how the budget propagates to OpenAI.
      const captured = response.providerRequestPayload as {
        reasoning?: { effort?: string };
      };
      expect(captured.reasoning?.effort).toBeDefined();
    },
    TIMEOUT * 3
  );

  it(
    'anthropicMessages: error mapping — BadRequest on invalid input is non-retryable',
    async () => {
      // Same constraint as the openAIResponse error-mapping test —
      // `max_tokens: 0` translates to `max_output_tokens: 0`, which
      // OpenAI rejects with a 400. Errors come up through the inner
      // ResponseProvider and surface as a CompletionError verbatim
      // (the Anthropic-input class does not re-wrap errors).
      await expect(
        provider.anthropicMessages(
          {
            model: 'placeholder',
            max_tokens: 0,
            messages: [{ role: 'user', content: 'hi' }],
          } as AnthropicMessagesRequest,
          connection,
          model
        )
      ).rejects.toMatchObject({
        data: expect.objectContaining({
          retryable: false,
          providerRequestPayload: expect.objectContaining({
            model: TEST_MODEL,
          }),
        }),
      });
    },
    TIMEOUT
  );
});
