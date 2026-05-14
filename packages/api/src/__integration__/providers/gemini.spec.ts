import { describe, expect, it } from 'vitest';
import type {
  ChatCompletion,
  ChatCompletionCreateParams,
} from 'openai/resources/index.js';
import type {
  Response as OpenAIResponse,
  ResponseCreateParams,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses.js';
import type {
  Message as AnthropicSDKMessage,
  RawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages';
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';
import { hasKeys, requiredEnv } from '../helpers/env';
import {
  buildGeminiProvider,
  makeConnection,
  makeModel,
} from '../helpers/factories';
import {
  simplePrompt,
  toolCallPrompt,
  webSearchPrompt,
} from '../helpers/scenarios';
import {
  assertNonEmptyText,
  assertToolCall,
  assertUsageNonZero,
  collectStream,
  expectNonStreaming,
  expectStreaming,
} from '../helpers/assertions';
import { isAsyncIterable } from '../../utils/async';

const SHOULD_RUN = hasKeys('GEMINI_API_KEY');
// `gemini-2.5-flash` is the thinking-enabled flash model — it returns
// thinking output without populating `content` on the OpenAI-compat
// endpoint, which makes `assertNonEmptyText` fail. `flash-lite` is
// the non-thinking sibling and returns the answer directly in
// `content`. (`gemini-2.0-flash` was retired from the
// `v1beta/openai` endpoint and now 404s.)
const TEST_MODEL = process.env.GEMINI_TEST_MODEL ?? 'gemini-2.5-flash-lite';
const TIMEOUT = 60_000;

describe.skipIf(!SHOULD_RUN)('Gemini provider (live)', () => {
  const provider = buildGeminiProvider();
  const connection = makeConnection('gemini', {
    apiKey: SHOULD_RUN ? requiredEnv('GEMINI_API_KEY') : '',
  });
  const model = makeModel('gemini', TEST_MODEL);

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
    'tool calling (streaming) — functionCall part surfaces as a tool_calls delta',
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
    'web search via googleSearch tool — asserts grounding survives',
    async () => {
      // Mirrors how downstream consumers using LiteLLM call
      // acompletion with tools=[{googleSearch:{}}]. The Gemini OpenAI
      // proxy accepts non-function tool entries verbatim.
      //
      // KNOWN-RISK: Gemini's OpenAI-compatible endpoint may surface
      // grounding metadata under a different key than LiteLLM's native
      // path (which sets vertex_ai_grounding_metadata). This test probes
      // every plausible location and fails clearly if NONE are present —
      // that signals we need to switch GeminiProvider to the native API.
      const request: ChatCompletionCreateParams & {
        tools?: unknown;
      } = {
        model: 'placeholder',
        messages: [{ role: 'user', content: webSearchPrompt.question }],
        tools: [
          { googleSearch: {} },
        ] as unknown as ChatCompletionCreateParams['tools'],
        max_tokens: 256,
      };
      const response = await provider.openAICompletion(
        request as ChatCompletionCreateParams,
        connection,
        model
      );
      const data = (await expectNonStreaming(response)) as ChatCompletion & {
        vertex_ai_grounding_metadata?: unknown;
        groundingMetadata?: unknown;
        _hidden_params?: { vertex_ai_grounding_metadata?: unknown };
      };
      assertNonEmptyText(data.choices[0].message.content ?? '');

      // Look for grounding data in any of the known shapes.
      const grounding =
        data.vertex_ai_grounding_metadata ??
        data.groundingMetadata ??
        data._hidden_params?.vertex_ai_grounding_metadata ??
        // Some Gemini OpenAI-compat responses may attach grounding under
        // a different key on the choice or message.
        (
          data.choices[0] as ChatCompletion['choices'][number] & {
            grounding_metadata?: unknown;
            groundingMetadata?: unknown;
          }
        )?.grounding_metadata ??
        (
          data.choices[0]
            .message as ChatCompletion['choices'][number]['message'] & {
            grounding_metadata?: unknown;
            groundingMetadata?: unknown;
          }
        )?.grounding_metadata;

      expect(
        grounding,
        'Gemini googleSearch response had no grounding metadata in any known location ' +
          '(vertex_ai_grounding_metadata, groundingMetadata, _hidden_params, choice/message). ' +
          'If this fails, the grounding contract for downstream consumers is broken — consider switching ' +
          'GeminiProvider to the native @google/genai SDK to capture grounding chunks.'
      ).toBeDefined();
    },
    TIMEOUT * 2
  );

  // The native path now also kicks in when callers use OpenAI's
  // standard `web_search_options` knob (the same opt-in OpenAI's
  // search-class models read). The provider injects `googleSearch`
  // and routes through @google/genai so Gemini doesn't 400 on the
  // unknown field. This test guards the playground use case.
  it(
    'web search via web_search_options — native path injects googleSearch',
    async () => {
      const request: ChatCompletionCreateParams & {
        web_search_options?: Record<string, unknown>;
      } = {
        model: 'placeholder',
        messages: [{ role: 'user', content: webSearchPrompt.question }],
        web_search_options: {},
        max_tokens: 256,
      };
      const response = await provider.openAICompletion(
        request as ChatCompletionCreateParams,
        connection,
        model
      );
      const data = (await expectNonStreaming(response)) as ChatCompletion & {
        vertex_ai_grounding_metadata?: unknown;
      };
      assertNonEmptyText(data.choices[0].message.content ?? '');
      expect(
        data.vertex_ai_grounding_metadata,
        'web_search_options should route through the native path and surface grounding metadata'
      ).toBeDefined();
    },
    TIMEOUT * 2
  );

  // The playground always streams. This test exercises the same
  // request shape (`tools: [{googleSearch: {}}]` + `stream: true`)
  // that previously 400'd ("native path does not support streaming")
  // and now produces a real SSE stream via `generateContentStream`.
  it(
    'web search streaming via googleSearch — native path emits chunks',
    async () => {
      const request: ChatCompletionCreateParams & { tools?: unknown } = {
        model: 'placeholder',
        messages: [{ role: 'user', content: webSearchPrompt.question }],
        tools: [
          { googleSearch: {} },
        ] as unknown as ChatCompletionCreateParams['tools'],
        stream: true,
        max_tokens: 256,
      };
      const response = await provider.openAICompletion(
        request as ChatCompletionCreateParams,
        connection,
        model
      );
      const stream = await expectStreaming(response);
      const collected = await collectStream(stream);
      assertNonEmptyText(collected.text);
    },
    TIMEOUT * 2
  );

  // ─── Cross-format grounding propagation (Responses + Anthropic) ─────
  //
  // The Chat Completions tests above already verify Gemini emits
  // grounding metadata when web search is on. These tests pin the
  // *cross-format converters* — `openAIResponse` and `anthropicMessages`
  // — surface the same payload under `grounding_metadata` AND
  // `vertex_ai_grounding_metadata` on the response shape callers see.
  // Without these, playground tabs that drive Gemini through the
  // Responses or Anthropic endpoints drop the citation source rank /
  // segment provenance the Chat Completions tab gets.

  it(
    'openAIResponse: filters.search_recency_filter rides through onto googleSearch.timeRangeFilter',
    async () => {
      // The Responses → Gemini converter projects Perplexity-style
      // `filters.search_recency_filter` onto Gemini's native
      // `googleSearch.timeRangeFilter` (Gemini-API-only field). A
      // bare `googleSearch:{}` would not pass any window to the
      // upstream; this test confirms the time-window survives the
      // hop end-to-end by asking for "this week" and checking the
      // request completes (a window the upstream rejected would
      // surface as a 400 from the wire).
      const request: ResponseCreateParams = {
        model: 'placeholder',
        input: webSearchPrompt.question,
        tools: [
          {
            type: 'web_search',
            filters: { search_recency_filter: 'week' },
          },
        ] as never,
        max_output_tokens: 256,
      } as ResponseCreateParams;
      const response = await provider.openAIResponse(
        request,
        connection,
        model
      );
      expect(isAsyncIterable(response.data)).toBe(false);
      const data = response.data as OpenAIResponse;
      assertNonEmptyText(data.output_text);
      // The captured request payload reflects what was actually sent
      // upstream — pin the conversion result so a future regression
      // (e.g. someone removing the recency mapping) flips this red.
      // Gemini's providerRequestPayload is `GenerateContentParameters`
      // (native SDK shape) — `tools` lives on `.config.tools`, not at
      // the top level.
      const tools = (
        response.providerRequestPayload as {
          config?: {
            tools?: Array<{
              googleSearch?: {
                timeRangeFilter?: { startTime: string; endTime: string };
              };
            }>;
          };
        }
      )?.config?.tools;
      const tr = tools?.[0]?.googleSearch?.timeRangeFilter;
      expect(
        tr,
        'googleSearch.timeRangeFilter missing on the wire body'
      ).toBeDefined();
      const windowMs = Date.parse(tr!.endTime) - Date.parse(tr!.startTime);
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      // Allow ~2s slack — start/end are computed at two separate
      // `Date` reads in the converter.
      expect(Math.abs(windowMs - sevenDaysMs)).toBeLessThan(2_000);
    },
    TIMEOUT * 2
  );

  it(
    'openAIResponse: vmx.providerArgs.tools passes through Gemini-native tool entries verbatim',
    async () => {
      // Caller supplies a Gemini-native `{googleSearch: {timeRangeFilter}}`
      // via `vmx.providerArgs.tools`. The orchestrator merges that into
      // the top-level `tools[]`; the Responses→Gemini converter must
      // detect the native shape (no `type` field) and passthrough,
      // not silently drop. Bypassing the cross-format converter lets
      // callers reach Gemini-API knobs (explicit `timeRangeFilter`
      // dates) the OpenAI-shape tool entry can't express.
      // Gemini's protobuf Timestamp rejects fractional seconds — strip
      // the `.SSSZ` suffix that JS `Date.toISOString()` always emits.
      const stripMs = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
      const explicitStart = stripMs(
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      );
      const explicitEnd = stripMs(new Date());
      // Call the converter directly via the provider's openAIResponse —
      // the orchestrator-level merge isn't exercised at the provider
      // layer (the orchestrator merges before dispatch), so for a
      // converter-level live test we put the native shape directly in
      // `tools[]`. The integration tests in
      // `provider-args.spec.ts` cover the orchestrator merge path.
      const request: ResponseCreateParams = {
        model: 'placeholder',
        input: webSearchPrompt.question,
        tools: [
          {
            googleSearch: {
              timeRangeFilter: {
                startTime: explicitStart,
                endTime: explicitEnd,
              },
            },
          },
        ] as never,
        max_output_tokens: 256,
      } as ResponseCreateParams;
      const response = await provider.openAIResponse(
        request,
        connection,
        model
      );
      expect(isAsyncIterable(response.data)).toBe(false);
      const data = response.data as OpenAIResponse;
      assertNonEmptyText(data.output_text);
      // Gemini's providerRequestPayload is `GenerateContentParameters`
      // (native SDK shape) — `tools` lives on `.config.tools`, not at
      // the top level.
      const tools = (
        response.providerRequestPayload as {
          config?: {
            tools?: Array<{
              googleSearch?: {
                timeRangeFilter?: { startTime: string; endTime: string };
              };
            }>;
          };
        }
      )?.config?.tools;
      // Native passthrough — the exact start/end we passed in survives.
      expect(tools?.[0]?.googleSearch?.timeRangeFilter).toEqual({
        startTime: explicitStart,
        endTime: explicitEnd,
      });
    },
    TIMEOUT * 2
  );

  it(
    'openAIResponse: web search via web_search_preview surfaces grounding extension fields',
    async () => {
      // OpenAI Responses-canonical web-search opt-in. The Gemini
      // provider's per-format adapter maps `web_search_preview` (and
      // `web_search`) to native `{googleSearch:{}}` before the SDK
      // call; the response converter then exposes the candidate's
      // `groundingMetadata` under both extension keys.
      const request: ResponseCreateParams = {
        model: 'placeholder',
        input: webSearchPrompt.question,
        tools: [{ type: 'web_search_preview' }] as never,
        max_output_tokens: 256,
      } as ResponseCreateParams;
      const response = await provider.openAIResponse(
        request,
        connection,
        model
      );
      // Native Responses non-streaming — `expectNonStreaming` is typed for
      // ChatCompletion, so assert the shape inline.
      expect(isAsyncIterable(response.data)).toBe(false);
      const data = response.data as OpenAIResponse & {
        grounding_metadata?: unknown;
        vertex_ai_grounding_metadata?: unknown;
      };
      assertNonEmptyText(data.output_text);
      expect(
        data.vertex_ai_grounding_metadata,
        'Gemini Responses converter must expose vertex_ai_grounding_metadata when web search is on'
      ).toBeDefined();
      expect(
        data.grounding_metadata,
        'parity key — `grounding_metadata` mirrors `vertex_ai_grounding_metadata`'
      ).toBeDefined();
    },
    TIMEOUT * 2
  );

  it(
    'openAIResponse streaming: grounding extension fields land on response.completed event',
    async () => {
      const request: ResponseCreateParams = {
        model: 'placeholder',
        input: webSearchPrompt.question,
        tools: [{ type: 'web_search_preview' }] as never,
        stream: true,
        max_output_tokens: 256,
      } as ResponseCreateParams;
      const response = await provider.openAIResponse(
        request,
        connection,
        model
      );
      expect(isAsyncIterable(response.data)).toBe(true);
      const events: ResponseStreamEvent[] = [];
      for await (const ev of response.data as AsyncIterable<ResponseStreamEvent>) {
        events.push(ev);
      }
      const completed = events.find(
        (e) => (e as { type?: string }).type === 'response.completed'
      ) as
        | {
            type: 'response.completed';
            response: {
              output_text: string;
              grounding_metadata?: unknown;
              vertex_ai_grounding_metadata?: unknown;
            };
          }
        | undefined;
      expect(
        completed,
        'stream must terminate with response.completed'
      ).toBeDefined();
      assertNonEmptyText(completed!.response.output_text);
      expect(
        completed!.response.vertex_ai_grounding_metadata,
        'streaming converter must accumulate grounding and surface it on the closing event'
      ).toBeDefined();
      expect(completed!.response.grounding_metadata).toBeDefined();
    },
    TIMEOUT * 2
  );

  it(
    'anthropicMessages: web search via web_search_20250305 surfaces grounding extension fields',
    async () => {
      // Anthropic-canonical web-search tool. The Gemini Anthropic
      // adapter classifies any `web_search*` tool as the `web_search`
      // family and translates to `{googleSearch:{}}` for the upstream
      // call; the response converter then exposes the candidate's
      // `groundingMetadata` under both extension keys on the
      // returned `AnthropicMessage`.
      const request: AnthropicMessagesRequest = {
        model: 'placeholder',
        max_tokens: 256,
        messages: [{ role: 'user', content: webSearchPrompt.question }],
        tools: [{ type: 'web_search_20250305', name: 'web_search' } as never],
      } as AnthropicMessagesRequest;
      const response = await provider.anthropicMessages(
        request,
        connection,
        model
      );
      expect(isAsyncIterable(response.data)).toBe(false);
      const data = response.data as AnthropicSDKMessage & {
        grounding_metadata?: unknown;
        vertex_ai_grounding_metadata?: unknown;
      };
      // Anthropic-shape content carries text inside content blocks; we
      // only need to verify it's non-empty (sanity), the grounding
      // fields are what this test guards.
      expect(data.content.length).toBeGreaterThan(0);
      expect(
        data.vertex_ai_grounding_metadata,
        'Gemini Anthropic converter must expose vertex_ai_grounding_metadata when web search is on'
      ).toBeDefined();
      expect(data.grounding_metadata).toBeDefined();
    },
    TIMEOUT * 2
  );

  it(
    'anthropicMessages streaming: grounding extension fields land on the closing message_delta',
    async () => {
      const request: AnthropicMessagesRequest = {
        model: 'placeholder',
        max_tokens: 256,
        stream: true,
        messages: [{ role: 'user', content: webSearchPrompt.question }],
        tools: [{ type: 'web_search_20250305', name: 'web_search' } as never],
      } as AnthropicMessagesRequest;
      const response = await provider.anthropicMessages(
        request,
        connection,
        model
      );
      expect(isAsyncIterable(response.data)).toBe(true);
      const events: RawMessageStreamEvent[] = [];
      for await (const ev of response.data as AsyncIterable<RawMessageStreamEvent>) {
        events.push(ev);
      }
      const messageDelta = events.find(
        (e) => (e as { type?: string }).type === 'message_delta'
      ) as
        | (Extract<RawMessageStreamEvent, { type: 'message_delta' }> & {
            grounding_metadata?: unknown;
            vertex_ai_grounding_metadata?: unknown;
          })
        | undefined;
      expect(
        messageDelta,
        'stream must include a closing message_delta'
      ).toBeDefined();
      expect(
        messageDelta!.vertex_ai_grounding_metadata,
        'streaming Anthropic converter must accumulate grounding and surface it on message_delta'
      ).toBeDefined();
      expect(messageDelta!.grounding_metadata).toBeDefined();
    },
    TIMEOUT * 2
  );
});
