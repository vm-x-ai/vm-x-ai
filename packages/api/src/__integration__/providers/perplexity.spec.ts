import { describe, expect, it } from 'vitest';
import type { ChatCompletion } from 'openai/resources/index.js';
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

const SHOULD_RUN = hasKeys('PERPLEXITYAI_API_KEY');
const TEST_MODEL = process.env.PERPLEXITY_TEST_MODEL ?? 'sonar';
const SEARCH_MODEL = process.env.PERPLEXITY_SEARCH_TEST_MODEL ?? 'sonar-pro';
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
});
