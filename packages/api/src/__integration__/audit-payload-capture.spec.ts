import { describe, expect, it } from 'vitest';
import { CompletionError } from '../gateway/completion.types';
import { hasKeys, requiredEnv } from './helpers/env';
import {
  buildBedrockInvokeProvider,
  buildBedrockProvider,
  buildOpenAIProvider,
  makeConnection,
  makeModel,
} from './helpers/factories';
import {
  expectNonStreaming,
  expectStreaming,
  collectStream,
} from './helpers/assertions';
import { simplePrompt } from './helpers/scenarios';

// ────────────────────────────────────────────────────────────────────────
// Phase 11 audit observability: provider classes must capture the body
// the SDK saw on the wire (`providerRequestPayload`) and surface it on
// BOTH success and error paths so the audit row can render it for ops
// without a re-run.
//
// Error-path specs use deliberately invalid credentials (the upstream
// 401s before any model work is billed). Success-path specs gate on
// `hasKeys(...)` per-provider so they only run when that provider's
// env var is present. The whole file lives in the `live` vitest
// project, so it's only loaded under `nx run api:test:live`.
// ────────────────────────────────────────────────────────────────────────

const TIMEOUT = 30_000;

const expectProviderPayloadCarriesRequest = (
  payload: unknown,
  expected: { model: string; firstUserContent: string }
) => {
  expect(payload, 'providerRequestPayload missing').toBeTruthy();
  const obj = payload as Record<string, unknown>;
  expect(obj.model, 'providerRequestPayload.model').toBe(expected.model);
  // The user's first message survives any internal conversion the
  // provider does — checking it gives us a high-signal smoke test that
  // the captured body is the one the SDK actually saw.
  const serialised = JSON.stringify(obj);
  expect(serialised).toContain(expected.firstUserContent);
};

describe('Phase 11 audit: providerRequestPayload capture', () => {
  describe('OpenAI provider', () => {
    const provider = buildOpenAIProvider();
    const liveModel = process.env.OPENAI_TEST_MODEL ?? 'gpt-4o-mini';

    it(
      'captures providerRequestPayload on the error path with bad credentials',
      async () => {
        const connection = makeConnection('openai', {
          apiKey: 'sk-invalid-key-for-401',
        });
        const model = makeModel('openai', liveModel);

        let captured: CompletionError | undefined;
        try {
          await provider.openAICompletion(
            { ...simplePrompt },
            connection,
            model
          );
        } catch (err) {
          captured = err as CompletionError;
        }
        expect(captured, 'expected provider call to throw').toBeTruthy();
        expect(captured).toBeInstanceOf(CompletionError);
        expectProviderPayloadCarriesRequest(
          captured!.data.providerRequestPayload,
          { model: liveModel, firstUserContent: 'pong' }
        );
      },
      TIMEOUT
    );

    it.skipIf(!hasKeys('OPENAI_API_KEY'))(
      'captures providerRequestPayload on the success path (non-streaming)',
      async () => {
        const connection = makeConnection('openai', {
          apiKey: requiredEnv('OPENAI_API_KEY'),
        });
        const model = makeModel('openai', liveModel);
        const response = await provider.openAICompletion(
          { ...simplePrompt },
          connection,
          model
        );
        await expectNonStreaming(response);
        expectProviderPayloadCarriesRequest(response.providerRequestPayload, {
          model: liveModel,
          firstUserContent: 'pong',
        });
      },
      TIMEOUT
    );

    it.skipIf(!hasKeys('OPENAI_API_KEY'))(
      'captures providerRequestPayload on the success path (streaming)',
      async () => {
        const connection = makeConnection('openai', {
          apiKey: requiredEnv('OPENAI_API_KEY'),
        });
        const model = makeModel('openai', liveModel);
        const response = await provider.openAICompletion(
          { ...simplePrompt, stream: true },
          connection,
          model
        );
        const stream = await expectStreaming(response);
        // Drain so the underlying request actually completes — even
        // though providerRequestPayload is captured pre-flight, draining
        // catches accidental regressions where the field is set on the
        // stream wrapper but cleared after iteration.
        await collectStream(stream);
        expectProviderPayloadCarriesRequest(response.providerRequestPayload, {
          model: liveModel,
          firstUserContent: 'pong',
        });
        // Streaming must include `stream_options.include_usage` so the
        // gateway can record usage — verify it landed on the captured
        // payload, since that's exactly the kind of mutation that
        // historically lived only in logs.
        const obj = response.providerRequestPayload as Record<string, unknown>;
        expect(obj.stream).toBe(true);
        expect(obj.stream_options).toEqual({ include_usage: true });
      },
      TIMEOUT
    );

    it(
      'captures providerRequestPayload on the streaming error path',
      async () => {
        // Bad-key streaming request — the OpenAI SDK throws on
        // `.create({stream:true})` *before* yielding any chunks
        // because the 401 surfaces synchronously. The error path
        // must still attach `providerRequestPayload`. This is the
        // same invariant the non-streaming error path holds; covers
        // the regression that was uncovered for the Bedrock providers
        // (where mid-stream errors used to throw without the body).
        const connection = makeConnection('openai', {
          apiKey: 'sk-invalid-key-for-streaming-401',
        });
        const model = makeModel('openai', liveModel);

        let captured: CompletionError | undefined;
        try {
          const response = await provider.openAICompletion(
            { ...simplePrompt, stream: true },
            connection,
            model
          );
          const stream = await expectStreaming(response);
          await collectStream(stream);
        } catch (err) {
          captured = err as CompletionError;
        }
        expect(captured, 'expected streaming call to throw').toBeTruthy();
        expect(captured).toBeInstanceOf(CompletionError);
        expectProviderPayloadCarriesRequest(
          captured!.data.providerRequestPayload,
          { model: liveModel, firstUserContent: 'pong' }
        );
        // The captured payload should still carry the streaming
        // mutations the provider applied pre-flight.
        const obj = captured!.data.providerRequestPayload as Record<
          string,
          unknown
        >;
        expect(obj.stream).toBe(true);
        expect(obj.stream_options).toEqual({ include_usage: true });
      },
      TIMEOUT
    );
  });

  describe('AWS Bedrock-Converse provider', () => {
    const provider = buildBedrockProvider();
    const liveModel =
      process.env.BEDROCK_TEST_MODEL ??
      'us.anthropic.claude-haiku-4-5-20251001-v1:0';

    it(
      'captures providerRequestPayload on the error path with bad credentials',
      async () => {
        // Force a credential-error by handing the provider an obviously
        // invalid role ARN. The provider builds the ConverseCommandInput
        // *before* the AWS SDK call, so even though STS errors out, the
        // catch path attaches `requestBody` to the CompletionError.
        const connection = makeConnection('aws-bedrock', {
          region: 'us-east-1',
          iamRoleArn: 'arn:aws:iam::000000000000:role/does-not-exist',
        });
        const model = makeModel('aws-bedrock', liveModel);
        let captured: CompletionError | undefined;
        try {
          await provider.openAICompletion(
            { ...simplePrompt },
            connection,
            model
          );
        } catch (err) {
          captured = err as CompletionError;
        }
        expect(captured, 'expected provider call to throw').toBeTruthy();
        expect(captured).toBeInstanceOf(CompletionError);
        // AWS-Converse-shape: `modelId` (not `model`); user content
        // lands inside the `messages[].content[].text` block.
        const payload = captured!.data.providerRequestPayload as
          | Record<string, unknown>
          | undefined;
        expect(payload, 'providerRequestPayload missing').toBeTruthy();
        expect(payload!.modelId).toBe(liveModel);
        expect(JSON.stringify(payload)).toContain('pong');
      },
      TIMEOUT
    );

    it.skipIf(!hasKeys('AWS_BEDROCK_ROLE_ARN', 'AWS_REGION'))(
      'captures providerRequestPayload on the success path',
      async () => {
        const connection = makeConnection('aws-bedrock', {
          region: requiredEnv('AWS_REGION'),
          iamRoleArn: requiredEnv('AWS_BEDROCK_ROLE_ARN'),
        });
        const model = makeModel('aws-bedrock', liveModel);
        const response = await provider.openAICompletion(
          { ...simplePrompt },
          connection,
          model
        );
        await expectNonStreaming(response);
        const payload = response.providerRequestPayload as
          | Record<string, unknown>
          | undefined;
        expect(payload, 'providerRequestPayload missing').toBeTruthy();
        expect(payload!.modelId).toBe(liveModel);
        expect(JSON.stringify(payload)).toContain('pong');
      },
      TIMEOUT
    );
  });

  describe('AWS Bedrock-Invoke provider', () => {
    const provider = buildBedrockInvokeProvider();
    const liveModel =
      process.env.BEDROCK_INVOKE_TEST_MODEL ??
      'us.anthropic.claude-haiku-4-5-20251001-v1:0';

    // The Bedrock-Invoke provider captures the Anthropic-Messages body
    // (the JSON body the InvokeModelCommand wraps), not the surrounding
    // command shape. So we assert on Anthropic-shape keys
    // (anthropic_version, messages) rather than `modelId`.
    const expectAnthropicShape = (payload: unknown) => {
      expect(payload, 'providerRequestPayload missing').toBeTruthy();
      const obj = payload as Record<string, unknown>;
      expect(obj.anthropic_version, 'anthropic_version').toBeTruthy();
      expect(Array.isArray(obj.messages), 'messages array').toBe(true);
      expect(JSON.stringify(payload)).toContain('pong');
    };

    it(
      'captures providerRequestPayload on the error path with bad credentials',
      async () => {
        const connection = makeConnection('aws-bedrock-invoke', {
          region: 'us-east-1',
          iamRoleArn: 'arn:aws:iam::000000000000:role/does-not-exist',
        });
        const model = makeModel('aws-bedrock-invoke', liveModel);
        let captured: CompletionError | undefined;
        try {
          await provider.openAICompletion(
            { ...simplePrompt },
            connection,
            model
          );
        } catch (err) {
          captured = err as CompletionError;
        }
        expect(captured, 'expected provider call to throw').toBeTruthy();
        expect(captured).toBeInstanceOf(CompletionError);
        expectAnthropicShape(captured!.data.providerRequestPayload);
      },
      TIMEOUT
    );

    it.skipIf(!hasKeys('AWS_BEDROCK_ROLE_ARN', 'AWS_REGION'))(
      'captures providerRequestPayload on the success path',
      async () => {
        const connection = makeConnection('aws-bedrock-invoke', {
          region: requiredEnv('AWS_REGION'),
          iamRoleArn: requiredEnv('AWS_BEDROCK_ROLE_ARN'),
        });
        const model = makeModel('aws-bedrock-invoke', liveModel);
        const response = await provider.openAICompletion(
          { ...simplePrompt },
          connection,
          model
        );
        await expectNonStreaming(response);
        expectAnthropicShape(response.providerRequestPayload);
      },
      TIMEOUT
    );

    it(
      'complete({format:"anthropic"}) passes the Anthropic body through verbatim (input-side passthrough)',
      async () => {
        // Bad credentials so the Bedrock SDK rejects before any
        // model work happens — the test focuses on the path the
        // request takes, not the response.
        const connection = makeConnection('aws-bedrock-invoke', {
          region: 'us-east-1',
          iamRoleArn: 'arn:aws:iam::000000000000:role/does-not-exist',
        });
        const model = makeModel('aws-bedrock-invoke', liveModel);

        const anthropicBody = {
          model: liveModel,
          max_tokens: 16,
          messages: [
            { role: 'user' as const, content: 'Reply with exactly: pong' },
          ],
          temperature: 0,
          stop_sequences: ['END'],
        };

        let captured: CompletionError | undefined;
        try {
          await provider.anthropicMessages(
            anthropicBody as never,
            connection,
            model
          );
        } catch (err) {
          captured = err as CompletionError;
        }
        expect(captured, 'expected provider call to throw').toBeTruthy();
        expect(captured).toBeInstanceOf(CompletionError);

        const payload = captured!.data.providerRequestPayload as
          | Record<string, unknown>
          | undefined;
        expect(payload, 'providerRequestPayload missing').toBeTruthy();

        // Hard assertion: input-side passthrough means the captured
        // wire body keeps Anthropic-specific fields the OpenAI pivot
        // would have collapsed (stop_sequences vs OpenAI's `stop`,
        // anthropic_version stamped at the wire boundary, no
        // `model`/`stream` since those go via InvokeModel command).
        expect(payload!.anthropic_version).toBeTruthy();
        expect(payload!.max_tokens).toBe(16);
        expect(payload!.temperature).toBe(0);
        expect(payload!.stop_sequences).toEqual(['END']);
        expect(
          payload!.model,
          'model goes via modelId, not body'
        ).toBeUndefined();
        expect(JSON.stringify(payload)).toContain('pong');
      },
      TIMEOUT
    );
  });
});
