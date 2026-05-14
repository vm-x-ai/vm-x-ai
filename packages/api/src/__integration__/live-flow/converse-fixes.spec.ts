import { describe, expect, it } from 'vitest';
import { hasKeys, requiredEnv } from '../helpers/env';
import {
  buildBedrockProvider,
  makeConnection,
  makeModel,
} from '../helpers/factories';
import { assertNonEmptyText, expectNonStreaming } from '../helpers/assertions';
import { CompletionError } from '../../gateway/completion.types';
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';

/**
 * Live tests for the Bedrock-Converse fixes from the support-matrix
 * batch. These exercise behaviour only verifiable against real
 * Bedrock — caching cache-token reporting (T1), tool_choice none
 * (T11), structured-output JSON validity (T12), and the per-model
 * capability gate (T19).
 */

const SHOULD_RUN = hasKeys('AWS_BEDROCK_ROLE_ARN', 'AWS_REGION');
const TEST_MODEL =
  process.env.BEDROCK_TEST_MODEL ??
  'us.anthropic.claude-haiku-4-5-20251001-v1:0';
// L1 specifically needs a model whose Bedrock listing includes
// prompt-caching support. Claude Haiku 4.5 on Bedrock does not (yet)
// honour `cachePoint` markers — Bedrock silently returns 0 for both
// cache_creation_input_tokens and cache_read_input_tokens. Sonnet 4.5
// is the closest current-gen model that consistently caches, so the
// caching regression test pins to it while the other tests in this
// file keep the cheaper default model.
const CACHE_TEST_MODEL =
  process.env.BEDROCK_CACHE_TEST_MODEL ??
  'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
const TIMEOUT = 60_000;

/**
 * A long-enough system prompt to clear Bedrock's per-model cache
 * minimum. Claude Haiku on Bedrock requires ≥ 2048 tokens of
 * cacheable prefix before it will commit a cache write; Sonnet/Opus
 * allow as little as 1024. We aim for ~3000 tokens so the threshold
 * is cleared with margin regardless of which model the test runs
 * against. Generated as repeated structured prose so the fixture is
 * self-contained.
 */
function longSystemPrompt(): string {
  const base =
    'You are a senior systems engineer writing a comprehensive design ' +
    'document about a distributed inference gateway. Provide thorough, ' +
    'thoughtful answers that account for failure modes, latency, cost, ' +
    'and operational complexity. Always cite trade-offs explicitly. ';
  return base.repeat(80);
}

describe.skipIf(!SHOULD_RUN)('Bedrock-Converse fixes (live)', () => {
  const provider = buildBedrockProvider();
  const connection = makeConnection('aws-bedrock', {
    iamRoleArn: SHOULD_RUN ? requiredEnv('AWS_BEDROCK_ROLE_ARN') : '',
    region: SHOULD_RUN ? requiredEnv('AWS_REGION') : 'us-east-1',
  });
  const model = makeModel('aws-bedrock', TEST_MODEL);

  // ─── L1: cachePoint emission produces real cache hits ─────────────
  it(
    'L1: prompt caching produces non-zero cache_read on second call',
    async () => {
      const sys = longSystemPrompt();
      const cacheModel = makeModel('aws-bedrock', CACHE_TEST_MODEL);
      const body: AnthropicMessagesRequest = {
        model: CACHE_TEST_MODEL,
        max_tokens: 16,
        system: [
          {
            type: 'text',
            text: sys,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: 'reply with: pong' }],
      } as AnthropicMessagesRequest;

      // Warm cache — first call writes.
      const first = await provider.anthropicMessages(
        body,
        connection,
        cacheModel
      );
      const firstUsage = (first.data as { usage?: Record<string, unknown> })
        .usage;
      expect(firstUsage).toBeDefined();

      // Second identical call — should read from cache. Bedrock
      // commits the cache asynchronously after first call so a small
      // delay reduces flake; even without the delay the assertion
      // below allows for either an immediate hit or a measurable
      // cache_creation on the first call.
      await new Promise((r) => setTimeout(r, 1500));
      const second = await provider.anthropicMessages(
        body,
        connection,
        cacheModel
      );
      const secondUsage = (second.data as { usage?: Record<string, unknown> })
        .usage as
        | {
            cache_read_input_tokens?: number | null;
            cache_creation_input_tokens?: number | null;
          }
        | undefined;
      // Either the second call was a cache read OR the first call
      // wrote tokens to cache. If neither happened, the cachePoint
      // emission is broken — exactly what T1 fixed.
      const cacheTokensActive =
        (secondUsage?.cache_read_input_tokens ?? 0) > 0 ||
        ((firstUsage as { cache_creation_input_tokens?: number | null })
          ?.cache_creation_input_tokens ?? 0) > 0;
      expect(
        cacheTokensActive,
        'Bedrock-Converse caching looks non-functional: ' +
          `first.cache_creation=${
            (firstUsage as { cache_creation_input_tokens?: unknown })
              ?.cache_creation_input_tokens
          }, second.cache_read=${secondUsage?.cache_read_input_tokens}. ` +
          'Confirms T1 fix is wired correctly only if at least one is non-zero.'
      ).toBe(true);
    },
    TIMEOUT
  );

  // ─── L11: tool_choice 'none' really suppresses tool calls ─────────
  it(
    'L11: Anthropic input with tool_choice.none returns no tool_use blocks',
    async () => {
      const body = {
        model: TEST_MODEL,
        max_tokens: 64,
        messages: [
          {
            role: 'user',
            content:
              'What is the temperature in Tokyo? Use the get_weather tool if available.',
          },
        ],
        tools: [
          {
            name: 'get_weather',
            description: 'Get current weather in a city',
            input_schema: {
              type: 'object',
              properties: {
                location: { type: 'string' },
              },
              required: ['location'],
            },
          },
        ],
        tool_choice: { type: 'none' },
      } as unknown as AnthropicMessagesRequest;

      const response = await provider.anthropicMessages(
        body,
        connection,
        model
      );
      const data = response.data as {
        content?: Array<{ type?: string }>;
      };
      const toolUseBlocks = (data.content ?? []).filter(
        (b) => b.type === 'tool_use'
      );
      expect(
        toolUseBlocks.length,
        'tool_choice: none should suppress tool_use blocks but Bedrock emitted some — gateway is not stripping tools'
      ).toBe(0);
    },
    TIMEOUT
  );

  // ─── L12: response_format json_schema produces valid JSON ─────────
  it(
    'L12: response_format json_schema produces valid JSON conforming to schema',
    async () => {
      const response = await provider.openAICompletion(
        {
          model: TEST_MODEL,
          messages: [
            {
              role: 'user',
              content:
                'Return the city Tokyo and its ISO 3166-1 alpha-2 country code as JSON.',
            },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'CityCountryCode',
              strict: true,
              schema: {
                type: 'object',
                additionalProperties: false,
                required: ['city', 'country_code'],
                properties: {
                  city: { type: 'string' },
                  country_code: { type: 'string' },
                },
              },
            },
          },
          max_tokens: 128,
          temperature: 0,
        },
        connection,
        model
      );
      const data = await expectNonStreaming(response);
      const content = data.choices[0].message.content ?? '';
      assertNonEmptyText(content);
      // T12 unwraps the synthetic-tool input back into message.content
      // as the JSON string; should parse cleanly and match the schema.
      const parsed = JSON.parse(content) as Record<string, unknown>;
      expect(typeof parsed.city).toBe('string');
      expect(typeof parsed.country_code).toBe('string');
    },
    TIMEOUT
  );

  // ─── L19: per-model gating returns clean 400 ─────────────────────
  it(
    'L19: sending tools to a no-tool-support model returns gateway 400 (no SDK call)',
    async () => {
      // Use a model the capability gate refuses for tool use. Titan
      // Text isn't always available in every region's account, but
      // the gate is purely string-based — it won't reach Bedrock at
      // all, so a missing model-access permission is irrelevant.
      const titanModel = makeModel('aws-bedrock', 'amazon.titan-text-large-v1');
      let captured: CompletionError | undefined;
      try {
        await provider.openAICompletion(
          {
            model: 'amazon.titan-text-large-v1',
            messages: [{ role: 'user', content: 'What time is it in Tokyo?' }],
            tools: [
              {
                type: 'function',
                function: {
                  name: 'get_time',
                  description: 'get time',
                  parameters: {
                    type: 'object',
                    properties: { location: { type: 'string' } },
                    required: ['location'],
                  },
                },
              },
            ],
            max_tokens: 16,
          },
          connection,
          titanModel
        );
      } catch (err) {
        captured = err as CompletionError;
      }
      expect(captured, 'gateway should reject titan + tools').toBeDefined();
      expect(captured).toBeInstanceOf(CompletionError);
      expect(captured?.data.statusCode).toBe(400);
      expect(captured?.data.openAICompatibleError?.code).toBe(
        'bedrock_model_does_not_support_tools'
      );
    },
    TIMEOUT
  );
});
