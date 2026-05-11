import { describe, expect, it, vi, beforeEach } from 'vitest';
import { type AWSBedrockAIConnectionConfig } from '../../ai-provider/aws-bedrock-converse/shared';
import { AWSBedrockConverseOpenAIResponseProvider } from '../../ai-provider/aws-bedrock-converse/openai-response.provider';
import { AWSBedrockConverseAnthropicMessagesProvider } from '../../ai-provider/aws-bedrock-converse/anthropic-messages.provider';
import type { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import type { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import type {
  ConverseCommandInput,
  ConverseCommandOutput,
} from '@aws-sdk/client-bedrock-runtime';

/**
 * T21: Bedrock Guardrails configured on the connection now flow
 * onto every Converse / Invoke call. This spec pins the Converse
 * paths (Resp + Anth direct adapters) — Invoke side is verified
 * via the SDK contract since the InvokeModel command takes
 * `guardrailIdentifier` / `guardrailVersion` directly.
 */

describe('Bedrock-Converse guardrails wiring (T21)', () => {
  let respProvider: AWSBedrockConverseOpenAIResponseProvider;
  let anthProvider: AWSBedrockConverseAnthropicMessagesProvider;
  let dispatchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dispatchSpy = vi.fn(async () => ({
      data: {
        $metadata: { requestId: 'req-1' },
        output: { message: { role: 'assistant', content: [{ text: 'ok' }] } },
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      } as unknown as ConverseCommandOutput,
      headers: {},
      providerRequestPayload: {} as ConverseCommandInput,
    }));
    const dispatcher = {
      dispatchConverseRaw: dispatchSpy,
    } as unknown as ConstructorParameters<
      typeof AWSBedrockConverseOpenAIResponseProvider
    >[0];
    respProvider = new AWSBedrockConverseOpenAIResponseProvider(dispatcher);
    anthProvider = new AWSBedrockConverseAnthropicMessagesProvider(dispatcher);
  });

  function makeConnection(
    guardrailConfig?: AWSBedrockAIConnectionConfig['guardrailConfig']
  ) {
    return {
      connectionId: 'c',
      config: { guardrailConfig } as AWSBedrockAIConnectionConfig,
    } as AIConnectionEntity<AWSBedrockAIConnectionConfig>;
  }

  function makeModel(): AIResourceModelConfigEntity {
    return {
      model: 'us.anthropic.claude-haiku-4-5',
    } as AIResourceModelConfigEntity;
  }

  it('Resp→Converse forwards guardrailConfig with default trace=enabled', async () => {
    await respProvider.handle(
      { model: 'x', input: 'hi' } as never,
      makeConnection({
        guardrailIdentifier: 'gr-1',
        guardrailVersion: 'DRAFT',
      }),
      makeModel()
    );
    const input = dispatchSpy.mock.calls[0][0] as ConverseCommandInput;
    expect(input.guardrailConfig).toEqual({
      guardrailIdentifier: 'gr-1',
      guardrailVersion: 'DRAFT',
      trace: 'enabled',
    });
  });

  it('Anth→Converse forwards guardrailConfig with explicit trace setting', async () => {
    await anthProvider.handle(
      {
        model: 'x',
        max_tokens: 64,
        messages: [{ role: 'user', content: 'hi' }],
      } as never,
      makeConnection({
        guardrailIdentifier: 'gr-2',
        guardrailVersion: '1',
        trace: 'enabled_full',
      }),
      makeModel()
    );
    const input = dispatchSpy.mock.calls[0][0] as ConverseCommandInput;
    expect(input.guardrailConfig).toEqual({
      guardrailIdentifier: 'gr-2',
      guardrailVersion: '1',
      trace: 'enabled_full',
    });
  });

  it('omits guardrailConfig when the connection has none set', async () => {
    await respProvider.handle(
      { model: 'x', input: 'hi' } as never,
      makeConnection(undefined),
      makeModel()
    );
    const input = dispatchSpy.mock.calls[0][0] as ConverseCommandInput;
    expect(input.guardrailConfig).toBeUndefined();
  });
});
