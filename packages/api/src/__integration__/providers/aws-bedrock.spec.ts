import { describe, it } from 'vitest';
import { hasKeys, requiredEnv } from '../helpers/env';
import {
  buildBedrockProvider,
  makeConnection,
  makeModel,
} from '../helpers/factories';
import { simplePrompt, toolCallPrompt } from '../helpers/scenarios';
import {
  assertNonEmptyText,
  assertToolCall,
  assertUsageNonZero,
  collectStream,
  expectNonStreaming,
  expectStreaming,
} from '../helpers/assertions';

const SHOULD_RUN = hasKeys('AWS_BEDROCK_ROLE_ARN', 'AWS_REGION');
const TEST_MODEL =
  process.env.BEDROCK_TEST_MODEL ??
  'us.anthropic.claude-haiku-4-5-20251001-v1:0';
const TIMEOUT = 60_000;

describe.skipIf(!SHOULD_RUN)('AWS Bedrock Converse provider (live)', () => {
  const provider = buildBedrockProvider();
  const connection = makeConnection('aws-bedrock', {
    iamRoleArn: SHOULD_RUN ? requiredEnv('AWS_BEDROCK_ROLE_ARN') : '',
    region: SHOULD_RUN ? requiredEnv('AWS_REGION') : 'us-east-1',
  });
  const model = makeModel('aws-bedrock', TEST_MODEL);

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
});
