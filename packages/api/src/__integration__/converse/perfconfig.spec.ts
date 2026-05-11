import { describe, expect, it, beforeEach, vi } from 'vitest';
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
 * T22: Resp→Converse and Anth→Converse paths used to drop the
 * connection-level `performanceConfig.latency` setting; only the
 * Chat→Converse path was applying it. The fix patches the Converse
 * command input in both providers' `handle()` so the latency
 * override actually reaches Bedrock.
 */

describe('Resp/Anth→Converse performanceConfig (T22)', () => {
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

  function makeConnection() {
    return {
      connectionId: 'c',
      config: {
        performanceConfig: { latency: 'optimized' as const },
      } as AWSBedrockAIConnectionConfig,
    } as AIConnectionEntity<AWSBedrockAIConnectionConfig>;
  }

  function makeModel(): AIResourceModelConfigEntity {
    return {
      model: 'us.anthropic.claude-haiku-4-5',
    } as AIResourceModelConfigEntity;
  }

  it('Resp→Converse propagates connection.performanceConfig.latency', async () => {
    dispatchSpy.mockClear();
    await respProvider.handle(
      { model: 'x', input: 'hi' } as never,
      makeConnection(),
      makeModel()
    );
    const input = dispatchSpy.mock.calls[0][0] as ConverseCommandInput;
    expect(input.performanceConfig).toEqual({ latency: 'optimized' });
  });

  it('Anth→Converse propagates connection.performanceConfig.latency', async () => {
    dispatchSpy.mockClear();
    await anthProvider.handle(
      {
        model: 'x',
        max_tokens: 64,
        messages: [{ role: 'user', content: 'hi' }],
      } as never,
      makeConnection(),
      makeModel()
    );
    const input = dispatchSpy.mock.calls[0][0] as ConverseCommandInput;
    expect(input.performanceConfig).toEqual({ latency: 'optimized' });
  });

  it('omits performanceConfig when the connection has none set', async () => {
    dispatchSpy.mockClear();
    await respProvider.handle(
      { model: 'x', input: 'hi' } as never,
      {
        connectionId: 'c',
        config: {} as AWSBedrockAIConnectionConfig,
      } as AIConnectionEntity<AWSBedrockAIConnectionConfig>,
      makeModel()
    );
    const input = dispatchSpy.mock.calls[0][0] as ConverseCommandInput;
    expect(input.performanceConfig).toBeUndefined();
  });
});
