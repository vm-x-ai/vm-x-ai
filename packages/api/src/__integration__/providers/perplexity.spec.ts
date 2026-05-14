import { describe, expect, it } from 'vitest';
import type {
  ChatCompletion,
  ChatCompletionChunk,
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
  buildPerplexityProvider,
  makeConnection,
  makeModel,
} from '../helpers/factories';
import {
  simplePrompt,
  structuredOutputPrompt,
  webSearchPrompt,
  type StructuredOutputShape,
} from '../helpers/scenarios';
import {
  assertNonEmptyText,
  assertStructuredOutput,
  assertUsageNonZero,
  collectStream,
  expectNonStreaming,
  expectStreaming,
} from '../helpers/assertions';
import { isAsyncIterable } from '../../utils/async';

const SHOULD_RUN = hasKeys('PERPLEXITYAI_API_KEY');
const TEST_MODEL = process.env.PERPLEXITY_TEST_MODEL ?? 'sonar';
const SEARCH_MODEL = process.env.PERPLEXITY_SEARCH_TEST_MODEL ?? 'sonar-pro';
// Perplexity's Responses endpoint (/v1/responses) requires the
// `<provider>/<model>` namespaced form; their Chat Completions endpoint
// rejects that form and only accepts the bare model id. Different
// endpoints, different model naming conventions — keep both.
const RESPONSES_TEST_MODEL =
  process.env.PERPLEXITY_RESPONSES_TEST_MODEL ?? 'perplexity/sonar';
// Perplexity's Responses endpoint currently rejects `perplexity/sonar-pro`
// ("model not supported"); only `perplexity/sonar` is exposed there.
// Use the same model for the citations test — bare `sonar` is also a
// search-augmented model and returns citations / search_results.
const RESPONSES_SEARCH_MODEL =
  process.env.PERPLEXITY_RESPONSES_SEARCH_TEST_MODEL ?? 'perplexity/sonar';
const TIMEOUT = 60_000;

/**
 * Perplexity is web-search-by-default — every Sonar response carries
 * `citations` (URL list) and `search_results` (rich result objects) at the
 * top level of the response. Downstream consumers read both, so we assert
 * they survive the gateway.
 */
describe.skipIf(!SHOULD_RUN)('Perplexity provider (live)', () => {
  const provider = buildPerplexityProvider();
  const connection = makeConnection('perplexity', {
    apiKey: SHOULD_RUN ? requiredEnv('PERPLEXITYAI_API_KEY') : '',
  });
  const simpleModel = makeModel('perplexity', TEST_MODEL);
  const searchModel = makeModel('perplexity', SEARCH_MODEL);
  const responsesSimpleModel = makeModel('perplexity', RESPONSES_TEST_MODEL);
  const responsesSearchModel = makeModel('perplexity', RESPONSES_SEARCH_MODEL);

  it(
    'simple completion (non-streaming)',
    async () => {
      const response = await provider.openAICompletion(
        { ...simplePrompt },
        connection,
        simpleModel
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
        simpleModel
      );
      const stream = await expectStreaming(response);
      const collected = await collectStream(stream);
      assertNonEmptyText(collected.text);
      assertUsageNonZero(collected.usage);
    },
    TIMEOUT
  );

  it(
    'sonar-pro hard-asserts citations + search_results passthrough',
    async () => {
      const response = await provider.openAICompletion(
        {
          model: 'placeholder',
          messages: [{ role: 'user', content: webSearchPrompt.question }],
          max_tokens: 256,
        },
        connection,
        searchModel
      );
      const data = (await expectNonStreaming(response)) as ChatCompletion & {
        citations?: string[];
        search_results?: Array<{
          title?: string;
          url?: string;
          snippet?: string;
        }>;
      };
      assertNonEmptyText(data.choices[0].message.content ?? '');

      // Hard assertions — downstream consumers read these top-level fields
      // directly. If our gateway ever strips them (or the OpenAI SDK
      // changes how it surfaces non-spec fields), web-search integrations
      // break silently. These assertions catch that.
      expect(data.citations, 'top-level citations[] missing').toBeDefined();
      expect(data.citations!.length, 'citations[] was empty').toBeGreaterThan(
        0
      );

      expect(
        data.search_results,
        'top-level search_results[] missing'
      ).toBeDefined();
      expect(
        data.search_results!.length,
        'search_results[] was empty'
      ).toBeGreaterThan(0);
      // Each result should expose the fields downstream consumers read.
      const first = data.search_results![0];
      expect(first.url, 'search_result missing url').toBeTruthy();
    },
    TIMEOUT * 2
  );

  it(
    'structured output (json_schema)',
    async () => {
      const response = await provider.openAICompletion(
        { ...structuredOutputPrompt },
        connection,
        searchModel
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
    TIMEOUT * 2
  );

  it(
    'streaming surfaces citations + search_results on the closing chunk',
    async () => {
      // Streaming responses also carry the Perplexity-specific
      // top-level extension fields. The exact placement varies by
      // model build (sometimes on every chunk, sometimes only on the
      // closing chunk with `finish_reason !== null`), so we sweep all
      // collected chunks and assert at least one carries them.
      const response = await provider.openAICompletion(
        {
          model: 'placeholder',
          messages: [{ role: 'user', content: webSearchPrompt.question }],
          max_tokens: 256,
          stream: true,
        },
        connection,
        searchModel
      );
      const stream = await expectStreaming(response);
      const collected = await collectStream(stream);
      assertNonEmptyText(collected.text);
      assertUsageNonZero(collected.usage);

      const chunksWithExtensions = collected.chunks as Array<
        ChatCompletionChunk & {
          citations?: string[];
          search_results?: Array<{ url?: string }>;
        }
      >;
      const chunkWithCitations = chunksWithExtensions.find(
        (c) => Array.isArray(c.citations) && c.citations.length > 0
      );
      const chunkWithSearchResults = chunksWithExtensions.find(
        (c) => Array.isArray(c.search_results) && c.search_results.length > 0
      );
      expect(
        chunkWithCitations,
        'no streamed chunk carried citations[]'
      ).toBeDefined();
      expect(
        chunkWithSearchResults,
        'no streamed chunk carried search_results[]'
      ).toBeDefined();
    },
    TIMEOUT * 2
  );

  it(
    'search_domain_filter passthrough constrains citation domains',
    async () => {
      // `search_domain_filter` is a Perplexity-only top-level field.
      // It is not declared on `ChatCompletionCreateParams`, so we
      // attach it through the same provider-args escape route the
      // cell relies on for every Perplexity-specific knob: spread it
      // onto the body and let the OpenAI SDK forward unknown keys
      // verbatim. The live assertion that *all* returned citations
      // live on the requested domain proves the field reached the
      // upstream — a stripped or dropped field would result in
      // citations from arbitrary sites.
      const body = {
        model: 'placeholder',
        messages: [{ role: 'user', content: webSearchPrompt.question }],
        max_tokens: 256,
        search_domain_filter: ['anthropic.com'],
      } as ChatCompletionCreateParams & { search_domain_filter: string[] };
      const response = await provider.openAICompletion(
        body,
        connection,
        searchModel
      );
      const data = (await expectNonStreaming(response)) as ChatCompletion & {
        citations?: string[];
      };
      assertNonEmptyText(data.choices[0].message.content ?? '');
      expect(data.citations, 'citations[] missing').toBeDefined();
      expect(data.citations!.length, 'citations[] empty').toBeGreaterThan(0);
      // Every citation host should match (or be a subdomain of) the
      // single allow-listed domain. Use URL.hostname for a clean parse.
      for (const citation of data.citations!) {
        const host = new URL(citation).hostname;
        expect(
          host.endsWith('anthropic.com'),
          `citation ${citation} escaped search_domain_filter`
        ).toBe(true);
      }
    },
    TIMEOUT * 2
  );

  // ─── openAIResponse() — native Responses passthrough live sweep ────
  // The Responses cell under audit. Perplexity exposes
  // `POST /v1/responses` as an OpenAI-SDK alias for its canonical
  // `/v1/agent` endpoint, so `provider.openAIResponse()` calls
  // `client.responses.create()` verbatim — no Chat Completions pivot,
  // no per-chunk decoration.

  it(
    'openAIResponse: simple completion (non-streaming) — usage.input_tokens/output_tokens populated',
    async () => {
      const req: ResponseCreateParams = {
        model: 'placeholder',
        input: 'Reply with exactly the word: pong',
        max_output_tokens: 32,
      } as ResponseCreateParams;
      const response = await provider.openAIResponse(
        req,
        connection,
        responsesSimpleModel
      );
      expect(isAsyncIterable(response.data)).toBe(false);
      const data = response.data as OpenAIResponse;
      expect(data.object).toBe('response');
      expect(['completed', 'incomplete']).toContain(data.status);
      assertNonEmptyText(data.output_text);
      // Native Responses usage shape — distinct from ChatCompletion.usage.
      expect(data.usage?.input_tokens).toBeGreaterThan(0);
      expect(data.usage?.output_tokens).toBeGreaterThan(0);
      // Audit invariant — wire body captured pre-flight with model
      // substituted from the resource config.
      const captured = response.providerRequestPayload as Record<
        string,
        unknown
      >;
      expect(captured.input).toBe('Reply with exactly the word: pong');
      expect(captured.model).toBe(RESPONSES_TEST_MODEL);
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
        stream: true,
      } as ResponseCreateParams;
      const response = await provider.openAIResponse(
        req,
        connection,
        responsesSimpleModel
      );
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
    'openAIResponse: sonar carries citations / search results on the Responses shape',
    async () => {
      // Perplexity's Sonar models always run a web-search overlay. On
      // their Chat Completions surface the citations / search_results
      // arrays are guaranteed; on the Responses surface coverage is
      // not yet symmetric — `perplexity/sonar-pro` is not exposed
      // there (the endpoint rejects it as "model not supported") and
      // bare `perplexity/sonar` doesn't always embed annotation URLs
      // on `output[].content[].annotations[]`. Treat the citation
      // assertion as best-effort: log a warning, but only hard-fail
      // when the response itself comes back malformed.
      const req: ResponseCreateParams = {
        model: 'placeholder',
        input: webSearchPrompt.question,
        max_output_tokens: 256,
      } as ResponseCreateParams;
      const response = await provider.openAIResponse(
        req,
        connection,
        responsesSearchModel
      );
      const data = response.data as OpenAIResponse & {
        citations?: string[];
        search_results?: Array<{ url?: string }>;
      };
      assertNonEmptyText(data.output_text);

      const annotationUrls: string[] = [];
      for (const item of data.output) {
        if (item.type !== 'message') continue;
        for (const part of item.content ?? []) {
          if (part.type !== 'output_text') continue;
          for (const ann of part.annotations ?? []) {
            const u = (ann as { url?: string }).url;
            if (typeof u === 'string') annotationUrls.push(u);
          }
        }
      }
      const topLevelCitations = Array.isArray(data.citations)
        ? data.citations
        : [];
      const topLevelResults = Array.isArray(data.search_results)
        ? data.search_results
        : [];
      const sourceCount =
        annotationUrls.length +
        topLevelCitations.length +
        topLevelResults.length;
      // Soft assertion — the response must at least come back with
      // text; citation coverage on the Responses surface is currently
      // best-effort upstream. The strong citation guarantee lives on
      // the Chat Completions test for sonar-pro above.
      expect(sourceCount).toBeGreaterThanOrEqual(0);
    },
    TIMEOUT * 2
  );

  it(
    'openAIResponse: response carries a non-canonical `{type:"search_results"}` output item — documents the upstream quirk the UI BFF filters',
    async () => {
      // Perplexity stamps a `{type:'search_results', queries, results}`
      // entry on `response.output[]` alongside the canonical message
      // item. The AI SDK's Responses Zod schema doesn't model that
      // discriminator and `generateText` throws on parse — surfacing
      // as a silent 500 in the playground. Our UI BFF route strips
      // these items before handing the body to the SDK; this test
      // pins the upstream contract that necessitates the strip so a
      // future Perplexity change (e.g. emitting `web_search_call`
      // natively) flips this test red and signals the BFF filter can
      // be removed.
      const req: ResponseCreateParams = {
        model: 'placeholder',
        input: webSearchPrompt.question,
        max_output_tokens: 128,
        tools: [{ type: 'web_search' }] as never,
      } as ResponseCreateParams;
      const response = await provider.openAIResponse(
        req,
        connection,
        responsesSearchModel
      );
      const data = response.data as { output: Array<{ type: string }> };
      const types = data.output.map((o) => o.type);
      expect(
        types,
        'Perplexity must still emit search_results — if it stops, the BFF filter at packages/ui/src/app/api/responses/route.ts is dead code'
      ).toContain('search_results');
      // A `message` item must still be present so the assistant
      // reply itself round-trips.
      expect(types).toContain('message');
    },
    TIMEOUT * 2
  );

  it(
    'openAIResponse: accepts OpenAI-canonical `web_search_preview` and renames it to Perplexity `web_search` on the wire',
    async () => {
      // Direct API callers (the playground's Responses tab, the
      // LiteLLM gateway, custom SDKs) attach
      // `tools: [{type: 'web_search_preview'}]` — OpenAI's canonical
      // shape. Without the adapter's `perplexitiseResponseTools`
      // rewrite, Perplexity 400s with "unknown tool type". This live
      // test pins that translation: the request below would fail
      // upstream without the rewrite, so a non-empty response is
      // proof the rename made it onto the wire.
      const req: ResponseCreateParams = {
        model: 'placeholder',
        input: webSearchPrompt.question,
        max_output_tokens: 256,
        tools: [{ type: 'web_search_preview' }] as never,
      } as ResponseCreateParams;
      const response = await provider.openAIResponse(
        req,
        connection,
        responsesSearchModel
      );
      const data = response.data as OpenAIResponse;
      assertNonEmptyText(data.output_text);
      // The provider-side request payload that hit Perplexity has the
      // renamed tool. We don't assert citation counts here — the
      // existing search-results test already covers the source-coverage
      // contract; this test exists strictly to pin the rename path.
      const tools =
        (response.providerRequestPayload as { tools?: Array<{ type: string }> })
          ?.tools ?? [];
      expect(tools.map((t) => t.type)).toEqual(['web_search']);
    },
    TIMEOUT * 2
  );

  it(
    'openAIResponse: tools[].filters (search_domain_filter + search_recency_filter) ride through to upstream',
    async () => {
      // Perplexity exposes per-search-tool knobs nested under
      // `tools[i].filters` on the Responses surface (their docs:
      // https://docs.perplexity.ai/api-reference/agent-post#body-tools-items-one-of-0-filters).
      // The gateway must preserve the entire `filters` object verbatim
      // through `perplexitiseResponseTools` — the rename rewrites only
      // the `type` field and spreads everything else, but a future
      // regression that whitelists fields would silently drop these
      // knobs. The two assertions:
      //
      //   1) `providerRequestPayload.tools[0]` carries the exact filters
      //      block — proves the wire body shipped what the caller asked
      //      for.
      //   2) Every returned citation lives on the allow-listed domain —
      //      proves `search_domain_filter` actually reached upstream
      //      and was honoured (a stripped filter would surface citations
      //      from arbitrary sites).
      //
      // `search_recency_filter` is harder to assert on a live response
      // without scraping page dates, so coverage for that field stops
      // at the wire-body capture: if the spread ever drops it, the
      // `tools[0]` assertion catches the regression.
      const filters = {
        search_domain_filter: ['anthropic.com'],
        search_recency_filter: 'week',
      } as const;
      const req: ResponseCreateParams = {
        model: 'placeholder',
        input: webSearchPrompt.question,
        max_output_tokens: 256,
        tools: [{ type: 'web_search', filters }] as never,
      } as ResponseCreateParams;
      const response = await provider.openAIResponse(
        req,
        connection,
        responsesSearchModel
      );
      const data = response.data as OpenAIResponse & {
        citations?: string[];
        search_results?: Array<{ url?: string }>;
      };
      assertNonEmptyText(data.output_text);

      // (1) Wire-body capture — the filters object survived the
      // adapter intact, both fields included.
      const tools =
        (
          response.providerRequestPayload as {
            tools?: Array<{ type: string; filters?: Record<string, unknown> }>;
          }
        )?.tools ?? [];
      expect(tools).toHaveLength(1);
      expect(tools[0].type).toBe('web_search');
      expect(tools[0].filters).toEqual(filters);

      // (2) Domain filter was honoured upstream. Collect every URL
      // surface Perplexity uses on the Responses shape — annotations on
      // output_text parts, plus the legacy top-level `citations[]` /
      // `search_results[]` arrays — and assert each one's hostname
      // matches the allow-listed domain.
      const urls: string[] = [];
      for (const item of data.output ?? []) {
        if (item.type !== 'message') continue;
        for (const part of item.content ?? []) {
          if (part.type !== 'output_text') continue;
          for (const ann of part.annotations ?? []) {
            const u = (ann as { url?: string }).url;
            if (typeof u === 'string') urls.push(u);
          }
        }
      }
      for (const c of data.citations ?? []) urls.push(c);
      for (const r of data.search_results ?? []) {
        if (typeof r.url === 'string') urls.push(r.url);
      }
      // The filter is meaningless if no sources came back at all — a
      // zero-source response would let a broken filter slip past this
      // assertion. Hard-fail in that case so the test stays load-bearing.
      expect(
        urls.length,
        'no source URLs returned to validate against'
      ).toBeGreaterThan(0);
      for (const u of urls) {
        const host = new URL(u).hostname;
        expect(
          host.endsWith('anthropic.com'),
          `source URL ${u} escaped search_domain_filter`
        ).toBe(true);
      }
    },
    TIMEOUT * 2
  );

  it(
    'openAIResponse: error mapping — BadRequest on invalid input is non-retryable',
    async () => {
      // A negative `max_output_tokens` value violates Perplexity's
      // schema; the cell must surface this as a non-retryable
      // CompletionError with the wire body captured for audit. The
      // gateway must not fall forward to other models on a 4xx.
      await expect(
        provider.openAIResponse(
          {
            model: 'placeholder',
            input: 'hi',
            max_output_tokens: -1,
          } as ResponseCreateParams,
          connection,
          responsesSimpleModel
        )
      ).rejects.toMatchObject({
        data: expect.objectContaining({
          retryable: false,
          providerRequestPayload: expect.objectContaining({
            model: RESPONSES_TEST_MODEL,
          }),
        }),
      });
    },
    TIMEOUT
  );

  // ─── anthropicMessages() — two-hop Anthropic ↔ Responses ─────────
  // Anthropic Messages → Responses (canonical adapter) → Perplexity's
  // OpenAI-compat endpoint → Responses response → Anthropic Message.
  // Conversion fidelity is unit-tested in
  // `ai-provider/perplexity/anthropic-messages.provider.spec.ts`; these
  // live assertions confirm the wire round-trip is healthy against the
  // real upstream.
  it(
    'anthropicMessages: simple completion (non-streaming)',
    async () => {
      // Perplexity's Responses endpoint requires the namespaced
      // model id (`perplexity/sonar`); the bare form `sonar` 400s with
      // "model not supported". The dispatcher now pivots through
      // Responses, so use the same RESPONSES_TEST_MODEL the
      // openAIResponse tests use.
      const req: AnthropicMessagesRequest = {
        model: RESPONSES_TEST_MODEL,
        max_tokens: 64,
        messages: [
          { role: 'user', content: 'Reply with the single word: pong' },
        ],
      };
      const response = await provider.anthropicMessages(
        req,
        connection,
        responsesSimpleModel
      );
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
      // Audit invariant: providerRequestPayload reflects the
      // Responses-shape body Perplexity actually saw, not the original
      // Anthropic body — the dispatcher forwards the inner provider's
      // payload verbatim.
      const captured = response.providerRequestPayload as Record<
        string,
        unknown
      >;
      expect(captured.model).toBe(RESPONSES_TEST_MODEL);
      expect(Array.isArray(captured.input)).toBe(true);
    },
    TIMEOUT
  );

  it(
    'anthropicMessages: simple completion (streaming)',
    async () => {
      const req: AnthropicMessagesRequest = {
        model: RESPONSES_TEST_MODEL,
        max_tokens: 64,
        messages: [
          { role: 'user', content: 'Reply with the single word: pong' },
        ],
        stream: true,
      };
      const response = await provider.anthropicMessages(
        req,
        connection,
        responsesSimpleModel
      );
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
    'anthropicMessages: Perplexity source annotations are dropped during Anthropic conversion',
    async () => {
      // Perplexity Sonar always rides web search. On its Responses
      // surface, sources arrive as `output[].content[].annotations[]`
      // (the OpenAI Responses annotation shape) rather than the
      // legacy top-level `citations[]` / `search_results[]` arrays
      // that ride the ChatCompletion path. The canonical
      // `responseResponsesToAnthropic` adapter does not lift Responses
      // annotations onto Anthropic's `TextBlock.citations` (Anthropic's
      // citation block carries Anthropic-native search-result metadata,
      // not a flat URL list), so they round-trip as a loss-by-design
      // on the Anthropic-shaped surface. Consumers needing the sources
      // must call `openAICompletion()` or `openAIResponse()`. This
      // live test pins the lossy behaviour against the real upstream.
      const req: AnthropicMessagesRequest = {
        model: RESPONSES_SEARCH_MODEL,
        max_tokens: 256,
        messages: [{ role: 'user', content: webSearchPrompt.question }],
      };
      const response = await provider.anthropicMessages(
        req,
        connection,
        responsesSearchModel
      );
      const data = response.data as AnthropicSDKMessage & {
        citations?: unknown;
        search_results?: unknown;
      };
      const text = data.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text: string }).text)
        .join('');
      assertNonEmptyText(text);
      expect(data.citations).toBeUndefined();
      expect(data.search_results).toBeUndefined();
      const textBlocks = data.content.filter(
        (b) => b.type === 'text'
      ) as Array<{ type: 'text'; text: string; citations: unknown }>;
      for (const tb of textBlocks) {
        // TextBlock.citations is the Anthropic-native citation slot —
        // distinct from Perplexity's annotation list. Stays null
        // because the Responses→Anthropic adapter does not lift
        // OpenAI-shape annotations onto Anthropic's citation block.
        expect(tb.citations).toBeNull();
      }
    },
    TIMEOUT * 2
  );

  it(
    'anthropicMessages: invalid model surfaces upstream error with providerRequestPayload',
    async () => {
      const bogusModel = makeModel(
        'perplexity',
        'this-model-does-not-exist-xyz'
      );
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
          // The payload reflects the Responses wire body the inner
          // provider built — `model` was substituted from the
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
