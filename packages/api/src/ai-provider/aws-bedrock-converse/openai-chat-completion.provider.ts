import { HttpStatus, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type {
  ChatCompletion,
  ChatCompletionAssistantMessageParam,
  ChatCompletionChunk,
  ChatCompletionCreateParams,
  ChatCompletionDeveloperMessageParam,
  ChatCompletionFunctionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionToolMessageParam,
  ChatCompletionUserMessageParam,
} from 'openai/resources/index.js';
import {
  ContentBlock,
  ConverseCommandInput,
  ConverseCommandOutput,
  ConverseStreamOutput,
  DocumentBlock,
  DocumentFormat,
  DocumentSource,
  Message,
  OutputFormatType,
  StopReason,
  Tool,
  ToolChoice,
  ToolInputSchema,
  type OutputConfig,
} from '@aws-sdk/client-bedrock-runtime';
import { v4 as uuidv4 } from 'uuid';
import type { DocumentType } from '@smithy/types';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import {
  CompletionRequestOptions,
  OpenAICompletionResponse,
} from '../ai-provider.types';
import { CompletionError } from '../../gateway/completion.types';
import {
  takePassthroughEnvelope,
  type AnthropicPassthrough,
} from '../passthrough.helpers';
import { assertSafeOutboundUrl } from '../url-safety';
import { modelSupportsOutputConfig } from '../adapters/anthropic-messages.adapter';
import { reasoningEffortToBudget } from '../adapters/anthropic-reasoning';
import { assertModelSupportsFeatures } from './capability-gate';
import {
  AWSBedrockAIConnectionConfig,
  AWSBedrockConverseDispatcher,
  ConverseSystemBlock,
  DEFAULT_CONVERSE_TOOL_INPUT_SCHEMA,
  extractConverseTraceHeaders,
  inferConverseImageFormat,
  injectCachePoints,
} from './shared';

/**
 * Bedrock Converse handler for OpenAI Chat Completions input — direct
 * Chat ↔ Converse converter pair. The shared dispatcher only owns the
 * raw SDK call + AWS exception mapping (`dispatchConverseRaw`); all the
 * Chat-Completions-specific request shaping, structured-output shim,
 * passthrough handling, response unwinding, and stream conversion lives
 * here so siblings that speak Anthropic / Responses on the wire don't
 * pay the cost of importing it.
 *
 * Mapping summary:
 *
 *   Request  ChatCompletion → Converse
 *     system / developer messages → system[]: [{text: ...}]
 *     user / assistant messages   → messages[] with content blocks
 *       text part                 → text block
 *       image_url (URL or data:)  → image block (fetched server-side
 *                                   when URL-source; SSRF-guarded)
 *       file (PDF / docx / text)  → document block (bytes or text source)
 *       input_audio               → 400 (unsupported)
 *     tool messages               → toolResult block coalesced into
 *                                   the previous tool-result-bearing
 *                                   user message, else new user turn
 *     assistant.tool_calls        → toolUse blocks on assistant message
 *     tools (function)            → toolConfig.tools[].toolSpec
 *     tool_choice                 → toolConfig.toolChoice
 *     response_format: json_schema→ synthetic `__vmx_structured_output__`
 *                                   tool forcing a JSON-schema-shaped
 *                                   tool call (T12)
 *     top_k / thinking            → additionalModelRequestFields
 *     cache_control breakpoints   → cachePoint blocks via injectCachePoints
 *
 *   Response  Converse → ChatCompletion
 *     content.text                → message.content
 *     content.toolUse             → message.tool_calls[] (or unwrap
 *                                   `__vmx_structured_output__` into
 *                                   message.content)
 *     content.reasoningContent    → message.reasoning extension
 *     stopReason                  → finish_reason (via STOP_REASONS_MAP;
 *                                   structured-output collapses tool_use
 *                                   → 'stop')
 *     usage                       → prompt/completion/total + cache details
 */

// ─── Constants + shared CC-specific helpers ─────────────────────────

/**
 * Converse → OpenAI Chat finish_reason. Same table the Bedrock-Invoke
 * path uses with one twist: `GUARDRAIL_INTERVENED` maps to
 * `content_filter` rather than `stop` so audit can distinguish a
 * policy block from a normal turn end.
 */
const STOP_REASONS_MAP: Record<
  StopReason,
  ChatCompletion.Choice['finish_reason']
> = {
  [StopReason.CONTENT_FILTERED]: 'content_filter',
  [StopReason.END_TURN]: 'stop',
  [StopReason.GUARDRAIL_INTERVENED]: 'content_filter',
  [StopReason.MALFORMED_MODEL_OUTPUT]: 'stop',
  [StopReason.MALFORMED_TOOL_USE]: 'tool_calls',
  [StopReason.MAX_TOKENS]: 'length',
  [StopReason.MODEL_CONTEXT_WINDOW_EXCEEDED]: 'length',
  [StopReason.STOP_SEQUENCE]: 'stop',
  [StopReason.TOOL_USE]: 'tool_calls',
};

/**
 * Sentinel name used by the Chat→Converse structured-output shim
 * (T12) — mirrors the same value the Anthropic adapter uses so a
 * structured-output round-trip through either path looks identical
 * from the audit row's perspective.
 */
export const CONVERSE_STRUCTURED_OUTPUT_TOOL_NAME = '__vmx_structured_output__';

/**
 * Translate OpenAI's `response_format: { type: 'json_schema' }` into a
 * Converse-native structured output. Bedrock exposes
 * `outputConfig.textFormat = { type: 'json_schema', structure: { jsonSchema } }`
 * directly on modern Claude models (4.5+), so we prefer that — it's
 * lossless, doesn't burn a tool slot, and keeps `finish_reason` as
 * `stop` instead of pretending the model called a tool. Older Claude
 * 3.x / 4.0 / 4.1 and non-Claude families (Nova, Mistral, Llama,
 * Titan, DeepSeek) fall back to the synthetic-tool shim — the model
 * "calls" a sentinel tool whose `inputSchema.json` is the schema; the
 * response side unwraps the toolUse back into `message.content`.
 *
 * Returns a discriminated union the caller plumbs into the wire body:
 *   - `kind: 'native'` → set `input.outputConfig`, leave tools alone.
 *   - `kind: 'tool'`   → append the synthetic tool + pin tool_choice.
 *   - `kind: 'none'`   → caller didn't request structured output.
 */
export type ConverseStructuredOutputResult =
  | { kind: 'none' }
  | { kind: 'native'; outputConfig: OutputConfig }
  | {
      kind: 'tool';
      tools: Tool[];
      toolChoice: ToolChoice;
    };

export function applyConverseStructuredOutput(
  request: ChatCompletionCreateParams,
  modelId: string,
  tools: Tool[] | undefined
): ConverseStructuredOutputResult {
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
    return { kind: 'none' };
  }

  // Native path: Bedrock's `outputConfig.textFormat` constrains output
  // to a JSON schema for models that support it. `JsonSchemaDefinition.schema`
  // is wire-typed as a *string*, so we stringify the caller's schema
  // object before handing it to the SDK.
  if (modelSupportsOutputConfig(modelId)) {
    return {
      kind: 'native',
      outputConfig: {
        textFormat: {
          type: OutputFormatType.JSON_SCHEMA,
          structure: {
            jsonSchema: {
              name: jsonSchema.name,
              description: jsonSchema.description,
              schema: JSON.stringify(jsonSchema.schema),
            },
          },
        },
      },
    };
  }

  // Fallback: synthetic-tool shim.
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
    kind: 'tool',
    tools: [...(tools ?? []), synthetic],
    toolChoice: {
      tool: { name: CONVERSE_STRUCTURED_OUTPUT_TOOL_NAME },
    } as ToolChoice,
  };
}

/**
 * Map MIME type / data-URL header / fetch response Content-Type onto
 * Bedrock's `ImageFormat` enum. Re-exported from `shared.ts` so the
 * Responses sibling cell uses the same mapping; declared as a local
 * alias here to keep the existing call sites unchanged.
 */
const inferImageFormat = inferConverseImageFormat;

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

// ─── Request side: ChatCompletion → Converse ────────────────────────

type BuildConverseRequestParams = {
  request: ChatCompletionCreateParams;
  model: AIResourceModelConfigEntity;
  connection: AIConnectionEntity<AWSBedrockAIConnectionConfig>;
  logger: PinoLogger;
};

type BuildConverseRequestResult = {
  input: ConverseCommandInput;
  /** Whether the structured-output shim was applied (response side checks this to collapse `tool_use` → `stop`). */
  structuredOutputApplied: boolean;
};

async function buildConverseRequest({
  request,
  model,
  connection,
  logger,
}: BuildConverseRequestParams): Promise<BuildConverseRequestResult> {
  const { body: cleanRequest, anthropic: passthrough } =
    takePassthroughEnvelope(request);

  const additionalModelRequestFields = buildAdditionalModelFields(
    cleanRequest,
    passthrough
  );
  const messages = await convertChatMessagesToConverse(cleanRequest, logger);
  const system = cleanRequest.messages
    .filter((m) => m.role === 'system' || m.role === 'developer')
    .map(
      (m) =>
        ({
          text:
            typeof m.content === 'string'
              ? m.content
              : m.content.map((part) => part.text).join('\n'),
        } as ConverseSystemBlock)
    );

  // T11: `tool_choice: 'none'` has no native Converse equivalent. Strip
  // tools entirely so the model can't call any.
  const toolsRequested =
    cleanRequest.tools?.length || cleanRequest.functions?.length;
  const toolChoiceIsNone =
    cleanRequest.tool_choice === 'none' ||
    cleanRequest.function_call === 'none';
  if (toolsRequested && !toolChoiceIsNone) {
    assertModelSupportsFeatures(model.model, { tools: true });
  }
  let tools =
    toolsRequested && !toolChoiceIsNone
      ? convertChatToolsToConverse(cleanRequest)
      : undefined;
  // Bedrock rejects any request whose `messages[]` carries `toolUse` /
  // `toolResult` blocks unless `toolConfig.tools[]` is also present —
  // even when the caller has no intent to invoke a tool on this turn
  // (multi-turn tool-result-followup is the canonical case). Neither
  // OpenAI nor Anthropic require this redeclaration, so the caller
  // legitimately omits `tools` on continuation turns. Synthesise
  // placeholder specs from the historical toolUse names so the
  // validator's pairing check passes; the model already knows the
  // tools from its earlier turn so descriptions / schemas aren't load
  // bearing.
  let toolsSynthesizedForHistory = false;
  if (!tools || tools.length === 0) {
    const historicalToolNames = collectHistoricalToolNames(messages);
    if (historicalToolNames.length > 0) {
      tools = historicalToolNames.map((name) => ({
        toolSpec: {
          name,
          inputSchema: {
            json: DEFAULT_CONVERSE_TOOL_INPUT_SCHEMA,
          } as ToolInputSchema.JsonMember,
        },
      }));
      toolsSynthesizedForHistory = true;
    }
  }
  // T12: response_format: json_schema → prefer Converse's native
  // `outputConfig.textFormat` (modern Claudes); fall back to a synthetic
  // tool whose `inputSchema.json` is the schema on models that don't
  // support the native path.
  const structured = applyConverseStructuredOutput(
    cleanRequest,
    model.model,
    tools
  );
  let outputConfig: OutputConfig | undefined;
  let structuredOutputApplied = false;
  if (structured.kind === 'tool') {
    tools = structured.tools;
    structuredOutputApplied = true;
  } else if (structured.kind === 'native') {
    outputConfig = structured.outputConfig;
  }
  injectCachePoints(messages, system, tools, passthrough);

  const inferenceConfig: ConverseCommandInput['inferenceConfig'] = {
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
  };
  // Anthropic on Bedrock rejects `temperature !== 1` whenever extended
  // thinking is enabled, and requires `max_tokens > thinking.budget_tokens`.
  // Mirrors the same enforcement the Anthropic-direct sibling applies in
  // `applyOpenAIExtras` — without this the model rejects every
  // `reasoning_effort` request that doesn't happen to also bump
  // temperature to 1 and max_tokens above the budget.
  const thinkingField = (
    additionalModelRequestFields as
      | { thinking?: { type?: string; budget_tokens?: number } }
      | undefined
  )?.thinking;
  if (thinkingField?.type === 'enabled') {
    delete inferenceConfig.temperature;
    if (
      typeof thinkingField.budget_tokens === 'number' &&
      typeof inferenceConfig.maxTokens === 'number' &&
      inferenceConfig.maxTokens <= thinkingField.budget_tokens
    ) {
      inferenceConfig.maxTokens = thinkingField.budget_tokens + 256;
    }
  }

  const input: ConverseCommandInput = {
    modelId: model.model,
    inferenceConfig,
    performanceConfig: connection.config?.performanceConfig
      ? { latency: connection.config.performanceConfig.latency }
      : undefined,
    guardrailConfig: connection.config?.guardrailConfig
      ? {
          guardrailIdentifier:
            connection.config.guardrailConfig.guardrailIdentifier,
          guardrailVersion: connection.config.guardrailConfig.guardrailVersion,
          trace: connection.config.guardrailConfig.trace ?? 'enabled',
        }
      : undefined,
    messages,
    system,
    toolConfig:
      tools && tools.length > 0
        ? {
            tools,
            // Synthesised-from-history tools don't have a real
            // tool_choice intent — let Bedrock default to auto rather
            // than re-emitting whatever choice the caller sent on the
            // original turn (which may have been pinned to a specific
            // tool name we no longer have a definition for).
            toolChoice:
              structured.kind === 'tool'
                ? structured.toolChoice
                : toolsSynthesizedForHistory
                ? undefined
                : convertChatToolChoiceToConverse(cleanRequest),
          }
        : undefined,
    ...(outputConfig ? { outputConfig } : {}),
    ...(additionalModelRequestFields
      ? {
          additionalModelRequestFields:
            additionalModelRequestFields as DocumentType,
        }
      : {}),
  };

  return { input, structuredOutputApplied };
}

/**
 * Build the `additionalModelRequestFields` blob Bedrock Converse uses
 * to pass provider-specific knobs that aren't first-class on Converse
 * — `top_k`, `anthropic_beta`, `thinking`, etc.
 *
 * NOTE: `cache_control` markers are NOT placed here — Converse expects
 * per-block `cachePoint` content blocks inside `messages[]` / `system[]`
 * / `tools[]`. See `injectCachePoints` for that path.
 */
function buildAdditionalModelFields(
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
  } else if (request.reasoning_effort) {
    // The Anthropic-direct + Converse-Responses siblings already map
    // OpenAI's `reasoning_effort` to Claude's `thinking.budget_tokens`.
    // Without this mapping the Chat→Converse path silently dropped the
    // hint — the model ran without extended thinking enabled despite
    // the caller explicitly asking for it.
    const budget = reasoningEffortToBudget(
      request.reasoning_effort,
      request.max_completion_tokens ?? request.max_tokens ?? undefined
    );
    if (budget != null) {
      fields.thinking = { type: 'enabled', budget_tokens: budget };
    }
  }
  return Object.keys(fields).length > 0 ? fields : undefined;
}

async function convertChatMessagesToConverse(
  request: ChatCompletionCreateParams,
  logger: PinoLogger
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
        content: ensureNonEmptyContent(
          await convertChatMessageParts(message, messageIndex, logger)
        ),
      });
    } else if (message.role === 'assistant') {
      messages.push({
        role: 'assistant',
        content: ensureNonEmptyContent(
          await convertChatMessageParts(message, messageIndex, logger)
        ),
      });
    } else if (message.role === 'tool' || message.role === 'function') {
      // `function` role is the deprecated single-tool-call sibling of
      // `tool`. Both map to a Converse `toolResult` block on the next
      // user turn — coalesce with the previous tool-result-bearing
      // message when present so consecutive tool replies for the same
      // turn become one user message (Bedrock requires alternating
      // roles and rejects two user turns in a row).
      const lastMessage = messages[messages.length - 1];
      if (
        lastMessage &&
        (lastMessage.content ?? []).some((block) => block.toolResult)
      ) {
        lastMessage.content = [
          ...(lastMessage.content ?? []),
          ...(await convertChatMessageParts(message, messageIndex, logger)),
        ];
      } else {
        messages.push({
          role: 'user',
          content: ensureNonEmptyContent(
            await convertChatMessageParts(message, messageIndex, logger)
          ),
        });
      }
    }
  }
  return messages;
}

/**
 * Bedrock Converse rejects messages with an empty `content` array
 * (`ValidationException: content must contain at least one block`). A
 * caller can legitimately produce one via:
 *   - assistant turn with refusal-only content + no tool_calls
 *   - assistant turn with content === null and no tool_calls
 *   - user turn with content === [] (defensive client)
 * Substitute a placeholder text block so the turn survives the
 * validator while preserving position in the conversation history.
 */
function ensureNonEmptyContent(blocks: ContentBlock[]): ContentBlock[] {
  if (blocks.length === 0) return [{ text: '(no content)' }];
  return blocks;
}

async function convertChatMessageParts(
  message:
    | ChatCompletionUserMessageParam
    | ChatCompletionDeveloperMessageParam
    | ChatCompletionAssistantMessageParam
    | ChatCompletionToolMessageParam
    | ChatCompletionFunctionMessageParam,
  messageIndex: number,
  logger: PinoLogger
): Promise<ContentBlock[]> {
  const blocks: ContentBlock[] = [];
  if (
    message.role === 'assistant' &&
    (message.tool_calls?.length || message.function_call)
  ) {
    // Assistant turns can mix inline text + tool_calls (the model may
    // think out loud, then call a tool). Emit the text block first so
    // Bedrock sees the same ordering OpenAI does, then the toolUse
    // blocks. Skipping the text here drops half the assistant turn.
    if (typeof message.content === 'string' && message.content.length > 0) {
      blocks.push({ text: message.content });
    } else if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type === 'text' && part.text.length > 0) {
          blocks.push({ text: part.text });
        }
      }
    }
    for (const toolCall of message.tool_calls ?? []) {
      if (toolCall.type === 'function') {
        blocks.push({
          toolUse: {
            name: toolCall.function.name,
            input: parseToolArguments(toolCall.function.arguments),
            toolUseId: toolCall.id,
          },
        });
      } else if (toolCall.type === 'custom') {
        blocks.push({
          toolUse: {
            name: toolCall.custom.name,
            input: parseToolArguments(toolCall.custom.input),
            toolUseId: toolCall.id,
          },
        });
      }
    }
    if (message.function_call) {
      // Bedrock requires a non-empty `toolUseId` on every toolUse block
      // and the matching ID on the paired toolResult. The legacy
      // `function_call` / `function` role pair carries no ID — synthesize
      // a stable correlation token derived from the function name so the
      // pairing survives the deprecated shape. Validation 400 otherwise.
      blocks.push({
        toolUse: {
          name: message.function_call.name,
          input: parseToolArguments(message.function_call.arguments),
          toolUseId: `legacy_fn_${message.function_call.name}`,
        },
      });
    }
  } else if (message.role === 'tool') {
    const toolContent: ContentBlock.ToolResultMember['toolResult']['content'] =
      typeof message.content === 'string'
        ? message.content.length > 0
          ? [{ text: message.content }]
          : [{ text: '(empty)' }]
        : message.content.length > 0
        ? message.content.map((part) => ({ text: part.text }))
        : [{ text: '(empty)' }];
    blocks.push({
      toolResult: {
        toolUseId: message.tool_call_id,
        content: toolContent,
      },
    });
  } else if (message.role === 'function') {
    // Pair with the synthesized id from the legacy assistant
    // `function_call` branch above so the toolResult round-trips
    // cleanly through Bedrock's pairing validator.
    blocks.push({
      toolResult: {
        toolUseId: `legacy_fn_${message.name}`,
        content:
          message.content && message.content.length > 0
            ? [{ text: message.content }]
            : [{ text: '(empty)' }],
      },
    });
  } else if (
    typeof message.content === 'string' &&
    message.content.length > 0
  ) {
    blocks.push({ text: message.content });
  } else if (Array.isArray(message.content)) {
    for (
      let contentPartIndex = 0;
      contentPartIndex < message.content.length;
      contentPartIndex++
    ) {
      const part = message.content[contentPartIndex];
      if (part.type === 'text') {
        blocks.push({ text: part.text });
      } else if (part.type === 'image_url') {
        // Data URLs encode the bytes inline and don't reach the
        // network, so they bypass the SSRF guard. The MIME on the
        // data-URL header is also the most reliable format signal.
        const dataMatch = /^data:([^;]+);base64,(.+)$/.exec(part.image_url.url);
        if (dataMatch) {
          const [, mediaType, base64] = dataMatch;
          const format = inferImageFormat(mediaType);
          if (!format) {
            throw new CompletionError({
              message: `Unsupported image format "${mediaType}" — AWS Bedrock Converse only accepts jpeg / png / gif / webp.`,
              rate: false,
              retryable: false,
              statusCode: HttpStatus.BAD_REQUEST,
              failureReason: 'Unsupported image format',
              openAICompatibleError: {
                code: 'aws_bedrock_unsupported_image_format',
                type: 'unsupported_image_format',
                param: `messages[${messageIndex}].content[${contentPartIndex}]`,
              },
            });
          }
          blocks.push({
            image: {
              format,
              source: {
                bytes: new Uint8Array(Buffer.from(base64, 'base64')),
              },
            },
          });
          continue;
        }
        // SSRF guard before any outbound fetch — the gateway runs
        // server-side so any URL becomes a fetch from our infra.
        assertSafeOutboundUrl(part.image_url.url, {
          messageIndex,
          contentPartIndex,
        });
        try {
          const imageResponse = await fetch(part.image_url.url);
          if (!imageResponse.ok) {
            throw new Error(
              `image fetch returned HTTP ${imageResponse.status}`
            );
          }
          // Prefer the response Content-Type; fall back to the URL
          // extension (`...jpg`) since some CDNs serve images as
          // `application/octet-stream`. Bedrock rejects unknown
          // formats so be explicit when neither yields a hit.
          const contentType = imageResponse.headers.get('content-type');
          const urlPath = new URL(part.image_url.url).pathname;
          const ext = urlPath.split('.').pop()?.toLowerCase();
          const format =
            inferImageFormat(contentType ?? undefined) ?? inferImageFormat(ext);
          if (!format) {
            throw new CompletionError({
              message: `Could not determine image format for ${part.image_url.url} — AWS Bedrock Converse requires one of jpeg / png / gif / webp.`,
              rate: false,
              retryable: false,
              statusCode: HttpStatus.BAD_REQUEST,
              failureReason: 'Unknown image format',
              openAICompatibleError: {
                code: 'aws_bedrock_unknown_image_format',
                type: 'unknown_image_format',
                param: `messages[${messageIndex}].content[${contentPartIndex}]`,
              },
            });
          }
          blocks.push({
            image: {
              format,
              source: {
                bytes: new Uint8Array(await imageResponse.arrayBuffer()),
              },
            },
          });
        } catch (error) {
          if (error instanceof CompletionError) throw error;
          logger.error({ error }, 'Failed to fetch image');
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
          const bytes = Buffer.from(fileData, 'base64');
          source = {
            bytes: new Uint8Array(bytes),
          } as DocumentSource.BytesMember;
          format = inferDocumentFormat(filename);
        } else {
          // Bedrock has no `file_id` equivalent storage — surface
          // explicitly instead of dropping silently.
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
        logger.warn(
          { refusal: part.refusal, messageIndex, contentPartIndex },
          'Refusal is not supported for AWS Bedrock Converse API'
        );
      }
    }
  }
  return blocks;
}

function parseToolArguments(
  args: string
): ContentBlock.ToolUseMember['toolUse']['input'] {
  try {
    return JSON.parse(args ?? '{}');
  } catch {
    return args;
  }
}

/**
 * Walk the already-converted Converse `messages[]` and collect the
 * unique tool names referenced by any `toolUse` block. `toolResult`
 * blocks carry only the `toolUseId` (no name), so they're useful as a
 * signal that synthesis is required but not as a source of names —
 * we rely on the assistant `toolUse` turns that precede every valid
 * `toolResult`. Order-preserving + dedup so the resulting `tools[]`
 * is deterministic across runs.
 */
function collectHistoricalToolNames(messages: Message[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    for (const block of message.content ?? []) {
      const toolUseName = block.toolUse?.name;
      if (toolUseName && !seen.has(toolUseName)) {
        seen.add(toolUseName);
        names.push(toolUseName);
      }
    }
  }
  return names;
}

function convertChatToolsToConverse(
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
          json: tool.function.parameters ?? DEFAULT_CONVERSE_TOOL_INPUT_SCHEMA,
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
          json: tool.parameters ?? DEFAULT_CONVERSE_TOOL_INPUT_SCHEMA,
        } as ToolInputSchema.JsonMember,
      },
    });
  }
  return tools.length > 0 ? tools : undefined;
}

function convertChatToolChoiceToConverse(
  request: ChatCompletionCreateParams
): ToolChoice | undefined {
  if (!request.tool_choice) return undefined;
  if (request.tool_choice === 'auto' || request.function_call === 'auto') {
    // Converse's `auto` / `any` variants are empty-struct unions
    // (`AutoToolChoice = {}`, `AnyToolChoice = {}`). The Smithy
    // serializer routes the discriminant by which key is present, so
    // the value must be an object — `auto: true` would emit a boolean
    // payload the model schema rejects. Mirrors the Anthropic↔Converse
    // sibling on the same dispatcher.
    return { auto: {} };
  }
  if (request.tool_choice === 'required') {
    return { any: {} };
  }
  if (
    typeof request.tool_choice === 'object' &&
    request.tool_choice.type === 'function'
  ) {
    return { tool: { name: request.tool_choice.function.name } };
  }
  if (request.function_call && typeof request.function_call === 'object') {
    return { tool: { name: request.function_call.name } };
  }
  return undefined;
}

// ─── Response side: Converse → ChatCompletion ───────────────────────

function converseResponseToChatCompletion(
  response: ConverseCommandOutput,
  model: AIResourceModelConfigEntity,
  dispatcher: AWSBedrockConverseDispatcher,
  structuredOutputApplied: boolean
): ChatCompletion {
  const id = response.$metadata.extendedRequestId ?? `awsbedrock-${uuidv4()}`;
  let content = '';
  const toolCalls: ChatCompletionMessageToolCall[] = [];
  let reasoning:
    | { thinking?: string; signature?: string; redacted?: string[] }
    | undefined;

  for (const item of response.output?.message?.content ?? []) {
    if (item.text) {
      content += item.text;
    } else if (item.toolUse && item.toolUse.name && item.toolUse.input) {
      // T12: unwrap the synthetic structured-output tool — the caller
      // asked for `response_format: json_schema`, they expect the JSON
      // in `message.content` not a tool_calls array.
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
      const reasoningText = item.reasoningContent.reasoningText;
      if (reasoningText?.text) {
        reasoning ??= { thinking: '' };
        reasoning.thinking = (reasoning.thinking ?? '') + reasoningText.text;
        if (reasoningText.signature) {
          reasoning.signature = reasoningText.signature;
        }
      } else if (
        (item.reasoningContent as { redactedContent?: Uint8Array })
          .redactedContent
      ) {
        const data = (item.reasoningContent as { redactedContent?: Uint8Array })
          .redactedContent;
        if (data) {
          reasoning ??= { thinking: '' };
          reasoning.redacted ??= [];
          reasoning.redacted.push(Buffer.from(data).toString('base64'));
        }
      }
    }
  }

  const message: ChatCompletion.Choice['message'] & {
    reasoning?: { thinking?: string; signature?: string; redacted?: string[] };
  } = {
    role: 'assistant',
    content,
    refusal: null,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
  };
  if (reasoning) message.reasoning = reasoning;

  // T12: structured output collapses Bedrock's `tool_use` stop reason
  // to OpenAI's `stop` — the caller didn't ask for tool calling.
  const finishReason: ChatCompletion.Choice['finish_reason'] =
    structuredOutputApplied && response.stopReason === 'tool_use'
      ? 'stop'
      : response.stopReason
      ? STOP_REASONS_MAP[response.stopReason]
      : 'stop';
  return {
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    id,
    model: model.model,
    usage: dispatcher.normaliseUsage(response.usage),
    choices: [
      {
        index: 0,
        logprobs: null,
        message,
        finish_reason: finishReason,
      },
    ],
  };
}

// ─── Stream side: Converse stream → ChatCompletion chunks ───────────

async function* streamConverseToChatCompletionChunks(
  source: AsyncIterable<ConverseStreamOutput>,
  model: AIResourceModelConfigEntity,
  requestId: string | undefined,
  dispatcher: AWSBedrockConverseDispatcher,
  structuredOutputApplied = false
): AsyncIterable<ChatCompletionChunk> {
  const created = Math.floor(Date.now() / 1000);
  const id = requestId ?? `awsbedrock-${uuidv4()}`;
  // Track per-stream the block indices that belong to the synthetic
  // structured-output tool so the contentBlockDelta toolUse fragments
  // (which only carry contentBlockIndex, not the name) get re-emitted
  // as text deltas. Non-structured-output streams leave this empty.
  const structuredOutputBlockIndices = new Set<number>();
  for await (const item of source) {
    const chunk: ChatCompletionChunk = {
      object: 'chat.completion.chunk',
      model: model.model,
      id,
      created,
      choices: [],
    };

    if (item.messageStart) {
      continue;
    } else if (item.contentBlockStart?.start?.toolUse) {
      const startedToolName = item.contentBlockStart.start.toolUse.name;
      const blockIndex = item.contentBlockStart.contentBlockIndex ?? 0;
      if (
        structuredOutputApplied &&
        startedToolName === CONVERSE_STRUCTURED_OUTPUT_TOOL_NAME
      ) {
        // T12 streaming parity: the synthetic structured-output tool
        // shouldn't surface as a tool_call to the caller. Remember its
        // block index — subsequent input fragments stream as `content`
        // deltas — and skip emitting the preamble chunk.
        structuredOutputBlockIndices.add(blockIndex);
        continue;
      }
      // OpenAI's tool-call preamble is the role + the tool_calls metadata
      // (id, function.name). No inline `content` — emitting `content: ''`
      // alongside causes naive aggregators to flush an empty assistant
      // text turn ahead of the tool call.
      chunk.choices[0] = {
        index: 0,
        delta: {
          role: 'assistant',
          tool_calls: [
            {
              type: 'function',
              index: blockIndex,
              function: {
                name: startedToolName,
                arguments: '',
              },
              id: item.contentBlockStart.start.toolUse.toolUseId,
            },
          ],
        },
        finish_reason: null,
      };
    } else if (item.contentBlockDelta) {
      if (typeof item.contentBlockDelta.delta?.text === 'string') {
        // Use typeof guard so empty-string text deltas (which AWS does
        // emit on some models) still yield a chunk rather than being
        // dropped by a truthy-falsy check.
        chunk.choices[0] = {
          index: 0,
          delta: {
            content: item.contentBlockDelta.delta.text,
            role: 'assistant',
          },
          finish_reason: null,
        };
      } else if (item.contentBlockDelta.delta?.toolUse) {
        const deltaBlockIndex = item.contentBlockDelta.contentBlockIndex ?? 0;
        if (structuredOutputBlockIndices.has(deltaBlockIndex)) {
          // T12 streaming parity: re-emit synthetic-tool input
          // fragments as content deltas. The schema-shaped JSON is the
          // model's response, not a tool call.
          chunk.choices[0] = {
            index: 0,
            delta: {
              content: item.contentBlockDelta.delta.toolUse.input ?? '',
              role: 'assistant',
            },
            finish_reason: null,
          };
        } else {
          chunk.choices[0] = {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: deltaBlockIndex,
                  function: {
                    arguments: item.contentBlockDelta.delta.toolUse.input ?? '',
                  },
                },
              ],
            },
            finish_reason: null,
          };
        }
      } else if (item.contentBlockDelta.delta?.reasoningContent) {
        // T13: surface streaming reasoning deltas via the
        // `delta.reasoning` OpenAI-shape extension so the audit
        // pipeline + the Anthropic/Responses converters can re-emit
        // them as thinking blocks on the way out.
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
        // `typeof` guard (parity with the text-delta branch above):
        // empty-string thinking and signature deltas are real events
        // the model can emit between content blocks — dropping them
        // breaks position-keyed reassembly downstream.
        if (typeof rc.text === 'string') reasoningDelta.thinking = rc.text;
        if (typeof rc.signature === 'string')
          reasoningDelta.signature = rc.signature;
        if (rc.redactedContent) {
          const buf = Buffer.isBuffer(rc.redactedContent)
            ? rc.redactedContent
            : Buffer.from(rc.redactedContent);
          reasoningDelta.redacted = [buf.toString('base64')];
        }
        if (Object.keys(reasoningDelta).length === 0) continue;
        chunk.choices[0] = {
          index: 0,
          delta: {
            role: 'assistant',
            reasoning: reasoningDelta,
          } as unknown as ChatCompletionChunk.Choice['delta'],
          finish_reason: null,
        };
      } else {
        continue;
      }
    } else if (item.contentBlockStop) {
      continue;
    } else if (item.messageStop && item.messageStop.stopReason) {
      // T12 streaming parity: when the caller asked for structured
      // output and the model "stopped to call the synthetic tool",
      // surface that as `stop` — there is no tool call from the
      // caller's perspective.
      const finishReason: ChatCompletion.Choice['finish_reason'] =
        structuredOutputApplied && item.messageStop.stopReason === 'tool_use'
          ? 'stop'
          : STOP_REASONS_MAP[item.messageStop.stopReason];
      chunk.choices[0] = {
        index: 0,
        delta: {},
        finish_reason: finishReason,
      };
    } else if (item.metadata?.usage) {
      chunk.usage = dispatcher.normaliseUsage(item.metadata.usage);
    } else {
      // Unknown / informational event (e.g. metadata-only without usage,
      // future Converse event types) — skip rather than emit an empty
      // chunk with `choices: []` that SDK consumers can't interpret.
      continue;
    }

    yield chunk;
  }
}

/**
 * Test-only re-export of the module-private streaming converter so the
 * integration spec at `__integration__/converse/stream-reasoning.spec.ts`
 * can drive it directly with synthetic Converse events. Underscores
 * deliberately signal "not for production callers — use the provider
 * class".
 */
export const __TEST_ONLY__streamConverseToChatCompletionChunks =
  streamConverseToChatCompletionChunks;

// ─── Provider class ────────────────────────────────────────────────

/**
 * Bedrock Converse handler for OpenAI Chat Completions input.
 *
 * Bedrock Converse has its own wire shape (distinct from OpenAI Chat
 * Completions and from Anthropic Messages). This class owns the
 * Chat↔Converse conversion outright; the shared dispatcher's only
 * responsibility is the raw `client.send(ConverseCommand)` /
 * `client.send(ConverseStreamCommand)` call plus AWS exception
 * mapping. Symmetric with how the sibling Anthropic and Responses
 * provider files structure themselves.
 */
@Injectable()
export class AWSBedrockConverseOpenAICompletionProvider {
  constructor(
    private readonly dispatcher: AWSBedrockConverseDispatcher,
    private readonly logger: PinoLogger
  ) {}

  async handle(
    request: ChatCompletionCreateParams,
    connection: AIConnectionEntity<AWSBedrockAIConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<OpenAICompletionResponse> {
    const { input, structuredOutputApplied } = await buildConverseRequest({
      request,
      model,
      connection,
      logger: this.logger,
    });
    this.logger.info({ requestBody: input }, 'AI Provider request body');

    const native = await this.dispatcher.dispatchConverseRaw(
      input,
      !!request.stream,
      connection,
      options
    );

    if (
      native.data != null &&
      typeof (native.data as AsyncIterable<ConverseStreamOutput>)[
        Symbol.asyncIterator
      ] === 'function'
    ) {
      return {
        data: streamConverseToChatCompletionChunks(
          native.data as AsyncIterable<ConverseStreamOutput>,
          model,
          native.headers['x-request-id'],
          this.dispatcher,
          structuredOutputApplied
        ),
        headers: native.headers,
        providerRequestPayload: native.providerRequestPayload,
      };
    }
    const response = native.data as ConverseCommandOutput;
    return {
      data: converseResponseToChatCompletion(
        response,
        model,
        this.dispatcher,
        structuredOutputApplied
      ),
      headers: extractConverseTraceHeaders(response),
      providerRequestPayload: native.providerRequestPayload,
    };
  }
}
