import {
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
  InvokeModelWithResponseStreamCommandOutput,
  InternalServerException,
  ModelStreamErrorException,
  ServiceUnavailableException,
  ThrottlingException,
  ValidationException,
} from '@aws-sdk/client-bedrock-runtime';
import type { RawMessageStreamEvent } from '@anthropic-ai/sdk/resources/messages';
import { HttpStatus, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import {
  AnthropicMessagesResponse as AnthropicMessagesProviderResponse,
  CompletionRequestOptions,
  CompletionResponse,
  composeAbortSignal,
} from '../ai-provider.types';
import { CompletionError } from '../../gateway/completion.types';
import {
  AWSBedrockBaseProvider,
  type AWSBedrockAIConnectionConfig,
} from '../aws-bedrock-base';
import type { AnthropicMessagesResponse } from '../../gateway/anthropic/anthropic.types';
import {
  anthropicResponseToChatCompletion,
  anthropicStreamToChatCompletionChunks,
  assertClaudeModel,
  type BedrockInvokeWireBody,
} from '../adapters/anthropic-messages.adapter';

export const ANTHROPIC_BEDROCK_VERSION = 'bedrock-2023-05-31';

// `TextEncoder` / `TextDecoder` are stateless — instantiating them
// per request (or per stream chunk) is pure allocation churn. Hoist
// once at module load.
const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder();

// Hard cap on a single Bedrock-Invoke stream event payload. Stops a
// malicious / malfunctioning upstream from pushing a multi-GB JSON
// blob through `JSON.parse` and exhausting heap.
const MAX_STREAM_EVENT_BYTES = 4 * 1024 * 1024; // 4 MB

/**
 * Shared SDK-call dispatcher injected into the three format-specific
 * provider classes. Owns the InvokeModel(WithResponseStream) command
 * + the AWS event-stream parser + the AWS exception → CompletionError
 * mapping.
 *
 * Extends `AWSBedrockBaseProvider` so it inherits the cached
 * STS-credential `createClient()` helper. The format-specific classes
 * inject this dispatcher and call `dispatch(wireBody, …)`.
 */
@Injectable()
export class AWSBedrockInvokeDispatcher extends AWSBedrockBaseProvider {
  constructor(logger: PinoLogger, configService: ConfigService) {
    super(logger, configService);
  }

  /**
   * Native dispatch — returns the parsed Anthropic `Message`
   * (non-streaming) or an `AsyncIterable<RawMessageStreamEvent>`
   * (streaming) verbatim from the Bedrock-Invoke wire. Used by the
   * Anthropic-Messages-input + Responses-input handlers; the
   * orchestrator's per-shape branches consume the native data.
   */
  async dispatchNative(
    body: BedrockInvokeWireBody,
    streaming: boolean,
    connection: AIConnectionEntity<AWSBedrockAIConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<AnthropicMessagesProviderResponse> {
    assertClaudeModel(model.model);
    const client = await this.createClient(connection);
    this.logger.info({ body }, 'Bedrock Invoke request body');

    // T21: pull the connection-level Bedrock Guardrails config and
    // attach it to the InvokeModel command. The SDK takes
    // `guardrailIdentifier` / `guardrailVersion` directly on the
    // command input (they wire-render as `X-Amzn-Bedrock-Guardrail*`
    // headers). InvokeModel's `trace` is uppercase enum
    // (`'ENABLED' | 'DISABLED' | 'ENABLED_FULL'`); Converse's lowercase
    // — convert here so connection.config can stay one shape.
    const traceLower = connection.config?.guardrailConfig?.trace ?? 'enabled';
    const traceUpper = (
      traceLower === 'disabled'
        ? 'DISABLED'
        : traceLower === 'enabled_full'
        ? 'ENABLED_FULL'
        : 'ENABLED'
    ) as 'DISABLED' | 'ENABLED' | 'ENABLED_FULL';
    const guardrailFields = connection.config?.guardrailConfig
      ? {
          guardrailIdentifier:
            connection.config.guardrailConfig.guardrailIdentifier,
          guardrailVersion: connection.config.guardrailConfig.guardrailVersion,
          trace: traceUpper,
        }
      : undefined;

    try {
      if (streaming) {
        const stream = await client.send(
          new InvokeModelWithResponseStreamCommand({
            modelId: model.model,
            body: UTF8_ENCODER.encode(JSON.stringify(body)),
            contentType: 'application/json',
            accept: 'application/json',
            ...(guardrailFields ?? {}),
          }),
          { abortSignal: composeAbortSignal(options) }
        );

        return {
          data: this.parseBedrockEventStream(stream, body),
          headers: { 'x-request-id': stream.$metadata.requestId },
          providerRequestPayload: body,
        };
      }

      const response = await client.send(
        new InvokeModelCommand({
          modelId: model.model,
          body: UTF8_ENCODER.encode(JSON.stringify(body)),
          contentType: 'application/json',
          accept: 'application/json',
          ...(guardrailFields ?? {}),
        }),
        { abortSignal: composeAbortSignal(options) }
      );

      const responseJson = JSON.parse(
        UTF8_DECODER.decode(response.body)
      ) as AnthropicMessagesResponse;

      return {
        data: responseJson,
        headers: { 'x-request-id': response.$metadata.requestId },
        providerRequestPayload: body,
      };
    } catch (error) {
      if (error instanceof CompletionError) {
        if (
          error.data.providerRequestPayload === undefined &&
          body !== undefined
        ) {
          error.data.providerRequestPayload = body;
        }
        throw error;
      }
      this.handleError(error, body);
    }
  }

  /**
   * Converting dispatch — calls `dispatchNative` then runs the
   * canonical Anthropic↔OpenAI converter so the response comes out in
   * ChatCompletion shape. Used by `AWSBedrockInvokeOpenAICompletionProvider`.
   */
  async dispatch(
    body: BedrockInvokeWireBody,
    streaming: boolean,
    connection: AIConnectionEntity<AWSBedrockAIConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<CompletionResponse> {
    const native = await this.dispatchNative(
      body,
      streaming,
      connection,
      model,
      options
    );
    if (
      native.data != null &&
      typeof (native.data as AsyncIterable<RawMessageStreamEvent>)[
        Symbol.asyncIterator
      ] === 'function'
    ) {
      return {
        data: anthropicStreamToChatCompletionChunks(
          native.data as AsyncIterable<RawMessageStreamEvent>,
          {
            requestId: native.headers['x-request-id'],
            model: model.model,
          }
        ),
        headers: native.headers,
        providerRequestPayload: native.providerRequestPayload,
      };
    }
    return {
      data: anthropicResponseToChatCompletion(
        native.data as AnthropicMessagesResponse,
        model
      ),
      headers: native.headers,
      providerRequestPayload: native.providerRequestPayload,
    };
  }

  /**
   * Parse AWS event-stream items into Anthropic `RawMessageStreamEvent`s,
   * mapping AWS-specific exception items to `CompletionError` with the
   * wire body attached so the audit row sees `providerRequestPayload`
   * even on mid-stream throttling / model-stream / validation errors.
   */
  private async *parseBedrockEventStream(
    output: InvokeModelWithResponseStreamCommandOutput,
    requestBody: unknown
  ): AsyncIterable<RawMessageStreamEvent> {
    if (!output.body) return;

    for await (const item of output.body) {
      if (item.internalServerException || item.modelStreamErrorException) {
        this.handleError(
          item.internalServerException ?? item.modelStreamErrorException,
          requestBody
        );
      }
      if (item.throttlingException || item.validationException) {
        this.handleError(
          item.throttlingException ?? item.validationException,
          requestBody
        );
      }

      if (!item.chunk?.bytes) continue;
      if (item.chunk.bytes.byteLength > MAX_STREAM_EVENT_BYTES) {
        this.handleError(
          new Error(
            `Bedrock stream event exceeded ${MAX_STREAM_EVENT_BYTES} bytes`
          ),
          requestBody
        );
      }

      yield JSON.parse(
        UTF8_DECODER.decode(item.chunk.bytes)
      ) as RawMessageStreamEvent;
    }
  }

  private handleError(error: unknown, providerRequestPayload?: unknown): never {
    if (error instanceof InternalServerException) {
      const retryable = error.$retryable?.throttling ?? false;
      throw new CompletionError({
        message: `AWS Bedrock Invoke returned internal server error: ${error.message}`,
        rate: retryable,
        retryable,
        headers: { 'x-request-id': error.$metadata.requestId },
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        failureReason: 'Internal server error',
        openAICompatibleError: {
          code: 'aws_bedrock_invoke_internal_server_error',
        },
        providerRequestPayload,
      });
    }
    if (error instanceof ServiceUnavailableException) {
      throw new CompletionError({
        message: `AWS Bedrock Invoke service unavailable: ${error.message}`,
        rate: error.$retryable?.throttling ?? false,
        retryable: error.$retryable?.throttling ?? false,
        headers: { 'x-request-id': error.$metadata.requestId },
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        failureReason: 'Service unavailable',
        openAICompatibleError: {
          code: 'aws_bedrock_invoke_service_unavailable',
        },
        providerRequestPayload,
      });
    }
    if (error instanceof ModelStreamErrorException) {
      throw new CompletionError({
        message: `AWS Bedrock Invoke model stream error: ${error.message}`,
        rate: error.$retryable?.throttling ?? false,
        retryable: error.$retryable?.throttling ?? false,
        headers: { 'x-request-id': error.$metadata.requestId },
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        failureReason: 'Model stream error',
        openAICompatibleError: {
          code: 'aws_bedrock_invoke_model_stream_error',
        },
        providerRequestPayload,
      });
    }
    if (error instanceof ValidationException) {
      throw new CompletionError({
        message: `AWS Bedrock Invoke validation error: ${error.message}`,
        rate: false,
        retryable: false,
        headers: { 'x-request-id': error.$metadata.requestId },
        statusCode: HttpStatus.BAD_REQUEST,
        failureReason: 'Validation error',
        openAICompatibleError: {
          code: 'aws_bedrock_invoke_validation_error',
        },
        providerRequestPayload,
      });
    }
    if (error instanceof ThrottlingException) {
      throw new CompletionError({
        message: `AWS Bedrock Invoke throttled: ${error.message}`,
        rate: true,
        retryable: true,
        headers: { 'x-request-id': error.$metadata.requestId },
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        failureReason: 'Throttling error',
        openAICompatibleError: {
          code: 'aws_bedrock_invoke_throttling_error',
        },
        providerRequestPayload,
      });
    }
    if (error instanceof Error) {
      throw new CompletionError(
        {
          rate: false,
          message: error.message,
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          retryable: false,
          failureReason: 'External API error',
          openAICompatibleError: { code: 'unknown_error' },
          providerRequestPayload,
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
      openAICompatibleError: { code: 'unknown_error' },
      providerRequestPayload,
    });
  }
}
