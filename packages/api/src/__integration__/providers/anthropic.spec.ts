import { describe, expect, it } from 'vitest';
import { hasKeys, requiredEnv } from '../helpers/env';
import {
  buildAnthropicProvider,
  makeConnection,
  makeModel,
} from '../helpers/factories';
import {
  simplePrompt,
  structuredOutputPrompt,
  toolCallPrompt,
  toolFollowupPrompt,
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

const SHOULD_RUN = hasKeys('ANTHROPIC_API_KEY');
const TEST_MODEL = process.env.ANTHROPIC_TEST_MODEL ?? 'claude-haiku-4-5';
const TIMEOUT = 60_000;

describe.skipIf(!SHOULD_RUN)('Anthropic provider (live)', () => {
  const provider = buildAnthropicProvider();
  const connection = makeConnection('anthropic', {
    apiKey: SHOULD_RUN ? requiredEnv('ANTHROPIC_API_KEY') : '',
  });
  const model = makeModel('anthropic', TEST_MODEL);

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
        toolFollowupPrompt('toolu_anthropic_1'),
        connection,
        model
      );
      const data = await expectNonStreaming(response);
      const content = data.choices[0].message.content ?? '';
      assertNonEmptyText(content);
      expect(content).toMatch(/15/);
    },
    TIMEOUT
  );

  it(
    'structured output (json_schema)',
    async () => {
      // Anthropic's OpenAI-compat endpoint accepts response_format. If
      // this ever stops working, structured-output flows against Claude
      // will silently fall back to free-form text.
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
});
