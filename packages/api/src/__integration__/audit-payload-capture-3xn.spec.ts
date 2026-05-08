import { describe, expect, it } from 'vitest';
import { CompletionError } from '../gateway/completion.types';
import {
  buildAnthropicProvider,
  buildBedrockInvokeProvider,
  buildBedrockProvider,
  buildGeminiProvider,
  buildGroqProvider,
  buildOpenAIProvider,
  buildPerplexityProvider,
  makeConnection,
  makeModel,
} from './helpers/factories';

/**
 * 3×N audit invariant matrix: every provider × every input format
 * captures `providerRequestPayload` on the error path, even when the
 * upstream rejects pre-flight. Pure error-path tests — invalid
 * credentials guarantee the SDK call errors out before any model
 * usage, so this spec doesn't need real keys.
 *
 * Lives in the `live` vitest project because the SDK still issues a
 * real HTTP request to each provider's endpoint; the 401 just keeps
 * the request from being billed. Run via `nx run api:test:live`.
 *
 * The success-path coverage lives in `audit-payload-capture.spec.ts`
 * — gated per-provider on `hasKeys(...)` so it only runs the cells
 * whose env vars are set. The complement here makes the audit
 * invariant a 3×N grid:
 *
 *   ┌────────────────┬─────────────────┬───────────────┬──────────────────┐
 *   │ provider       │ openAICompletion│ openAIResponse│ anthropicMessages│
 *   ├────────────────┼─────────────────┼───────────────┼──────────────────┤
 *   │ openai         │ this spec       │ this spec     │ this spec        │
 *   │ anthropic      │ this spec       │ this spec     │ this spec        │
 *   │ gemini         │ this spec       │ this spec     │ this spec        │
 *   │ groq           │ this spec       │ this spec     │ this spec        │
 *   │ perplexity     │ this spec       │ this spec     │ this spec        │
 *   │ aws-bedrock    │ this spec       │ this spec     │ this spec        │
 *   │ aws-bedrock-…  │ this spec       │ this spec     │ this spec        │
 *   └────────────────┴─────────────────┴───────────────┴──────────────────┘
 *
 * Each cell verifies: error thrown → CompletionError → providerRequestPayload
 * present → contains the user's prompt verbatim (sanity check that the
 * captured body is the one the SDK was about to send).
 */

const TIMEOUT = 30_000;

const PROMPT = 'Reply with exactly: pong';

type ProviderCellSpec = {
  name: string;
  build: () => {
    openAICompletion: (
      req: never,
      conn: never,
      model: never
    ) => Promise<unknown>;
    openAIResponse: (req: never, conn: never, model: never) => Promise<unknown>;
    anthropicMessages: (
      req: never,
      conn: never,
      model: never
    ) => Promise<unknown>;
  };
  /** Connection with credentials that will provoke an error pre-flight. */
  badConnection: () => unknown;
  /** Model name to use for the request. */
  model: string;
  /** Provider id passed to `makeModel`. */
  modelKind: Parameters<typeof makeModel>[0];
};

const openaiCell: ProviderCellSpec = {
  name: 'openai',
  build: () => buildOpenAIProvider() as never,
  badConnection: () => makeConnection('openai', { apiKey: 'sk-invalid-401' }),
  model: 'gpt-4o-mini',
  modelKind: 'openai',
};

const anthropicCell: ProviderCellSpec = {
  name: 'anthropic',
  build: () => buildAnthropicProvider() as never,
  badConnection: () =>
    makeConnection('anthropic', { apiKey: 'sk-ant-invalid-401' }),
  model: 'claude-haiku-4-5',
  modelKind: 'anthropic',
};

const geminiCell: ProviderCellSpec = {
  name: 'gemini',
  build: () => buildGeminiProvider() as never,
  badConnection: () => makeConnection('gemini', { apiKey: 'invalid-key-401' }),
  model: 'gemini-2.5-flash-lite',
  modelKind: 'gemini',
};

const groqCell: ProviderCellSpec = {
  name: 'groq',
  build: () => buildGroqProvider() as never,
  badConnection: () =>
    makeConnection('groq', { apiKey: 'gsk_invalid-key-401' }),
  model: 'llama-3.3-70b-versatile',
  modelKind: 'groq',
};

const perplexityCell: ProviderCellSpec = {
  name: 'perplexity',
  build: () => buildPerplexityProvider() as never,
  badConnection: () =>
    makeConnection('perplexity', { apiKey: 'pplx-invalid-key-401' }),
  model: 'sonar',
  modelKind: 'perplexity',
};

const bedrockConverseCell: ProviderCellSpec = {
  name: 'aws-bedrock (converse)',
  build: () => buildBedrockProvider() as never,
  badConnection: () =>
    makeConnection('aws-bedrock', {
      region: 'us-east-1',
      iamRoleArn: 'arn:aws:iam::000000000000:role/nonexistent',
    }),
  model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  modelKind: 'aws-bedrock',
};

const bedrockInvokeCell: ProviderCellSpec = {
  name: 'aws-bedrock-invoke',
  build: () => buildBedrockInvokeProvider() as never,
  badConnection: () =>
    makeConnection('aws-bedrock-invoke', {
      region: 'us-east-1',
      iamRoleArn: 'arn:aws:iam::000000000000:role/nonexistent',
    }),
  model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  modelKind: 'aws-bedrock-invoke',
};

const cells: ProviderCellSpec[] = [
  openaiCell,
  anthropicCell,
  geminiCell,
  groqCell,
  perplexityCell,
  bedrockConverseCell,
  bedrockInvokeCell,
];

/**
 * Assert that `providerRequestPayload` exists on the captured error
 * and that its serialised form contains the user's prompt verbatim —
 * proves the captured wire body is the one the SDK was about to send,
 * not a default placeholder.
 */
function expectPayloadHasPrompt(payload: unknown, prompt: string): void {
  expect(payload, 'providerRequestPayload missing').toBeTruthy();
  const serialised = JSON.stringify(payload);
  expect(serialised).toContain(prompt);
}

describe.each(cells)('Audit 3×N: $name', (cell) => {
  const provider = cell.build();
  const model = makeModel(cell.modelKind, cell.model);

  it(
    'openAICompletion error path captures providerRequestPayload',
    async () => {
      const connection = cell.badConnection() as never;
      let captured: CompletionError | undefined;
      try {
        await provider.openAICompletion(
          {
            model: cell.model,
            messages: [{ role: 'user', content: PROMPT }],
            max_tokens: 16,
            temperature: 0,
          } as never,
          connection,
          model as never
        );
      } catch (err) {
        captured = err as CompletionError;
      }
      expect(captured, 'expected provider call to throw').toBeTruthy();
      expect(captured).toBeInstanceOf(CompletionError);
      expectPayloadHasPrompt(captured!.data.providerRequestPayload, PROMPT);
    },
    TIMEOUT
  );

  it(
    'openAIResponse error path captures providerRequestPayload',
    async () => {
      const connection = cell.badConnection() as never;
      let captured: CompletionError | undefined;
      try {
        await provider.openAIResponse(
          {
            model: cell.model,
            input: PROMPT,
            max_output_tokens: 16,
          } as never,
          connection,
          model as never
        );
      } catch (err) {
        captured = err as CompletionError;
      }
      expect(captured, 'expected provider call to throw').toBeTruthy();
      expect(captured).toBeInstanceOf(CompletionError);
      expectPayloadHasPrompt(captured!.data.providerRequestPayload, PROMPT);
    },
    TIMEOUT
  );

  it(
    'anthropicMessages error path captures providerRequestPayload',
    async () => {
      const connection = cell.badConnection() as never;
      let captured: CompletionError | undefined;
      try {
        await provider.anthropicMessages(
          {
            model: cell.model,
            max_tokens: 16,
            messages: [{ role: 'user', content: PROMPT }],
          } as never,
          connection,
          model as never
        );
      } catch (err) {
        captured = err as CompletionError;
      }
      expect(captured, 'expected provider call to throw').toBeTruthy();
      expect(captured).toBeInstanceOf(CompletionError);
      expectPayloadHasPrompt(captured!.data.providerRequestPayload, PROMPT);
    },
    TIMEOUT
  );
});
