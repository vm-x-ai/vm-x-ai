import {
  ChatCompletion,
  ChatCompletionAssistantMessageParam,
  ChatCompletionChunk,
  ChatCompletionCreateParams,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionDeveloperMessageParam,
  ChatCompletionFunctionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionToolMessageParam,
  ChatCompletionUserMessageParam,
} from 'openai/resources/index.js';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import {
  CompletionNonStreamingResponse,
  CompletionProvider,
  CompletionResponse,
  CompletionStreamingResponse,
} from '../ai-provider.types';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import {
  BedrockRuntimeClient,
  ContentBlock,
  ConverseCommand,
  ConverseCommandInput,
  ConverseStreamCommand,
  ConverseStreamCommandOutput,
  DocumentSource,
  InternalServerException,
  Message,
  ModelStreamErrorException,
  ServiceUnavailableException,
  StopReason,
  ThrottlingException,
  TokenUsage,
  Tool,
  ToolChoice,
  ToolInputSchema,
  ValidationException,
} from '@aws-sdk/client-bedrock-runtime';
import { HttpStatus, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import {
  AIProviderComponentType,
  AIProviderConnectionTypographyVariant,
  AIProviderDto,
} from '../dto/ai-provider.dto';
import { CompletionError } from '../../completion/completion.types';
import dedent from 'string-dedent';
import { ConfigService } from '@nestjs/config';
import { AwsCredentialIdentityProvider } from '@smithy/types';
import { v4 as uuidv4 } from 'uuid';

export type AWSBedrockAIConnectionConfig = {
  iamRoleArn: string;
  region: string;
  performanceConfig?: {
    latency?: 'standard' | 'optimized';
  };
};

const STOP_REASONS_MAP: Record<
  StopReason,
  ChatCompletion.Choice['finish_reason']
> = {
  [StopReason.CONTENT_FILTERED]: 'content_filter',
  [StopReason.END_TURN]: 'stop',
  [StopReason.GUARDRAIL_INTERVENED]: 'stop',
  [StopReason.MAX_TOKENS]: 'length',
  [StopReason.MODEL_CONTEXT_WINDOW_EXCEEDED]: 'length',
  [StopReason.STOP_SEQUENCE]: 'stop',
  [StopReason.TOOL_USE]: 'tool_calls',
};

@Injectable()
export class AWSBedrockProvider implements CompletionProvider {
  provider: AIProviderDto;
  private readonly cachedProviders = new Map<
    string,
    AwsCredentialIdentityProvider
  >();

  constructor(
    private readonly logger: PinoLogger,
    private readonly configService: ConfigService
  ) {
    const baseUrl = this.configService.get('BASE_URL');
    this.provider = {
      id: 'aws-bedrock',
      name: 'AWS Bedrock',
      description: 'AWS Bedrock Provider',
      defaultModel: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      config: {
        logo: {
          url: '/assets/logos/aws.png',
        },
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
                '&:hover': {
                  backgroundColor: '#d58512',
                },
              },
              target: '_blank',
              helperText:
                'After creating the stack, look for the **Outputs** tab, copy the **RoleArn** value and paste in the field above.',
              url: `https://<%- formData?.config?.region %>.console.aws.amazon.com/cloudformation/home?region=<%- formData?.config?.region %>#/stacks/create/review?templateURL=${baseUrl}/assets/aws/cfn/bedrock-iam-role.yaml&stackName=vm-x-ai-<%- environment.name %><%- formData?.name ? \`-\${formData?.name}\` : '' %>-bedrock-integration-role&param_ExternalID=<%- environment.workspaceId %>:<%- environment.environmentId %>&param_RoleName=vm-x-ai-<%- environment.name %><%- formData?.name ? \`-\${formData?.name}\` : '' %>-bedrock-<%- formData?.config?.region %>`,
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
                  sx: {
                    marginTop: '.5rem',
                  },
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

  completion(
    request: ChatCompletionCreateParamsNonStreaming,
    connection: AIConnectionEntity<AWSBedrockAIConnectionConfig>,
    model: AIResourceModelConfigEntity
  ): Promise<CompletionNonStreamingResponse>;

  completion(
    request: ChatCompletionCreateParamsStreaming,
    connection: AIConnectionEntity<AWSBedrockAIConnectionConfig>,
    model: AIResourceModelConfigEntity
  ): Promise<CompletionStreamingResponse>;

  completion(
    request: ChatCompletionCreateParams,
    connection: AIConnectionEntity<AWSBedrockAIConnectionConfig>,
    model: AIResourceModelConfigEntity
  ): Promise<CompletionResponse>;

  async completion(
    request: ChatCompletionCreateParams,
    connection: AIConnectionEntity<AWSBedrockAIConnectionConfig>,
    model: AIResourceModelConfigEntity
  ): Promise<CompletionResponse> {
    const client = await this.createClient(connection);
    try {
      const requestBody: ConverseCommandInput = {
        modelId: model.model,
        inferenceConfig: {
          topP: request.top_p ?? undefined,
          maxTokens:
            request.max_completion_tokens ?? request.max_tokens ?? undefined,
          stopSequences: request.stop
            ? Array.isArray(request.stop)
              ? request.stop
              : [request.stop]
            : undefined,
          temperature: request.temperature ?? undefined,
        },
        performanceConfig: connection.config?.performanceConfig
          ? {
              latency: connection.config.performanceConfig.latency,
            }
          : undefined,
        messages: await this.convertMessages(request),
        system: request.messages
          .filter(
            (message) =>
              message.role === 'system' || message.role === 'developer'
          )
          .map((message) => ({
            text:
              typeof message.content === 'string'
                ? message.content
                : message.content.map((part) => part.text).join('\n'),
          })),
        toolConfig:
          request.tools?.length || request.functions?.length
            ? {
                tools: this.convertTools(request),
                toolChoice: this.convertToolChoice(request),
              }
            : undefined,
      };
      this.logger.info({ requestBody }, 'AI Provider request body');

      if (request.stream) {
        const stream = await client.send(
          new ConverseStreamCommand(requestBody)
        );
        if (!stream.stream) {
          throw new CompletionError({
            message: 'Failed to start the stream',
            rate: false,
            retryable: false,
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            failureReason: 'Failed to start the stream',
            openAICompatibleError: {
              code: 'aws_bedrock_failed_to_start_stream',
            },
          });
        }

        return {
          data: this.convertStream(stream, model),
          headers: {
            'x-request-id': stream.$metadata.requestId,
          },
        };
      } else {
        const response = await client.send(new ConverseCommand(requestBody));
        const id =
          response.$metadata.extendedRequestId ?? `awsbedrock-${uuidv4()}`;

        let content = '';
        const toolCalls: ChatCompletionMessageToolCall[] = [];
        for (const item of response.output?.message?.content ?? []) {
          if (item.text) {
            content += item.text;
          } else if (item.toolUse && item.toolUse.name && item.toolUse.input) {
            toolCalls.push({
              id: item.toolUse.toolUseId ?? uuidv4(),
              type: 'function',
              function: {
                name: item.toolUse.name,
                arguments:
                  typeof item.toolUse.input === 'string'
                    ? item.toolUse.input
                    : JSON.stringify(item.toolUse.input),
              },
            });
          } else if (item.reasoningContent) {
            content += item.reasoningContent.reasoningText ?? '';
          }
        }

        return {
          data: {
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            id,
            model: model.model,
            usage: this.convertUsage(response.usage),
            choices: [
              {
                index: 0,
                logprobs: null,
                message: {
                  role: 'assistant',
                  content,
                  refusal: null,
                  tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
                },
                finish_reason: response.stopReason
                  ? STOP_REASONS_MAP[response.stopReason]
                  : 'stop',
              },
            ],
          },
          headers: {
            'x-request-id': response.$metadata.requestId,
          },
        };
      }
    } catch (error) {
      if (error instanceof CompletionError) {
        throw error;
      }

      this.handleError(error);
    }
  }

  private async *convertStream(
    { stream, $metadata }: ConverseStreamCommandOutput,
    model: AIResourceModelConfigEntity
  ): AsyncIterable<ChatCompletionChunk> {
    const created = Math.floor(Date.now() / 1000);
    const id = $metadata.extendedRequestId ?? `awsbedrock-${uuidv4()}`;
    for await (const item of stream ?? []) {
      const chunk: ChatCompletionChunk = {
        object: 'chat.completion.chunk',
        model: model.model,
        id,
        created,
        choices: [],
      };

      if (
        item.internalServerException ||
        item.serviceUnavailableException ||
        item.modelStreamErrorException ||
        item.validationException ||
        item.throttlingException
      ) {
        this.handleError(
          item.internalServerException ??
            item.serviceUnavailableException ??
            item.modelStreamErrorException ??
            item.validationException ??
            item.throttlingException
        );
      }

      if (item.messageStart) {
        continue;
      } else if (item.contentBlockStart?.start?.toolUse) {
        chunk.choices[0] = {
          index: 0,
          delta: {
            content: '',
            role: 'assistant',
            tool_calls: [
              {
                type: 'function',
                index: item.contentBlockStart.contentBlockIndex ?? 0,
                function: {
                  name: item.contentBlockStart.start.toolUse.name,
                  arguments: '',
                },
                id: item.contentBlockStart.start.toolUse.toolUseId,
              },
            ],
          },
          finish_reason: null,
        };
      } else if (item.contentBlockDelta) {
        if (item.contentBlockDelta.delta?.text) {
          chunk.choices[0] = {
            index: 0,
            delta: {
              ...(chunk.choices[0]?.delta ?? {}),
              content: item.contentBlockDelta.delta.text,
              role: 'assistant',
            },
            finish_reason: null,
          };
        } else if (item.contentBlockDelta.delta?.toolUse) {
          chunk.choices[0] = {
            index: 0,
            delta: {
              content: '',
              role: 'assistant',
              tool_calls: [
                {
                  index: item.contentBlockDelta.contentBlockIndex ?? 0,
                  function: {
                    arguments: item.contentBlockDelta.delta.toolUse.input ?? '',
                  },
                }
              ],
            },
            finish_reason: null,
          };
        }
      } else if (item.contentBlockStop) {
        continue;
      } else if (item.messageStop && item.messageStop.stopReason) {
        chunk.choices[0] = {
          index: 0,
          delta: {},
          finish_reason: STOP_REASONS_MAP[item.messageStop.stopReason],
        };
      } else if (item.metadata?.usage) {
        chunk.usage = this.convertUsage(item.metadata.usage);
      }

      yield chunk;
    }
  }

  private handleError(
    error:
      | InternalServerException
      | ServiceUnavailableException
      | ModelStreamErrorException
      | ValidationException
      | ThrottlingException
      | Error
      | unknown
  ): never {
    if (error instanceof InternalServerException) {
      const retryable = error.$retryable?.throttling ?? false;
      throw new CompletionError({
        message: `AWS Bedrock API returned an internal server error: ${error.message}`,
        rate: retryable,
        retryable: retryable,
        headers: {
          'x-request-id': error.$metadata.requestId,
        },
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        failureReason: 'Internal server error',
        openAICompatibleError: {
          code: 'aws_bedrock_internal_server_error',
          type: 'internal_server_error',
        },
      });
    } else if (error instanceof ServiceUnavailableException) {
      const retryable = error.$retryable?.throttling ?? false;
      throw new CompletionError({
        message: `AWS Bedrock API returned a service unavailable error: ${error.message}`,
        rate: retryable,
        retryable: retryable,
        headers: {
          'x-request-id': error.$metadata.requestId,
        },
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        failureReason: 'Service unavailable',
        openAICompatibleError: {
          code: 'aws_bedrock_service_unavailable_error',
          type: 'service_unavailable',
        },
      });
    } else if (error instanceof ModelStreamErrorException) {
      const retryable = error.$retryable?.throttling ?? false;
      throw new CompletionError({
        message: `AWS Bedrock API returned a model stream error: ${error.message}`,
        rate: retryable,
        retryable: retryable,
        headers: {
          'x-request-id': error.$metadata.requestId,
        },
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        failureReason: 'Model stream error',
        openAICompatibleError: {
          code: 'aws_bedrock_model_stream_error',
          type: 'model_stream_error',
        },
      });
    } else if (error instanceof ValidationException) {
      const retryable = error.$retryable?.throttling ?? false;
      throw new CompletionError({
        message: `AWS Bedrock API returned a validation error: ${error.message}`,
        rate: retryable,
        retryable: retryable,
        headers: {
          'x-request-id': error.$metadata.requestId,
        },
        statusCode: HttpStatus.BAD_REQUEST,
        failureReason: 'Validation error',
        openAICompatibleError: {
          code: 'aws_bedrock_validation_error',
          type: 'validation_error',
        },
      });
    } else if (error instanceof ThrottlingException) {
      throw new CompletionError({
        message: `AWS Bedrock API returned a throttling error: ${error.message}`,
        rate: true,
        retryable: true,
        headers: {
          'x-request-id': error.$metadata.requestId,
        },
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        failureReason: 'Throttling error',
        openAICompatibleError: {
          code: 'aws_bedrock_throttling_error',
          type: 'throttling_error',
        },
      });
    } else if (error instanceof Error) {
      throw new CompletionError(
        {
          rate: false,
          message: (error as Error).message,
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          retryable: false,
          failureReason: 'External API error',
          openAICompatibleError: {
            code: 'unknown_error',
          },
        },
        error
      );
    }

    throw new CompletionError({
      message: 'Unknown error',
      rate: false,
      retryable: false,
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      failureReason: 'Unknown error',
      openAICompatibleError: {
        code: 'unknown_error',
      },
    });
  }

  private convertUsage(usage?: TokenUsage) {
    if (!usage) {
      return undefined;
    }

    return {
      completion_tokens: usage.outputTokens ?? 0,
      prompt_tokens: usage.inputTokens ?? 0,
      total_tokens: usage.totalTokens ?? 0,
      prompt_tokens_details: {
        cached_tokens: usage.cacheReadInputTokens ?? 0,
      },
    };
  }

  private async convertMessages(
    request: ChatCompletionCreateParams
  ): Promise<Message[]> {
    const messages: Message[] = [];

    for (
      let messageIndex = 0;
      messageIndex < request.messages.length;
      messageIndex++
    ) {
      const message = request.messages[messageIndex];
      if (message.role === 'system' || message.role === 'developer') {
        continue;
      }

      if (message.role === 'user') {
        messages.push({
          role: 'user',
          content: await this.convertMessageParts(message, messageIndex),
        });
      } else if (message.role === 'assistant') {
        messages.push({
          role: 'assistant',
          content: await this.convertMessageParts(message, messageIndex),
        });
      } else if (message.role === 'tool') {
        const lastMessage = messages[messages.length - 1];
        if (
          lastMessage &&
          (lastMessage.content ?? []).some((block) => block.toolResult)
        ) {
          lastMessage.content = [
            ...(lastMessage.content ?? []),
            ...(await this.convertMessageParts(message, messageIndex)),
          ];
        } else {
          messages.push({
            role: 'user',
            content: await this.convertMessageParts(message, messageIndex),
          });
        }
      }
    }
    return messages;
  }

  private async convertMessageParts(
    message:
      | ChatCompletionUserMessageParam
      | ChatCompletionDeveloperMessageParam
      | ChatCompletionAssistantMessageParam
      | ChatCompletionToolMessageParam
      | ChatCompletionFunctionMessageParam,
    messageIndex: number
  ) {
    const blocks: ContentBlock[] = [];
    if (
      message.role === 'assistant' &&
      (message.tool_calls?.length || message.function_call)
    ) {
      for (const toolCall of message.tool_calls ?? []) {
        if (toolCall.type === 'function') {
          blocks.push({
            toolUse: {
              name: toolCall.function.name,
              input: this.parseToolArguments(toolCall.function.arguments),
              toolUseId: toolCall.id,
            },
          });
        } else if (toolCall.type === 'custom') {
          blocks.push({
            toolUse: {
              name: toolCall.custom.name,
              input: this.parseToolArguments(toolCall.custom.input),
              toolUseId: toolCall.id,
            },
          });
        }
      }

      if (message.function_call) {
        blocks.push({
          toolUse: {
            name: message.function_call.name,
            input: this.parseToolArguments(message.function_call.arguments),
            toolUseId: undefined,
          },
        });
      }
    } else if (message.role === 'tool') {
      blocks.push({
        toolResult: {
          toolUseId: message.tool_call_id,
          content:
            typeof message.content === 'string'
              ? [
                  {
                    text: message.content as string,
                  },
                ]
              : message.content.map((part) => ({
                  text: part.text,
                })),
        },
      });
    } else if (message.role === 'function') {
      blocks.push({
        toolResult: {
          toolUseId: undefined,
          content: message.content
            ? [
                {
                  text: message.content,
                },
              ]
            : [],
        },
      });
    } else if (
      typeof message.content === 'string' &&
      message.content.length > 0
    ) {
      blocks.push({
        text: message.content,
      });
    } else if (Array.isArray(message.content)) {
      for (
        let contentPartIndex = 0;
        contentPartIndex < message.content.length;
        contentPartIndex++
      ) {
        const part = message.content[contentPartIndex];
        if (part.type === 'text') {
          blocks.push({
            text: part.text,
          });
        } else if (part.type === 'image_url') {
          try {
            const imageResponse = await fetch(part.image_url.url);
            blocks.push({
              image: {
                format: undefined,
                source: {
                  bytes: new Uint8Array(await imageResponse.arrayBuffer()),
                },
              },
            });
          } catch (error) {
            this.logger.error({ error }, 'Failed to fetch image');
            throw new CompletionError({
              message: `Error fetching image from URL ${part.image_url.url} on messages[${messageIndex}].content[${contentPartIndex}]`,
              rate: false,
              retryable: false,
              statusCode: HttpStatus.BAD_REQUEST,
              failureReason: 'Failed to fetch image',
              openAICompatibleError: {
                code: 'aws_bedrock_image_fetch_error',
                type: 'image_fetch_error',
                param: `messages[${messageIndex}].content[${contentPartIndex}]`,
              },
            });
          }
        } else if (part.type === 'file') {
          blocks.push({
            document: {
              name: part.file.filename,
              context: part.file.file_id,
              source: {
                text: part.file.file_data
                  ? Buffer.from(part.file.file_data, 'base64').toString()
                  : undefined,
              } as DocumentSource.TextMember,
            },
          });
        } else if (part.type === 'input_audio') {
          throw new CompletionError({
            message: `Audio input is not supported for AWS Bedrock Converse API`,
            rate: false,
            retryable: false,
            statusCode: HttpStatus.BAD_REQUEST,
            failureReason:
              'Audio input is not supported for AWS Bedrock Converse API',
            openAICompatibleError: {
              code: 'aws_bedrock_audio_input_not_supported',
              type: 'audio_input_not_supported',
              param: `messages[${messageIndex}].content[${contentPartIndex}]`,
            },
          });
        } else if (part.type === 'refusal') {
          this.logger.warn(
            { refusal: part.refusal, messageIndex, contentPartIndex },
            'Refusal is not supported for AWS Bedrock Converse API'
          );
        }
      }
    }

    return blocks;
  }

  private parseToolArguments(
    args: string
  ): ContentBlock.ToolUseMember['toolUse']['input'] {
    try {
      return JSON.parse(args ?? '{}');
    } catch {
      return args;
    }
  }

  private convertTools(
    request: ChatCompletionCreateParams
  ): Tool[] | undefined {
    if (!request.tools?.length && !request.functions?.length) {
      return undefined;
    }

    const allowedTools =
      request.tool_choice &&
      typeof request.tool_choice === 'object' &&
      request.tool_choice.type === 'allowed_tools'
        ? request.tool_choice.allowed_tools.tools
            .map((tool) => tool.name as string)
            .filter((name) => name !== undefined)
        : undefined;

    const shouldFilterTools = allowedTools !== undefined;

    const tools: Tool[] = [];

    for (const tool of request.tools || []) {
      if (
        tool.type === 'function' &&
        tool.function.name &&
        (shouldFilterTools ? !allowedTools.includes(tool.function.name) : false)
      ) {
        continue;
      }

      if (tool.type === 'function' && tool.function.name) {
        tools.push({
          toolSpec: {
            name: tool.function.name,
            description: tool.function.description,
            inputSchema: {
              json: tool.function.parameters,
            } as ToolInputSchema.JsonMember,
          },
        });
      }
    }

    for (const tool of request.functions || []) {
      if (
        tool.name &&
        (shouldFilterTools ? !allowedTools.includes(tool.name) : false)
      ) {
        continue;
      }

      tools.push({
        toolSpec: {
          name: tool.name,
          description: tool.description,
          inputSchema: {
            json: tool.parameters,
          } as ToolInputSchema.JsonMember,
        },
      });
    }

    return tools.length > 0 ? tools : undefined;
  }

  private convertToolChoice(
    request: ChatCompletionCreateParams
  ): ToolChoice | undefined {
    if (!request.tool_choice) {
      return undefined;
    }

    if (request.tool_choice === 'auto' || request.function_call === 'auto') {
      return {
        auto: true,
      };
    }

    if (request.tool_choice === 'required') {
      return {
        any: true,
      };
    }

    if (
      typeof request.tool_choice === 'object' &&
      request.tool_choice.type === 'function'
    ) {
      return {
        tool: {
          name: request.tool_choice.function.name,
        },
      };
    }

    if (request.function_call && typeof request.function_call === 'object') {
      return {
        tool: {
          name: request.function_call.name,
        },
      };
    }

    return undefined;
  }

  protected async createClient(
    connection: AIConnectionEntity<AWSBedrockAIConnectionConfig>
  ): Promise<BedrockRuntimeClient> {
    if (connection.config) {
      const credentials = await this.getAwsSdkCredentials(connection);
      return new BedrockRuntimeClient({
        region: connection.config.region,
        credentials,
      });
    }

    return new BedrockRuntimeClient({});
  }

  protected async getAwsSdkCredentials(
    connection: AIConnectionEntity<AWSBedrockAIConnectionConfig>
  ): Promise<AwsCredentialIdentityProvider | undefined> {
    if (!connection.config) {
      return undefined;
    }

    this.logger.info(
      {
        roleArn: connection.config.iamRoleArn,
      },
      'Using custom IAM role for Bedrock client'
    );

    const cacheKey = connection.config.iamRoleArn;
    if (this.cachedProviders.has(cacheKey)) {
      this.logger.info(
        {
          roleArn: connection.config.iamRoleArn,
        },
        'Using cached IAM role credentials provider for Bedrock client'
      );
      return this.cachedProviders.get(cacheKey);
    }

    const credentials = fromTemporaryCredentials({
      params: {
        RoleArn: connection.config.iamRoleArn,
        RoleSessionName: 'vm-x-server-cross-account-session',
        ExternalId: `${connection.workspaceId}:${connection.environmentId}`,
      },
    });

    this.cachedProviders.set(cacheKey, credentials);

    return credentials;
  }
}
