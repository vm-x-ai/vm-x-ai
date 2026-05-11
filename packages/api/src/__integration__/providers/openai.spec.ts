import { describe, expect, it } from 'vitest';
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
});
