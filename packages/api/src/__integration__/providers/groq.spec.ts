import { describe, it } from 'vitest';
import { hasKeys, requiredEnv } from '../helpers/env';
import {
  buildGroqProvider,
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

const SHOULD_RUN = hasKeys('GROQ_API_KEY');
const TEST_MODEL = process.env.GROQ_TEST_MODEL ?? 'llama-3.3-70b-versatile';
const TIMEOUT = 60_000;

describe.skipIf(!SHOULD_RUN)('Groq provider (live)', () => {
  const provider = buildGroqProvider();
  const connection = makeConnection('groq', {
    apiKey: SHOULD_RUN ? requiredEnv('GROQ_API_KEY') : '',
  });
  const model = makeModel('groq', TEST_MODEL);

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
});
