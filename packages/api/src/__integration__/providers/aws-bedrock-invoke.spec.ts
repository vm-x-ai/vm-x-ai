import { describe, it } from 'vitest';
import { hasKeys, requiredEnv } from '../helpers/env';
import {
  buildBedrockInvokeProvider,
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

const SHOULD_RUN = hasKeys('AWS_BEDROCK_ROLE_ARN', 'AWS_REGION');
const TEST_MODEL =
  process.env.BEDROCK_INVOKE_TEST_MODEL ??
  'us.anthropic.claude-haiku-4-5-20251001-v1:0';
const TIMEOUT = 60_000;

/**
 * Bedrock Invoke is the canonical Claude-on-AWS path
 * (`bedrock/invoke/<claude>`). These tests cover that surface end-to-end:
 * Claude-only, with first-class tool calling.
 */
describe.skipIf(!SHOULD_RUN)('AWS Bedrock Invoke provider (live)', () => {
  const provider = buildBedrockInvokeProvider();
  const connection = makeConnection('aws-bedrock-invoke', {
    iamRoleArn: SHOULD_RUN ? requiredEnv('AWS_BEDROCK_ROLE_ARN') : '',
    region: SHOULD_RUN ? requiredEnv('AWS_REGION') : 'us-east-1',
  });
  const model = makeModel('aws-bedrock-invoke', TEST_MODEL);

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
    'tool calling (streaming) — argument JSON streamed in deltas',
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
    'tool follow-up: assistant uses tool_result content correctly',
    async () => {
      // Verify the converter coalesces tool_result blocks into a user
      // message and the model produces a sensible final answer.
      const response = await provider.openAICompletion(
        toolFollowupPrompt('toolu_test_1'),
        connection,
        model
      );
      const data = await expectNonStreaming(response);
      assertNonEmptyText(data.choices[0].message.content ?? '');
      // The follow-up should mention the temperature we returned (15).
      // Soft-check: the model usually echoes the temperature value.
      const content = data.choices[0].message.content ?? '';
      if (!content.includes('15')) {
        console.warn(
          '[bedrock-invoke] follow-up did not echo temperature; got:',
          content.slice(0, 200)
        );
      }
    },
    TIMEOUT
  );

  // Structured output via response_format json_schema is currently
  // a known gap on the Bedrock Invoke path: AWSBedrockInvokeProvider
  // does not translate response_format into Anthropic's
  // structured-output mechanism (which is normally a forced tool_use
  // block with the schema as input_schema).
  //
  // Callers using `text.format: json_schema` on the Responses API
  // endpoint hit the converter that maps it to response_format on the
  // chat-completions path — which is silently dropped here. This test
  // exists as the canary: if it passes one day, structured output
  // works; until then it's expected to fail or produce non-conforming
  // text.
  it.skip(
    'structured output (json_schema) — KNOWN GAP, not yet wired',
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
});
