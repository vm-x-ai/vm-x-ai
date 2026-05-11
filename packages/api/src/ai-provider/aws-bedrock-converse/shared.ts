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
  CompletionRequestOptions,
  CompletionResponse,
  CompletionStreamingResponse,
  composeAbortSignal,
} from '../ai-provider.types';
import {
  ContentBlock,
  ConverseCommand,
  ConverseCommandInput,
  ConverseCommandOutput,
  ConverseStreamCommand,
  ConverseStreamCommandOutput,
  ConverseStreamOutput,
  DocumentBlock,
  DocumentFormat,
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
import { CompletionError } from '../../gateway/completion.types';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import {
  AWSBedrockAIConnectionConfig,
  AWSBedrockBaseProvider,
} from '../aws-bedrock-base';
import { takePassthroughEnvelope } from '../passthrough.helpers';
import { assertModelSupportsFeatures } from './capability-gate';
import type { AnthropicPassthrough } from '../../gateway/anthropic/anthropic-converter';
import { assertSafeOutboundUrl } from '../url-safety';

export type { AWSBedrockAIConnectionConfig } from '../aws-bedrock-base';

const STOP_REASONS_MAP: Record<
  StopReason,
  ChatCompletion.Choice['finish_reason']
> = {
  [StopReason.CONTENT_FILTERED]: 'content_filter',
  [StopReason.END_TURN]: 'stop',
  // Mapped to `content_filter` rather than `stop` so audit can
  // distinguish a guardrail intervention from a normal turn end.
  // Bedrock's `GUARDRAIL_INTERVENED` maps semantically onto OpenAI's
  // content-filter finish reason — both signal "the upstream blocked
  // generation for policy reasons".
  [StopReason.GUARDRAIL_INTERVENED]: 'content_filter',
  [StopReason.MALFORMED_MODEL_OUTPUT]: 'stop',
  [StopReason.MALFORMED_TOOL_USE]: 'tool_calls',
  [StopReason.MAX_TOKENS]: 'length',
  [StopReason.MODEL_CONTEXT_WINDOW_EXCEEDED]: 'length',
  [StopReason.STOP_SEQUENCE]: 'stop',
  [StopReason.TOOL_USE]: 'tool_calls',
};

/**
 * Map filename / MIME-type hints to Bedrock's `DocumentFormat` enum so
 * `BytesMember` documents are tagged correctly. Bedrock can usually
 * infer from the bytes themselves but the format hint dramatically
 * improves parsing accuracy for ambiguous formats (CSV vs txt, etc.).
 */
function inferDocumentFormat(
  filename?: string,
  mediaType?: string
): DocumentFormat | undefined {
  const mimeMap: Record<string, DocumentFormat> = {
    'application/pdf': DocumentFormat.PDF,
    'application/msword': DocumentFormat.DOC,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      DocumentFormat.DOCX,
    'application/vnd.ms-excel': DocumentFormat.XLS,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      DocumentFormat.XLSX,
    'text/csv': DocumentFormat.CSV,
    'text/html': DocumentFormat.HTML,
    'text/plain': DocumentFormat.TXT,
    'text/markdown': DocumentFormat.MD,
  };
  if (mediaType && mimeMap[mediaType]) return mimeMap[mediaType];
  if (!filename) return undefined;
  const ext = filename.split('.').pop()?.toLowerCase();
  const extMap: Record<string, DocumentFormat> = {
    pdf: DocumentFormat.PDF,
    doc: DocumentFormat.DOC,
    docx: DocumentFormat.DOCX,
    xls: DocumentFormat.XLS,
    xlsx: DocumentFormat.XLSX,
    csv: DocumentFormat.CSV,
    html: DocumentFormat.HTML,
    htm: DocumentFormat.HTML,
    txt: DocumentFormat.TXT,
    md: DocumentFormat.MD,
  };
  return ext ? extMap[ext] : undefined;
}

/**
 * SystemContentBlock entries we actually produce — `text` for the
 * normal system prompt, `cachePoint` after a cacheable prefix. Other
 * SystemContentBlock variants (guardrail) aren't wired through the
 * gateway yet. Imported types from the SDK use a discriminated union
 * with `?: never` placeholders on inactive members; structurally the
 * blocks below match without needing the verbose union type.
 */
export type ConverseSystemBlock =
  | { text: string }
  | { cachePoint: { type: 'default'; ttl?: '5m' | '1h' } };

/**
 * Pull observability headers off a Converse response — `latencyMs`
 * and `trace.promptRouter.invokedModelId` (T24). Both go onto the
 * gateway's headers stream so the audit pipeline records them.
 * Returns just `x-request-id` when no trace data is present.
 */
export function extractConverseTraceHeaders(
  response: ConverseCommandOutput | undefined
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (response?.$metadata?.requestId) {
    headers['x-request-id'] = response.$metadata.requestId;
  }
  const latency = response?.metrics?.latencyMs;
  if (typeof latency === 'number') {
    headers['x-bedrock-latency-ms'] = String(latency);
  }
  const invokedModelId = (
    response?.trace as
      | { promptRouter?: { invokedModelId?: string } }
      | undefined
  )?.promptRouter?.invokedModelId;
  if (invokedModelId) {
    headers['x-bedrock-invoked-model-id'] = invokedModelId;
  }
  return headers;
}

/**
 * Synthetic tool name used by the Chat→Converse structured-output
 * shim (T12) — mirrors the same sentinel the Anthropic adapter uses
 * so a structured-output round-trip through either path looks
 * identical from the audit row's perspective. The response-side
 * unwrap recognises this name and re-emits the tool input as the
 * assistant message content (the JSON string an OpenAI
 * `response_format: json_schema` consumer expects).
 */
export const CONVERSE_STRUCTURED_OUTPUT_TOOL_NAME = '__vmx_structured_output__';

/**
 * Append a synthetic Converse tool whose `inputSchema.json` is the
 * supplied JSON schema, plus force `toolChoice` to that tool. Used
 * by the Chat→Converse path to give Anthropic-style structured
 * output for OpenAI `response_format: { type: 'json_schema' }`.
 *
 * Mutates `tools` in place; returns the new toolChoice the caller
 * should set on the Converse command input.
 */
export function applyConverseStructuredOutput(
  request: ChatCompletionCreateParams,
  tools: Tool[] | undefined
): {
  tools: Tool[] | undefined;
  toolChoice: ToolChoice | undefined;
  applied: boolean;
} {
  const responseFormat = (
    request as ChatCompletionCreateParams & {
      response_format?: {
        type?: string;
        json_schema?: {
          name?: string;
          description?: string;
          schema?: Record<string, unknown>;
        };
      };
    }
  ).response_format;
  const jsonSchema = responseFormat?.json_schema;
  if (
    responseFormat?.type !== 'json_schema' ||
    !jsonSchema?.schema ||
    typeof jsonSchema.schema !== 'object'
  ) {
    return { tools, toolChoice: undefined, applied: false };
  }
  const synthetic: Tool = {
    toolSpec: {
      name: CONVERSE_STRUCTURED_OUTPUT_TOOL_NAME,
      description:
        jsonSchema.description ??
        `Return the response as a JSON object that conforms to the${
          jsonSchema.name ? ` "${jsonSchema.name}"` : ''
        } schema.`,
      inputSchema: {
        json: jsonSchema.schema as never,
      } as ToolInputSchema.JsonMember,
    },
  };
  return {
    tools: [...(tools ?? []), synthetic],
    toolChoice: {
      tool: { name: CONVERSE_STRUCTURED_OUTPUT_TOOL_NAME },
    } as ToolChoice,
    applied: true,
  };
}

/**
 * Convert the gateway's `__vmx_passthrough.anthropic.{cache_breakpoints,
 * system_cache_breakpoints, tool_cache_breakpoints}` envelope into
 * Bedrock Converse-native `cachePoint` content blocks injected in-place
 * into `messages[]`, `system[]`, and `tools[]`.
 *
 * This was the silent breakage the matrix audit caught — `cache_control`
 * markers used to land in `additionalModelRequestFields` (a free-form
 * blob the model ignores), so Bedrock never wrote cache entries even
 * though the gateway thought it did. The fix lives entirely in this
 * helper: emit `cachePoint` blocks at the breakpoint positions the
 * Anthropic ↔ OpenAI converter captured, and let Bedrock's per-block
 * caching machinery do the rest.
 *
 * The function mutates its inputs in place — the Converse SDK accepts
 * `cachePoint` blocks interleaved with other content blocks, so the
 * mutation is the natural shape.
 *
 * Per-message breakpoints (`cache_breakpoints[].path`) reference the
 * OpenAI-shape body's path (`messages[X].content[Y]`); we collapse
 * each marked message to a single trailing cachePoint at the end of
 * the matching Converse message — common-case faithful, sufficient for
 * the "cache the conversation up to here" pattern that's by far the
 * most prevalent caching use today. Per-block-precise placement is
 * follow-up.
 */
export function injectCachePoints(
  messages: Message[],
  system: ConverseSystemBlock[] | undefined,
  tools: Tool[] | undefined,
  passthrough: AnthropicPassthrough | undefined
): void {
  if (!passthrough) return;

  // System breakpoints — insert cachePoint AFTER the marked block.
  // Iterate descending so insertions don't shift later indices.
  if (system && passthrough.system_cache_breakpoints?.length) {
    const sortedSystem = [...passthrough.system_cache_breakpoints].sort(
      (a, b) => b.index - a.index
    );
    for (const bp of sortedSystem) {
      if (bp.index < 0 || bp.index >= system.length) continue;
      system.splice(bp.index + 1, 0, {
        cachePoint: {
          type: 'default',
          ...(bp.cache_control.ttl ? { ttl: bp.cache_control.ttl } : {}),
        },
      });
    }
  }

  // Tool breakpoints — same pattern.
  if (tools && passthrough.tool_cache_breakpoints?.length) {
    const sortedTools = [...passthrough.tool_cache_breakpoints].sort(
      (a, b) => b.index - a.index
    );
    for (const bp of sortedTools) {
      if (bp.index < 0 || bp.index >= tools.length) continue;
      tools.splice(bp.index + 1, 0, {
        cachePoint: {
          type: 'default',
          ...(bp.cache_control.ttl ? { ttl: bp.cache_control.ttl } : {}),
        },
      } as Tool);
    }
  }

  // Per-message breakpoints — collapse to a single trailing cachePoint
  // on each Converse message that any marked block landed in. The
  // path is `messages[X].content[Y]`; we extract X to find the
  // matching Converse message position. The OpenAI converter emits
  // OpenAI messages in the same order as the source Anthropic
  // messages, so X also indexes the Converse messages array (system
  // messages are filtered out by `convertMessages`, but they don't
  // appear in `cache_breakpoints` either since system breakpoints
  // live in `system_cache_breakpoints`).
  if (passthrough.cache_breakpoints?.length) {
    const messageIndexesWithBreakpoint = new Map<
      number,
      '5m' | '1h' | undefined
    >();
    for (const bp of passthrough.cache_breakpoints) {
      const m = /^messages\[(\d+)\]/.exec(bp.path);
      if (!m) continue;
      const idx = Number(m[1]);
      // Last write wins on ttl when a single message has multiple
      // breakpoint markers — Bedrock only takes one cachePoint per
      // message anyway.
      messageIndexesWithBreakpoint.set(idx, bp.cache_control.ttl);
    }
    for (const [idx, ttl] of messageIndexesWithBreakpoint) {
      if (idx < 0 || idx >= messages.length) continue;
      const msg = messages[idx];
      if (!msg.content) continue;
      msg.content.push({
        cachePoint: {
          type: 'default',
          ...(ttl ? { ttl } : {}),
        },
      } as ContentBlock);
    }
  }
}

/**
 * Shared Bedrock Converse dispatcher. Owns the AWS Converse SDK call,
 * the OpenAI ChatCompletion ↔ Bedrock Converse conversion, and the
 * streaming + error-mapping helpers. The three format-specific sibling
 * files inject this dispatcher and call `completion(...)` with an
 * OpenAI-shape body — they handle the conversion to/from OpenAI Chat
 * Completions for non-OpenAI input formats.
 *
 * Direct per-pair converters (Anthropic ↔ Converse, Responses ↔
 * Converse) are a Phase B follow-up; the structural split here means
 * they land by editing this file + the format-specific sibling.
 */
@Injectable()
export class AWSBedrockConverseDispatcher extends AWSBedrockBaseProvider {
  constructor(logger: PinoLogger, configService: ConfigService) {
    super(logger, configService);
  }

  completion(
    request: ChatCompletionCreateParamsNonStreaming,
    connection: AIConnectionEntity<AWSBedrockAIConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<CompletionNonStreamingResponse>;

  completion(
    request: ChatCompletionCreateParamsStreaming,
    connection: AIConnectionEntity<AWSBedrockAIConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<CompletionStreamingResponse>;

  completion(
    request: ChatCompletionCreateParams,
    connection: AIConnectionEntity<AWSBedrockAIConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<CompletionResponse>;

  async completion(
    request: ChatCompletionCreateParams,
    connection: AIConnectionEntity<AWSBedrockAIConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<CompletionResponse> {
    const client = await this.createClient(connection);
    // Strip the `__vmx_passthrough` envelope so we can read its
    // Anthropic-specific extras (top_k, anthropic_beta, etc.) and
    // forward them to Bedrock via `additionalModelRequestFields`.
    // Native passthrough providers do this with the request body
    // verbatim; Converse needs to translate.
    const { body: cleanRequest, anthropic: passthrough } =
      takePassthroughEnvelope(request);
    // Hoisted out of the try block so the catch can attach it to
    // CompletionError.data.providerRequestPayload — the audit row
    // captures this even when the SDK throws.
    let requestBody: ConverseCommandInput | undefined;
    try {
      const additionalModelRequestFields = this.buildAdditionalModelFields(
        cleanRequest,
        passthrough
      );
      const messages = await this.convertMessages(cleanRequest);
      const system = cleanRequest.messages
        .filter(
          (message) => message.role === 'system' || message.role === 'developer'
        )
        .map(
          (message) =>
            ({
              text:
                typeof message.content === 'string'
                  ? message.content
                  : message.content.map((part) => part.text).join('\n'),
            } as ConverseSystemBlock)
        );
      // T11: `tool_choice: 'none'` has no native Converse equivalent.
      // The Anthropic-semantic match ("model must not call tools")
      // is achieved by stripping `tools` from the request entirely —
      // the model can't call what it can't see. Skip the
      // tool-conversion path here so toolConfig stays undefined.
      const toolsRequested =
        cleanRequest.tools?.length || cleanRequest.functions?.length;
      const toolChoiceIsNone =
        cleanRequest.tool_choice === 'none' ||
        cleanRequest.function_call === 'none';
      // T19: pre-flight model-vs-feature gate. Only refuses calls
      // when the model is one of the well-known no-tool-support
      // family (Titan, Mixtral 8x7b, Mistral 7b, Llama 3 8b/70b,
      // Llama 3.2 1b/3b, DeepSeek-R1). Other gating (vision,
      // reasoning, caching) is left to upstream because Bedrock's
      // errors for those are usually clear.
      if (toolsRequested && !toolChoiceIsNone) {
        assertModelSupportsFeatures(model.model, { tools: true });
      }
      let tools =
        toolsRequested && !toolChoiceIsNone
          ? this.convertTools(cleanRequest)
          : undefined;
      // T12: `response_format: json_schema` → synthetic Converse tool
      // with the schema as `inputSchema.json`. Forces the model to
      // emit JSON conforming to the schema; the response side unwraps
      // the synthetic toolUse into `message.content` so the OpenAI
      // caller sees the JSON string they asked for.
      const structured = applyConverseStructuredOutput(cleanRequest, tools);
      tools = structured.tools;
      injectCachePoints(messages, system, tools, passthrough);

      requestBody = {
        modelId: model.model,
        inferenceConfig: {
          topP: cleanRequest.top_p ?? undefined,
          maxTokens:
            cleanRequest.max_completion_tokens ??
            cleanRequest.max_tokens ??
            undefined,
          stopSequences: cleanRequest.stop
            ? Array.isArray(cleanRequest.stop)
              ? cleanRequest.stop
              : [cleanRequest.stop]
            : undefined,
          temperature: cleanRequest.temperature ?? undefined,
        },
        performanceConfig: connection.config?.performanceConfig
          ? {
              latency: connection.config.performanceConfig.latency,
            }
          : undefined,
        // T21: apply the connection-level Bedrock Guardrails config to
        // every Converse call. Default `trace: 'enabled'` so the
        // response carries assessments the audit pipeline can read.
        guardrailConfig: connection.config?.guardrailConfig
          ? {
              guardrailIdentifier:
                connection.config.guardrailConfig.guardrailIdentifier,
              guardrailVersion:
                connection.config.guardrailConfig.guardrailVersion,
              trace: connection.config.guardrailConfig.trace ?? 'enabled',
            }
          : undefined,
        messages,
        system,
        toolConfig:
          tools && tools.length > 0
            ? {
                tools,
                toolChoice: structured.applied
                  ? structured.toolChoice
                  : this.convertToolChoice(cleanRequest),
              }
            : undefined,
        // SDK types `additionalModelRequestFields` as smithy
        // `DocumentType`, but at runtime it's any JSON-serialisable
        // object — the SDK forwards it verbatim into the model
        // payload. Cast through unknown to widen.
        ...(additionalModelRequestFields
          ? {
              additionalModelRequestFields:
                additionalModelRequestFields as unknown as ConverseCommandInput['additionalModelRequestFields'],
            }
          : {}),
      };
      this.logger.info({ requestBody }, 'AI Provider request body');

      if (cleanRequest.stream) {
        const stream = await client.send(
          new ConverseStreamCommand(requestBody),
          { abortSignal: composeAbortSignal(options) }
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
          // Pass `requestBody` so any throw inside `convertStream`
          // (model-stream / throttling / validation events received
          // mid-stream) attaches the same `providerRequestPayload`
          // the non-streaming error path attaches. Without this the
          // audit row's `providerRequestPayload` stays null for the
          // very errors Phase 11 most needs to debug.
          data: this.convertStream(stream, model, requestBody),
          headers: {
            'x-request-id': stream.$metadata.requestId,
          },
          providerRequestPayload: requestBody,
        };
      } else {
        const response = await client.send(new ConverseCommand(requestBody), {
          abortSignal: composeAbortSignal(options),
        });
        const id =
          response.$metadata.extendedRequestId ?? `awsbedrock-${uuidv4()}`;

        let content = '';
        const toolCalls: ChatCompletionMessageToolCall[] = [];
        let reasoning:
          | { thinking?: string; signature?: string; redacted?: string[] }
          | undefined;
        for (const item of response.output?.message?.content ?? []) {
          if (item.text) {
            content += item.text;
          } else if (item.toolUse && item.toolUse.name && item.toolUse.input) {
            // T12: unwrap the synthetic structured-output tool — the
            // OpenAI caller asked for `response_format: json_schema`,
            // they expect the JSON in `message.content` not a
            // tool_calls array.
            if (item.toolUse.name === CONVERSE_STRUCTURED_OUTPUT_TOOL_NAME) {
              content +=
                typeof item.toolUse.input === 'string'
                  ? item.toolUse.input
                  : JSON.stringify(item.toolUse.input);
            } else {
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
            }
          } else if (item.reasoningContent) {
            // Append reasoning text to the dedicated reasoning channel
            // instead of folding it into `content`. Surfacing as a
            // `message.reasoning` extension lets the audit pipeline
            // and the Anthropic / Responses converters round-trip it
            // back into a thinking block on the way out.
            const reasoningText = item.reasoningContent.reasoningText;
            if (reasoningText?.text) {
              reasoning ??= { thinking: '' };
              reasoning.thinking =
                (reasoning.thinking ?? '') + reasoningText.text;
              if (reasoningText.signature) {
                reasoning.signature = reasoningText.signature;
              }
            } else if (
              (item.reasoningContent as { redactedContent?: Uint8Array })
                .redactedContent
            ) {
              const data = (
                item.reasoningContent as { redactedContent?: Uint8Array }
              ).redactedContent;
              if (data) {
                reasoning ??= { thinking: '' };
                reasoning.redacted ??= [];
                reasoning.redacted.push(Buffer.from(data).toString('base64'));
              }
            }
          }
        }

        const message: Record<string, unknown> = {
          role: 'assistant',
          content,
          refusal: null,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        };
        if (reasoning) {
          message.reasoning = reasoning;
        }

        // T12: structured output collapses Bedrock's `tool_use` stop
        // reason to OpenAI's `stop` — the caller didn't ask for tool
        // calling, they asked for a JSON-schema response.
        const finishReason: ChatCompletion.Choice['finish_reason'] =
          structured.applied && response.stopReason === 'tool_use'
            ? 'stop'
            : response.stopReason
            ? STOP_REASONS_MAP[response.stopReason]
            : 'stop';
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
                message: message as unknown as ChatCompletion.Choice['message'],
                finish_reason: finishReason,
              },
            ],
          },
          headers: extractConverseTraceHeaders(response),
          providerRequestPayload: requestBody,
        };
      }
    } catch (error) {
      if (error instanceof CompletionError) {
        if (
          error.data.providerRequestPayload === undefined &&
          requestBody !== undefined
        ) {
          error.data.providerRequestPayload = requestBody;
        }
        throw error;
      }

      this.handleError(error, requestBody);
    }
  }

  /**
   * Native dispatch — sends a fully-built `ConverseCommandInput` to
   * Bedrock and returns the native AWS SDK response (or a
   * raw-stream-events iterable for streaming) verbatim.
   *
   * Used by sibling format-specific provider classes that build
   * Converse input directly (Anthropic / Responses → Converse) so
   * those paths skip the OpenAI ChatCompletion pivot. The existing
   * `completion()` method is left in place as the canonical
   * ChatCompletion ↔ Converse implementation.
   *
   * Mid-stream AWS exceptions (`internalServerException`,
   * `validationException`, etc.) are thrown as `CompletionError`s with
   * `providerRequestPayload` attached — the audit-row invariant
   * (`Phase 11`) holds across all three direct paths.
   */
  async dispatchConverseRaw(
    input: ConverseCommandInput,
    streaming: boolean,
    connection: AIConnectionEntity<AWSBedrockAIConnectionConfig>,
    options?: CompletionRequestOptions
  ): Promise<{
    data: ConverseCommandOutput | AsyncIterable<ConverseStreamOutput>;
    headers: { 'x-request-id'?: string };
    providerRequestPayload: ConverseCommandInput;
  }> {
    const client = await this.createClient(connection);
    this.logger.info({ requestBody: input }, 'Bedrock Converse request body');
    try {
      if (streaming) {
        const stream = await client.send(new ConverseStreamCommand(input), {
          abortSignal: composeAbortSignal(options),
        });
        if (!stream.stream) {
          throw new CompletionError({
            message: 'Failed to start the Bedrock Converse stream',
            rate: false,
            retryable: false,
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            failureReason: 'Failed to start the stream',
            openAICompatibleError: {
              code: 'aws_bedrock_failed_to_start_stream',
            },
            providerRequestPayload: input,
          });
        }
        return {
          data: this.iterateConverseStream(stream, input),
          headers: { 'x-request-id': stream.$metadata.requestId },
          providerRequestPayload: input,
        };
      }
      const response = await client.send(new ConverseCommand(input), {
        abortSignal: composeAbortSignal(options),
      });
      return {
        data: response,
        headers: extractConverseTraceHeaders(response),
        providerRequestPayload: input,
      };
    } catch (error) {
      if (error instanceof CompletionError) {
        if (error.data.providerRequestPayload === undefined) {
          error.data.providerRequestPayload = input;
        }
        throw error;
      }
      this.handleError(error, input);
    }
  }

  /**
   * Wrap `ConverseStreamCommandOutput.stream` in an async generator
   * that surfaces mid-stream AWS exceptions as `CompletionError`s
   * with `providerRequestPayload` attached. The format-specific
   * Converse-stream-to-X converter consumes the yielded
   * `ConverseStreamOutput` items.
   */
  private async *iterateConverseStream(
    output: ConverseStreamCommandOutput,
    requestBody: ConverseCommandInput
  ): AsyncIterable<ConverseStreamOutput> {
    if (!output.stream) return;
    for await (const item of output.stream) {
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
            item.throttlingException,
          requestBody
        );
      }
      yield item;
    }
  }

  /**
   * Public per-format helper exposing the same usage normalisation the
   * dispatcher's ChatCompletion path uses, so direct Anthropic↔Converse
   * and Responses↔Converse adapters in sibling files can reuse it
   * without re-implementing the cache-token field mapping.
   */
  normaliseUsage(usage: TokenUsage | undefined) {
    return this.convertUsage(usage);
  }

  private async *convertStream(
    { stream, $metadata }: ConverseStreamCommandOutput,
    model: AIResourceModelConfigEntity,
    /**
     * The wire request body the SDK sent. Threaded in so the
     * `handleError` calls below attach `providerRequestPayload` —
     * Phase 11's invariant that the wire body is available on every
     * error path was previously violated for streaming-side errors.
     */
    requestBody: unknown
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
            item.throttlingException,
          requestBody
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
                },
              ],
            },
            finish_reason: null,
          };
        } else if (item.contentBlockDelta.delta?.reasoningContent) {
          // T13: surface streaming reasoning deltas via the
          // `delta.reasoning` extension (mirrors what the
          // Anthropic↔OpenAI adapter does on the native SDK stream).
          // Without this branch, Chat→Converse streams silently drop
          // mid-stream thinking text — even though the non-streaming
          // path of the same converter preserves it.
          const rc = item.contentBlockDelta.delta.reasoningContent as {
            text?: string;
            signature?: string;
            redactedContent?: Uint8Array;
          };
          const reasoningDelta: {
            thinking?: string;
            signature?: string;
            redacted?: string[];
          } = {};
          if (rc.text) reasoningDelta.thinking = rc.text;
          if (rc.signature) reasoningDelta.signature = rc.signature;
          if (rc.redactedContent) {
            const buf = Buffer.isBuffer(rc.redactedContent)
              ? rc.redactedContent
              : Buffer.from(rc.redactedContent);
            reasoningDelta.redacted = [buf.toString('base64')];
          }
          if (Object.keys(reasoningDelta).length > 0) {
            chunk.choices[0] = {
              index: 0,
              delta: {
                role: 'assistant',
                // `reasoning` is an OpenAI extension on `delta` —
                // strict OpenAI clients ignore it, native consumers
                // (and the audit pipeline) read it.
                reasoning: reasoningDelta,
              } as unknown as ChatCompletionChunk.Choice['delta'],
              finish_reason: null,
            };
          }
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
      | unknown,
    providerRequestPayload?: unknown
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
        providerRequestPayload,
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
        providerRequestPayload,
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
        providerRequestPayload,
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
        providerRequestPayload,
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
        providerRequestPayload,
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
      openAICompatibleError: {
        code: 'unknown_error',
      },
      providerRequestPayload,
    });
  }

  /**
   * Build the `additionalModelRequestFields` blob Bedrock Converse
   * uses to pass provider-specific knobs that aren't first-class on
   * the Converse request shape — `top_k`, `anthropic_beta`, etc.
   *
   * Sources for these fields:
   *   - The OpenAI body's `top_k` extension (some clients send it
   *     alongside `top_p`, even though OpenAI itself ignores it).
   *   - The Anthropic ↔ OpenAI converter's `__vmx_passthrough.anthropic`
   *     envelope (thinking, top_k for `format:'anthropic'`).
   *
   * NOTE: `cache_control` markers are NOT placed here — Converse expects
   * per-block `cachePoint` content blocks inside `messages[]` /
   * `system[]` / `tools[]`. See `injectCachePoints` on the request body.
   *
   * Returns `undefined` when no provider-specific knobs apply, so the
   * Converse request stays minimal in the common case.
   */
  private buildAdditionalModelFields(
    request: ChatCompletionCreateParams,
    passthrough: AnthropicPassthrough | undefined
  ): Record<string, unknown> | undefined {
    const fields: Record<string, unknown> = {};
    const topK = (request as { top_k?: number }).top_k ?? passthrough?.top_k;
    if (typeof topK === 'number') {
      fields.top_k = topK;
    }
    if (passthrough?.thinking) {
      fields.thinking = passthrough.thinking;
    }
    return Object.keys(fields).length > 0 ? fields : undefined;
  }

  private convertUsage(usage?: TokenUsage) {
    if (!usage) {
      return undefined;
    }

    // Surface Bedrock's `cacheWriteInputTokens` via the same OpenAI
    // extension field the Bedrock-Invoke / native Anthropic providers
    // populate. CompletionService picks this up to drive the
    // cache-creation cost line and audit row.
    const promptTokensDetails: Record<string, unknown> = {
      cached_tokens: usage.cacheReadInputTokens ?? 0,
    };
    if (usage.cacheWriteInputTokens != null) {
      promptTokensDetails.cache_creation_input_tokens =
        usage.cacheWriteInputTokens;
    }

    return {
      completion_tokens: usage.outputTokens ?? 0,
      prompt_tokens: usage.inputTokens ?? 0,
      total_tokens: usage.totalTokens ?? 0,
      prompt_tokens_details: promptTokensDetails,
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
          // SSRF guard: only allow `https://`, `http://` (limited),
          // and `data:` schemes. Reject `file:`, `gopher:`, `javascript:`,
          // `localhost`, RFC1918 private IPs, and IMDS metadata
          // endpoints. The gateway runs server-side, so any URL the
          // client supplies becomes an outbound fetch from our
          // infrastructure — without a guard a malicious client could
          // probe internal services or AWS metadata.
          assertSafeOutboundUrl(part.image_url.url, {
            messageIndex,
            contentPartIndex,
          });
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
          // Bedrock Converse `Document.source` accepts raw bytes,
          // S3 location, plain text, or structured content. The
          // previous implementation base64-decoded `file_data` and
          // dropped it into `text`, which round-trips through a UTF-8
          // string and corrupts every byte that isn't valid UTF-8 —
          // i.e. essentially every PDF, DOCX, image, etc. This now
          // routes binary documents to the SDK's `BytesMember` (the
          // SDK re-encodes base64 itself) and only uses `TextMember`
          // when the data URL is explicitly text-shaped.
          const fileData = part.file.file_data;
          const filename = part.file.filename;
          const dataUrlMatch = fileData
            ? /^data:([^;]+);base64,(.+)$/.exec(fileData)
            : null;
          let source: DocumentSource;
          let format: DocumentBlock['format'];
          if (dataUrlMatch) {
            const [, mediaType, base64] = dataUrlMatch;
            const bytes = Buffer.from(base64, 'base64');
            if (mediaType.startsWith('text/')) {
              source = {
                text: bytes.toString('utf-8'),
              } as DocumentSource.TextMember;
            } else {
              source = {
                bytes: new Uint8Array(bytes),
              } as DocumentSource.BytesMember;
              format = inferDocumentFormat(filename, mediaType);
            }
          } else if (fileData) {
            // Bare base64 string (no data URL prefix) — treat as
            // binary by default. Filename extension (when present)
            // tells Bedrock how to parse it.
            const bytes = Buffer.from(fileData, 'base64');
            source = {
              bytes: new Uint8Array(bytes),
            } as DocumentSource.BytesMember;
            format = inferDocumentFormat(filename);
          } else {
            // No data — likely an `file_id` reference. Bedrock has
            // no equivalent storage layer; surface the error
            // explicitly rather than dropping silently.
            throw new CompletionError({
              message:
                'AWS Bedrock Converse does not support file_id references — provide file_data (base64) or a data URL',
              rate: false,
              retryable: false,
              statusCode: HttpStatus.BAD_REQUEST,
              failureReason:
                'Bedrock requires inline file_data; file_id is not supported',
              openAICompatibleError: {
                code: 'aws_bedrock_file_id_unsupported',
                param: `messages[${messageIndex}].content[${contentPartIndex}]`,
              },
            });
          }
          blocks.push({
            document: {
              name: filename,
              context: part.file.file_id,
              format,
              source,
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
        ? new Set(
            request.tool_choice.allowed_tools.tools
              .map((tool) => tool.name as string)
              .filter((name) => name !== undefined)
          )
        : undefined;

    // When `tool_choice.type === 'allowed_tools'` is set, only the
    // named tools should be forwarded to Bedrock. Reads cleaner as
    // "skip if there's an allowlist and this tool isn't on it" than
    // the previous nested ternary.
    const isAllowed = (name: string | undefined): boolean =>
      !allowedTools || (name !== undefined && allowedTools.has(name));

    const tools: Tool[] = [];

    for (const tool of request.tools || []) {
      if (tool.type !== 'function' || !tool.function.name) continue;
      if (!isAllowed(tool.function.name)) continue;

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

    for (const tool of request.functions || []) {
      if (!tool.name || !isAllowed(tool.name)) continue;

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
}
