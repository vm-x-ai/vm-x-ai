import { describe, expect, it, vi } from 'vitest';
import { AWSBedrockInvokeAnthropicMessagesProvider } from '../../ai-provider/aws-bedrock-invoke/anthropic-messages.provider';
import { CompletionError } from '../../gateway/completion.types';
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';
import type { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import type { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import type { AWSBedrockAIConnectionConfig } from '../../ai-provider/aws-bedrock-base';

/**
 * T23: Bedrock-Invoke's Anthropic API rejects external image URLs.
 * The OpenAI→Anthropic adapter has `rejectExternalImageUrls: true`,
 * but the direct Anthropic-input path used to forward `{type:'url'}`
 * to Bedrock and get an opaque upstream 400. The provider now
 * pre-validates and throws a clean gateway-side error.
 */

describe('Anthropic→Bedrock-Invoke external URL pre-validation (T23)', () => {
  const dispatcher = {
    dispatchNative: vi.fn(async () => ({} as never)),
  } as unknown as ConstructorParameters<
    typeof AWSBedrockInvokeAnthropicMessagesProvider
  >[0];
  const provider = new AWSBedrockInvokeAnthropicMessagesProvider(dispatcher);
  const connection = {
    connectionId: 'c',
    config: {} as AWSBedrockAIConnectionConfig,
  } as AIConnectionEntity<AWSBedrockAIConnectionConfig>;
  const model = {
    model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  } as AIResourceModelConfigEntity;

  it('throws CompletionError 400 when an image block carries a url source', async () => {
    const request = {
      model: 'claude-haiku-4-5',
      max_tokens: 64,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'url', url: 'https://example.com/img.png' },
            },
            { type: 'text', text: 'describe this' },
          ],
        },
      ],
    } as unknown as AnthropicMessagesRequest;
    await expect(
      provider.handle(request, connection, model)
    ).rejects.toThrowError(CompletionError);
  });

  it('error has 400 statusCode and the bedrock-invoke-specific code', async () => {
    const request = {
      model: 'claude-haiku-4-5',
      max_tokens: 64,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'url', url: 'https://example.com/x.jpg' },
            },
          ],
        },
      ],
    } as unknown as AnthropicMessagesRequest;
    await provider.handle(request, connection, model).catch((err: unknown) => {
      expect(err).toBeInstanceOf(CompletionError);
      const ce = err as CompletionError;
      expect(ce.data.statusCode).toBe(400);
      expect(ce.data.openAICompatibleError?.code).toBe(
        'aws_bedrock_invoke_image_url_unsupported'
      );
    });
  });

  it('passes base64 image sources through without throwing', async () => {
    const request = {
      model: 'claude-haiku-4-5',
      max_tokens: 64,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: 'AAAA',
              },
            },
          ],
        },
      ],
    } as unknown as AnthropicMessagesRequest;
    // Doesn't throw the URL pre-validation error; dispatcher mock
    // returns an empty object so we don't care about the rest.
    await provider.handle(request, connection, model);
    expect(
      (dispatcher as unknown as { dispatchNative: ReturnType<typeof vi.fn> })
        .dispatchNative
    ).toHaveBeenCalled();
  });
});
