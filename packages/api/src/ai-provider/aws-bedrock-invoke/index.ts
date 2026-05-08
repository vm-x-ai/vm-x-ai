import { Injectable } from '@nestjs/common';
import type { ChatCompletionCreateParams } from 'openai/resources/index.js';
import type { ResponseCreateParams } from 'openai/resources/responses/responses.js';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import {
  AnthropicMessagesResponse,
  CompletionProvider,
  CompletionRequestOptions,
  OpenAICompletionResponse,
  OpenAIResponseResponse,
} from '../ai-provider.types';
import { AIProviderDto } from '../dto/ai-provider.dto';
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';
import type { AWSBedrockAIConnectionConfig } from '../aws-bedrock-base';
import { AWSBedrockInvokeOpenAICompletionProvider } from './openai-chat-completion.provider';
import { AWSBedrockInvokeOpenAIResponseProvider } from './openai-response.provider';
import { AWSBedrockInvokeAnthropicMessagesProvider } from './anthropic-messages.provider';

/**
 * `AWSBedrockInvokeProvider` — composer implementing the 3-method
 * `CompletionProvider` interface. Bedrock Invoke speaks Anthropic
 * Messages on the wire (with the `anthropic_version` discriminator),
 * so the OpenAI Chat Completions and Responses inputs both convert
 * via the OpenAI↔Anthropic adapter before reaching the wire; the
 * Anthropic Messages input is native passthrough.
 */
@Injectable()
export class AWSBedrockInvokeProvider implements CompletionProvider {
  provider: AIProviderDto;

  constructor(
    private readonly chatCompletionProvider: AWSBedrockInvokeOpenAICompletionProvider,
    private readonly responseProvider: AWSBedrockInvokeOpenAIResponseProvider,
    private readonly anthropicMessagesProvider: AWSBedrockInvokeAnthropicMessagesProvider
  ) {
    this.provider = {
      id: 'aws-bedrock-invoke',
      name: 'AWS Bedrock (Invoke)',
      description:
        'AWS Bedrock InvokeModel API for Anthropic Claude models. Use this when you need full Anthropic Messages API features (e.g. richer tool calling) instead of the Converse API.',
      defaultModel: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      config: {
        logo: { url: '/assets/logos/aws.jpeg' },
        connection: {
          form: {
            type: 'object',
            title: 'AWS Credentials',
            required: ['region', 'iamRoleArn'],
            properties: {
              region: {
                order: 1,
                format: 'aws-region',
                minLength: 1,
                title: 'AWS Region',
                type: 'string',
              },
              iamRoleArn: {
                order: 2,
                description:
                  'e.g. "arn:aws:iam::123456789012:role/bedrock-role"',
                format: 'aws-arn',
                minLength: 1,
                title: 'IAM Role Arn',
                type: 'string',
              },
            },
            errorMessage: {
              required: {
                iamRoleArn: 'IAM Role Arn is required',
                region: 'AWS Region is required',
              },
            },
          },
        },
      },
    };
  }

  openAICompletion(
    request: ChatCompletionCreateParams,
    connection: AIConnectionEntity<AWSBedrockAIConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<OpenAICompletionResponse> {
    return this.chatCompletionProvider.handle(
      request,
      connection,
      model,
      options
    );
  }

  openAIResponse(
    request: ResponseCreateParams,
    connection: AIConnectionEntity<AWSBedrockAIConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<OpenAIResponseResponse> {
    return this.responseProvider.handle(request, connection, model, options);
  }

  anthropicMessages(
    request: AnthropicMessagesRequest,
    connection: AIConnectionEntity<AWSBedrockAIConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<AnthropicMessagesResponse> {
    return this.anthropicMessagesProvider.handle(
      request,
      connection,
      model,
      options
    );
  }
}
