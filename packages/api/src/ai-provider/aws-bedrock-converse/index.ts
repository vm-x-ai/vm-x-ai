import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import dedent from 'string-dedent';
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
import {
  AIProviderComponentType,
  AIProviderConnectionTypographyVariant,
  AIProviderDto,
} from '../dto/ai-provider.dto';
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';
import type { AWSBedrockAIConnectionConfig } from './shared';
import { AWSBedrockConverseOpenAICompletionProvider } from './openai-chat-completion.provider';
import { AWSBedrockConverseOpenAIResponseProvider } from './openai-response.provider';
import { AWSBedrockConverseAnthropicMessagesProvider } from './anthropic-messages.provider';

export type { AWSBedrockAIConnectionConfig } from './shared';

/**
 * `AWSBedrockProvider` (Converse) — composer implementing the
 * 3-method `CompletionProvider` interface. The Bedrock Converse SDK
 * speaks AWS's own Converse wire shape (distinct from OpenAI Chat
 * Completions and from Anthropic Messages); the shared dispatcher
 * inside this folder owns the OpenAI ↔ Converse conversion + SDK
 * call. Direct per-pair converters (Responses ↔ Converse, Anthropic
 * ↔ Converse) are a Phase B follow-up.
 */
@Injectable()
export class AWSBedrockProvider implements CompletionProvider {
  provider: AIProviderDto;

  constructor(
    private readonly configService: ConfigService,
    private readonly chatCompletionProvider: AWSBedrockConverseOpenAICompletionProvider,
    private readonly responseProvider: AWSBedrockConverseOpenAIResponseProvider,
    private readonly anthropicMessagesProvider: AWSBedrockConverseAnthropicMessagesProvider
  ) {
    const baseUrl = this.configService.getOrThrow<string>('BASE_URL');
    const basePath = this.configService.getOrThrow<string>('BASE_PATH');

    this.provider = {
      id: 'aws-bedrock',
      name: 'AWS Bedrock',
      description: 'AWS Bedrock Provider',
      defaultModel: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      config: {
        logo: { url: `/assets/logos/aws.jpeg` },
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
                errorMessage:
                  'The IAM Role should follow the AWS ARN pattern e.g. "arn:aws:iam::123456789012:role/bedrock-role"',
                format: 'aws-arn',
                minLength: 1,
                title: 'IAM Role Arn',
                type: 'string',
              },
              performanceConfig: {
                order: 3,
                type: 'object',
                title: 'Performance Configuration',
                properties: {
                  latency: {
                    title: 'Latency',
                    type: 'string',
                    enum: ['standard', 'optimized'],
                    description:
                      'To use a latency-optimized version of the model, set to optimized.',
                    default: 'standard',
                  },
                },
              },
            },
            errorMessage: {
              required: {
                iamRoleArn: 'IAM Role Arn is required',
                region: 'AWS Region is required',
              },
            },
          },
          uiComponents: [
            {
              type: AIProviderComponentType.LINK_BUTTON,
              content: 'Create IAM Role using CloudFormation',
              sx: {
                backgroundColor: '#ec971f',
                color: 'white',
                fontWeight: 'bold',
                marginBottom: '1rem',
                '&:hover': { backgroundColor: '#d58512' },
              },
              target: '_blank',
              helperText:
                'After creating the stack, look for the **Outputs** tab, copy the **RoleArn** value and paste in the field above.',
              url: `https://<%- formData?.config?.region %>.console.aws.amazon.com/cloudformation/home?region=<%- formData?.config?.region %>#/stacks/create/review?templateURL=${baseUrl}${basePath}/assets/aws/cfn/bedrock-iam-role.yaml&stackName=vm-x-ai-<%- environment.name %><%- formData?.name ? \`-\${formData?.name}\` : '' %>-bedrock-integration-role&param_ExternalID=<%- environment.workspaceId %>:<%- environment.environmentId %>&param_RoleName=vm-x-ai-<%- environment.name %><%- formData?.name ? \`-\${formData?.name}\` : '' %>-bedrock-<%- formData?.config?.region %>`,
            },
            {
              type: AIProviderComponentType.ACCORDION,
              title: 'Click to view the IAM Role details',
              elements: [
                {
                  type: AIProviderComponentType.TYPORAPHY,
                  content: 'Assume Role Policy Document:',
                  variant: AIProviderConnectionTypographyVariant.CAPTION,
                },
                {
                  type: AIProviderComponentType.EDITOR,
                  content: dedent`
                  {
                    "Version": "2012-10-17",
                    "Statement": [
                      {
                        "Effect": "Allow",
                        "Principal": {
                          "AWS": "arn:aws:iam::<%- (environment.physicalEnvironment || environment).providerConfig?.config.accountId %>:root"
                        },
                        "Action": "sts:AssumeRole",
                        "Condition": {
                          "StringEquals": {
                            "sts:ExternalId": "<%- environment.workspaceId %>:<%- environment.environmentId %>"
                          }
                        }
                      }
                    ]
                  }
                  `,
                  height: '300px',
                  language: 'json',
                  readOnly: true,
                  readOnlyMessage: 'Assume Role Policy Document',
                },
                {
                  type: AIProviderComponentType.TYPORAPHY,
                  content: 'Policy Document:',
                  sx: { marginTop: '.5rem' },
                  variant: AIProviderConnectionTypographyVariant.CAPTION,
                },
                {
                  type: AIProviderComponentType.EDITOR,
                  content: dedent`
                  {
                    "Version": "2012-10-17",
                    "Statement": [
                      {
                        "Effect": "Allow",
                        "Action": [
                          "bedrock:InvokeModel",
                          "bedrock:InvokeModelWithResponseStream",
                          "aws-marketplace:ViewSubscriptions",
                          "aws-marketplace:Subscribe"
                        ],
                        "Resource": [
                          "*"
                        ]
                      }
                    ]
                  }
                  `,
                  height: '300px',
                  language: 'json',
                  readOnly: true,
                  readOnlyMessage: 'Policy Document',
                },
              ],
            },
          ],
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
