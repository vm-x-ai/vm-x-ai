import { describe, expect, it } from 'vitest';
import type {
  ChatCompletion,
  ChatCompletionCreateParams,
} from 'openai/resources/index.js';
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
});
