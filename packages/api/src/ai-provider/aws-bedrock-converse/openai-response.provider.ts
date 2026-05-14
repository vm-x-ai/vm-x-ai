import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  Response as OpenAIResponse,
  ResponseCreateParams,
  ResponseFunctionToolCall,
  ResponseInputContent,
  ResponseInputItem,
  ResponseOutputItem,
  ResponseOutputMessage,
  ResponseReasoningItem,
  ResponseStreamEvent,
  Tool as ResponsesTool,
} from 'openai/resources/responses/responses.js';
import {
  ContentBlock,
  ConverseCommandInput,
  ConverseCommandOutput,
  ConverseStreamOutput,
  Message as ConverseMessage,
  OutputConfig,
  OutputFormatType,
  StopReason,
  Tool as ConverseTool,
  ToolChoice as ConverseToolChoice,
  type ToolResultContentBlock,
  type DocumentBlock,
  type ImageBlock,
} from '@aws-sdk/client-bedrock-runtime';
import { v4 as uuidv4 } from 'uuid';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import {
  CompletionRequestOptions,
  OpenAIResponseResponse,
} from '../ai-provider.types';
import {
  AWSBedrockAIConnectionConfig,
  AWSBedrockConverseDispatcher,
  DEFAULT_CONVERSE_TOOL_INPUT_SCHEMA,
  inferConverseImageFormat,
} from './shared';
import { assertModelSupportsFeatures } from './capability-gate';
import { CompletionError } from '../../gateway/completion.types';
import { assertSafeOutboundUrl } from '../url-safety';
import { modelSupportsOutputConfig } from '../adapters/anthropic-messages.adapter';
import { reasoningEffortToBudget } from '../adapters/anthropic-reasoning';
import { DocumentType } from '@smithy/types';

/**
 * Sentinel name used by the structured-output shim (`text.format =
 * json_schema` on models without native `outputConfig.textFormat`
 * support). Mirrors the same value the Chat-Completions sibling and the
 * Anthropic-direct adapter use so a structured-output round-trip
 * through any path looks identical from the audit row's perspective.
 */
const CONVERSE_STRUCTURED_OUTPUT_TOOL_NAME = '__vmx_structured_output__';

/**
 * Bedrock Converse handler for OpenAI Responses input — direct
 * Responses ↔ Converse converter. No internal pivot through
 * ChatCompletion.
 *
 * Mapping summary:
 *
 *   Request  Responses → Converse
 *     instructions → system: [{text: ...}]
 *     input (string) → user message with text block
 *     input (items)
 *       message       → role-based message with text/image blocks
 *       function_call → assistant message with toolUse block
 *       function_call_output → user message with toolResult block
 *       reasoning     → assistant reasoningContent block (signed)
 *     tools (function) → toolConfig.tools[].toolSpec
 *     tool_choice   → toolConfig.toolChoice
 *     temperature, top_p, max_output_tokens, stop → inferenceConfig
 *     reasoning.effort → additionalModelRequestFields.thinking (budget tier)
 *
 *   Response  Converse → Response
 *     output.message.content
 *       text          → output_text part inside message item
 *       toolUse       → function_call output item
 *       reasoningContent → reasoning output item with summary text
 *     stopReason      → status (end_turn → completed, max_tokens →
 *                       incomplete, tool_use → completed)
 *     usage           → input_tokens + output_tokens + details
 *
 *   Stream  Converse → Response stream
 *     messageStart → response.created + response.in_progress
 *     contentBlockStart (toolUse) → output_item.added (function_call)
 *     contentBlockDelta (text)    → output_item.added(message) +
 *                                   content_part.added + output_text.delta
 *     contentBlockDelta (toolUse) → function_call_arguments.delta
 *     contentBlockDelta (reasoningContent) → reasoning_summary_text.delta
 *     contentBlockStop → output_text.done + content_part.done +
 *                        output_item.done (or function_call_arguments.done)
 *     messageStop      → buffer stop reason
 *     metadata.usage   → buffer usage
 *     final            → response.completed
 */

// ─── Stop reason mapping ───────────────────────────────────────────

function mapConverseStopToResponseStatus(
  reason: StopReason | undefined
): OpenAIResponse['status'] {
  switch (reason) {
    case StopReason.MAX_TOKENS:
    case StopReason.MODEL_CONTEXT_WINDOW_EXCEEDED:
      return 'incomplete';
    case StopReason.CONTENT_FILTERED:
    case StopReason.GUARDRAIL_INTERVENED:
      return 'incomplete';
    case StopReason.END_TURN:
    case StopReason.STOP_SEQUENCE:
    case StopReason.TOOL_USE:
    case StopReason.MALFORMED_TOOL_USE:
    case StopReason.MALFORMED_MODEL_OUTPUT:
    default:
      return 'completed';
  }
}

/**
 * Derive the `incomplete_details.reason` value from the Converse stop
 * reason whenever the mapped status is `'incomplete'`. OpenAI's
 * Responses spec only defines two reasons here (`max_output_tokens`,
 * `content_filter`); everything else folds into `null` so consumers
 * can branch deterministically on the value.
 */
function mapConverseStopToIncompleteReason(
  reason: StopReason | undefined
): OpenAIResponse['incomplete_details'] {
  switch (reason) {
    case StopReason.MAX_TOKENS:
    case StopReason.MODEL_CONTEXT_WINDOW_EXCEEDED:
      return { reason: 'max_output_tokens' };
    case StopReason.CONTENT_FILTERED:
    case StopReason.GUARDRAIL_INTERVENED:
      return { reason: 'content_filter' };
    default:
      return null;
  }
}

// ─── Request side ──────────────────────────────────────────────────

/**
 * Side-channel describing whether the structured-output shim was
 * applied during request build. The response side reads this to
 * collapse `tool_use` → `completed` and unwrap the synthetic-tool
 * arguments back into an `output_text` content part. Mirrors the
 * `structuredOutputApplied` flag the Chat-Completions sibling threads
 * through.
 */
export type ResponseConverseBuildResult = {
  input: ConverseCommandInput;
  structuredOutputApplied: boolean;
};

export async function requestResponsesToConverse(
  req: ResponseCreateParams,
  modelId: string
): Promise<ConverseCommandInput> {
  const { input } = await requestResponsesToConverseWithMeta(req, modelId);
  return input;
}

export async function requestResponsesToConverseWithMeta(
  req: ResponseCreateParams,
  modelId: string
): Promise<ResponseConverseBuildResult> {
  const messages: ConverseMessage[] = [];

  // `system` is built up *before* the input-item loop so developer /
  // system role items inside `input[]` can append onto it (Converse's
  // native channel for them); top-level `instructions` lands first so
  // it stays the leading system block.
  const system: NonNullable<ConverseCommandInput['system']> = [];
  if (typeof req.instructions === 'string' && req.instructions.length > 0) {
    system.push({ text: req.instructions });
  }

  const inputItems: ResponseInputItem[] = Array.isArray(req.input)
    ? req.input
    : [
        {
          type: 'message',
          role: 'user',
          content: req.input ?? '',
        } as ResponseInputItem,
      ];

  for (const item of inputItems) {
    await appendInputItemToConverse(messages, system, item);
  }

  // T11: `tool_choice: 'none'` has no Converse equivalent — map to
  // "no tools sent" so the model literally can't call any tool.
  const toolChoiceIsNone = req.tool_choice === 'none';
  let tools = toolChoiceIsNone
    ? undefined
    : mapResponsesToolsToConverse(req.tools ?? null, req.tool_choice);
  let toolChoice = toolChoiceIsNone
    ? undefined
    : mapResponsesToolChoiceToConverse(req.tool_choice);

  // H5: `text.format = json_schema` → prefer Converse's native
  // `outputConfig.textFormat` (Claude 4.5+); fall back to a synthetic
  // tool whose `inputSchema.json` is the schema on models that don't
  // support the native path. The response/stream side unwraps the
  // synthetic tool back into `output_text`.
  const structured = applyResponseStructuredOutput(req, modelId, tools);
  let outputConfig: OutputConfig | undefined;
  let structuredOutputApplied = false;
  if (structured.kind === 'tool') {
    tools = structured.tools;
    toolChoice = structured.toolChoice;
    structuredOutputApplied = true;
  } else if (structured.kind === 'native') {
    outputConfig = structured.outputConfig;
  }

  const additionalModelRequestFields: Record<string, unknown> = {};
  if (req.reasoning?.effort) {
    const budget = reasoningEffortToBudget(
      req.reasoning.effort,
      req.max_output_tokens ?? undefined
    );
    if (budget != null) {
      additionalModelRequestFields.thinking = {
        type: 'enabled',
        budget_tokens: budget,
      };
    }
  }

  const input: ConverseCommandInput = {
    modelId,
    messages,
    // ResponseCreateParams doesn't expose `stop` sequences directly,
    // so `stopSequences` is left unset on this conversion path.
    inferenceConfig: {
      temperature:
        typeof req.temperature === 'number' ? req.temperature : undefined,
      topP: typeof req.top_p === 'number' ? req.top_p : undefined,
      maxTokens: req.max_output_tokens ?? undefined,
    },
    ...(system.length > 0 ? { system } : {}),
    ...(tools && tools.length > 0
      ? {
          toolConfig: {
            tools,
            ...(toolChoice ? { toolChoice } : {}),
          },
        }
      : {}),
    ...(outputConfig ? { outputConfig } : {}),
    ...(Object.keys(additionalModelRequestFields).length > 0
      ? {
          additionalModelRequestFields:
            additionalModelRequestFields as DocumentType,
        }
      : {}),
  };
  return { input, structuredOutputApplied };
}

/**
 * H5: translate `req.text.format` into Converse-native structured
 * output or the synthetic-tool shim. Mirrors the Chat-Completions
 * sibling's `applyConverseStructuredOutput` so the audit row sees the
 * same shape regardless of input format.
 */
type ResponseStructuredOutputResult =
  | { kind: 'none' }
  | { kind: 'native'; outputConfig: OutputConfig }
  | {
      kind: 'tool';
      tools: ConverseTool[];
      toolChoice: ConverseToolChoice;
    };

function applyResponseStructuredOutput(
  req: ResponseCreateParams,
  modelId: string,
  tools: ConverseTool[] | undefined
): ResponseStructuredOutputResult {
  const format = (req.text as { format?: unknown } | undefined)?.format as
    | {
        type?: string;
        name?: string;
        description?: string;
        schema?: Record<string, unknown>;
      }
    | undefined;
  if (
    format?.type !== 'json_schema' ||
    !format.schema ||
    typeof format.schema !== 'object'
  ) {
    return { kind: 'none' };
  }
  if (modelSupportsOutputConfig(modelId)) {
    return {
      kind: 'native',
      outputConfig: {
        textFormat: {
          type: OutputFormatType.JSON_SCHEMA,
          structure: {
            jsonSchema: {
              name: format.name,
              description: format.description,
              schema: JSON.stringify(format.schema),
            },
          },
        },
      },
    };
  }
  const synthetic: ConverseTool = {
    toolSpec: {
      name: CONVERSE_STRUCTURED_OUTPUT_TOOL_NAME,
      description:
        format.description ??
        `Return the response as a JSON object that conforms to the${
          format.name ? ` "${format.name}"` : ''
        } schema.`,
      inputSchema: {
        json: format.schema as DocumentType,
      },
    },
  };
  return {
    kind: 'tool',
    tools: [...(tools ?? []), synthetic],
    toolChoice: {
      tool: { name: CONVERSE_STRUCTURED_OUTPUT_TOOL_NAME },
    } as ConverseToolChoice,
  };
}

async function appendInputItemToConverse(
  messages: ConverseMessage[],
  system: NonNullable<ConverseCommandInput['system']>,
  item: ResponseInputItem
): Promise<void> {
  const type = (item as { type?: string }).type;

  if (type === 'message' || type === undefined) {
    const msg = item as Extract<
      ResponseInputItem,
      { type?: 'message'; role: 'user' | 'system' | 'developer' | 'assistant' }
    >;
    if (msg.role === 'system' || msg.role === 'developer') {
      // System / developer items are Converse-native: append each
      // `input_text` chunk onto the request's `system[]` channel
      // rather than synthesising a user turn. Image / file parts in a
      // developer message are dropped — Converse's `SystemContentBlock`
      // is text-only.
      const text = stringifyResponsesContent(msg.content);
      if (text) system.push({ text });
      return;
    }
    if (msg.role === 'user') {
      const content = await mapResponsesInputContentToConverse(msg.content);
      // M6: Bedrock rejects empty content arrays; preserve the turn
      // with a placeholder so conversation positioning survives a
      // defensive client emitting an empty user message.
      messages.push({
        role: 'user',
        content: ensureNonEmptyConverseContent(content),
      });
      return;
    }
    if (msg.role === 'assistant') {
      const content = await mapResponsesInputContentToConverse(msg.content);
      messages.push({
        role: 'assistant',
        content: ensureNonEmptyConverseContent(content),
      });
    }
    return;
  }

  if (type === 'function_call') {
    const call = item as Extract<ResponseInputItem, { type: 'function_call' }>;
    let parsed: Record<string, unknown> = {};
    try {
      parsed = call.arguments ? JSON.parse(call.arguments) : {};
    } catch {
      parsed = {};
    }
    const block: ContentBlock = {
      toolUse: {
        toolUseId: call.call_id,
        name: call.name,
        // SDK types `input` as `DocumentType` — cast through unknown to
        // widen from the parsed `Record<string, unknown>`.
        input: parsed as DocumentType,
      },
    };
    const last = messages[messages.length - 1];
    if (last && last.role === 'assistant' && Array.isArray(last.content)) {
      last.content.push(block);
    } else {
      messages.push({ role: 'assistant', content: [block] });
    }
    return;
  }

  if (type === 'function_call_output') {
    const out = item as Extract<
      ResponseInputItem,
      { type: 'function_call_output' }
    >;
    const block: ContentBlock = {
      toolResult: {
        toolUseId: out.call_id,
        content: await mapFunctionCallOutputToToolResultContent(out.output),
        status: 'success',
      },
    };
    const last = messages[messages.length - 1];
    if (last && last.role === 'user' && Array.isArray(last.content)) {
      last.content.push(block);
    } else {
      messages.push({ role: 'user', content: [block] });
    }
    return;
  }

  if (type === 'reasoning') {
    // Stash reasoning summary as a `reasoningContent` block on the
    // previous assistant message — preserves multi-turn signed
    // reasoning continuity. The signature round-trips via the
    // Responses item's `encrypted_content` (T2); without it, Bedrock
    // rejects re-injected thinking on Claude as malformed.
    const r = item as Extract<ResponseInputItem, { type: 'reasoning' }> & {
      encrypted_content?: string;
    };
    const text = (r.summary ?? [])
      .map((s) => (s as { text?: string }).text ?? '')
      .filter(Boolean)
      .join('\n');
    if (!text && !r.encrypted_content) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant' || !Array.isArray(last.content)) {
      return;
    }
    // Sentinel-prefixed encrypted_content signals a redacted_thinking
    // round-trip. Bedrock Converse exposes redacted reasoning via
    // `reasoningContent.redactedContent`.
    if (
      typeof r.encrypted_content === 'string' &&
      r.encrypted_content.startsWith('__vmx_redacted__:')
    ) {
      last.content.unshift({
        reasoningContent: {
          redactedContent: Buffer.from(
            r.encrypted_content.slice('__vmx_redacted__:'.length),
            'base64'
          ),
        },
      } as ContentBlock);
      return;
    }
    last.content.unshift({
      reasoningContent: {
        reasoningText: {
          text,
          ...(r.encrypted_content ? { signature: r.encrypted_content } : {}),
        },
      },
    });
    return;
  }
  // Unknown item types fall through silently.
}

/**
 * M6: substitute a placeholder text block when the mapped content
 * array would otherwise be empty. Bedrock rejects messages with an
 * empty `content` array; preserving the turn keeps the multi-turn
 * history aligned across the Chat-Completions and Responses paths
 * (see the sibling cell's `ensureNonEmptyContent`).
 */
function ensureNonEmptyConverseContent(blocks: ContentBlock[]): ContentBlock[] {
  if (blocks.length === 0) return [{ text: '(no content)' }];
  return blocks;
}

async function mapResponsesInputContentToConverse(
  content: string | ResponseInputContent[] | unknown
): Promise<ContentBlock[]> {
  if (typeof content === 'string') return [{ text: content }];
  if (!Array.isArray(content)) return [];
  const blocks: ContentBlock[] = [];
  for (const part of content as ResponseInputContent[]) {
    const t = (part as { type?: string }).type;
    if (t === 'input_text' || t === 'output_text') {
      blocks.push({ text: (part as { text: string }).text });
      continue;
    }
    if (t === 'input_image') {
      const img = part as { image_url?: string };
      const image = await parseInputImageToConverse(img.image_url);
      if (image) blocks.push({ image });
      continue;
    }
    if (t === 'input_file') {
      const file = part as {
        file_data?: string;
        file_url?: string;
        file_id?: string;
        filename?: string;
      };
      const document = parseInputFileToConverse(file);
      if (document) blocks.push({ document });
      // file_id-only files require the Files API beta on the upstream;
      // Converse can't fetch them server-side, so skip.
    }
    // `input_audio` / video are not surfaced on Bedrock Converse for
    // OpenAI Responses input today — Anthropic Claude on Bedrock
    // doesn't accept either inside a user turn. Dropped silently.
  }
  return blocks;
}

/**
 * Parse an OpenAI `input_image` URL into a Converse `ImageBlock`.
 *
 * - **Data URLs** (`data:image/<mime>;base64,...`): decode inline.
 *   The MIME type is also the format signal — H4 fixes the previous
 *   silent fallback to `'jpeg'` on unknown subtypes.
 * - **HTTPS URLs**: fetch server-side (SSRF-guarded). Format is
 *   inferred from the response `Content-Type`, falling back to the
 *   URL extension. Mirrors the Chat-Completions sibling.
 *
 * Raises `CompletionError(400)` on unsupported / unknown format and
 * on fetch failure so the gateway returns a clear error instead of
 * silently dropping the part.
 */
async function parseInputImageToConverse(
  url: string | undefined
): Promise<ImageBlock | null> {
  if (!url) return null;
  if (url.startsWith('data:')) {
    const match = url.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    const format = inferConverseImageFormat(match[1]);
    if (!format) {
      throw new CompletionError({
        message: `Unsupported image format "${match[1]}" — AWS Bedrock Converse only accepts jpeg / png / gif / webp.`,
        rate: false,
        retryable: false,
        statusCode: HttpStatus.BAD_REQUEST,
        failureReason: 'Unsupported image format',
        openAICompatibleError: {
          code: 'aws_bedrock_unsupported_image_format',
          type: 'unsupported_image_format',
        },
      });
    }
    return {
      format,
      source: { bytes: Buffer.from(match[2], 'base64') },
    };
  }
  // SSRF guard before any outbound fetch — the gateway runs
  // server-side so any URL becomes a fetch from our infra.
  assertSafeOutboundUrl(url, {});
  try {
    const imageResponse = await fetch(url);
    if (!imageResponse.ok) {
      throw new Error(`image fetch returned HTTP ${imageResponse.status}`);
    }
    const contentType = imageResponse.headers.get('content-type');
    const urlPath = new URL(url).pathname;
    const ext = urlPath.split('.').pop()?.toLowerCase();
    const format =
      inferConverseImageFormat(contentType ?? undefined) ??
      inferConverseImageFormat(ext);
    if (!format) {
      throw new CompletionError({
        message: `Could not determine image format for ${url} — AWS Bedrock Converse requires one of jpeg / png / gif / webp.`,
        rate: false,
        retryable: false,
        statusCode: HttpStatus.BAD_REQUEST,
        failureReason: 'Unknown image format',
        openAICompatibleError: {
          code: 'aws_bedrock_unknown_image_format',
          type: 'unknown_image_format',
        },
      });
    }
    return {
      format,
      source: {
        bytes: new Uint8Array(await imageResponse.arrayBuffer()),
      },
    };
  } catch (error) {
    if (error instanceof CompletionError) throw error;
    throw new CompletionError({
      message: `Error fetching image from URL ${url}`,
      rate: false,
      retryable: false,
      statusCode: HttpStatus.BAD_REQUEST,
      failureReason: 'Failed to fetch image',
      openAICompatibleError: {
        code: 'aws_bedrock_image_fetch_error',
        type: 'image_fetch_error',
      },
    });
  }
}

/**
 * Parse an OpenAI `input_file` payload into a Converse `DocumentBlock`.
 * Supports:
 *   - `file_data` base64 PDF / text data URL → bytes/text source
 *   - `file_url` pointing at S3 (`s3://bucket/key`) → S3 location source
 *   - `file_url` HTTPS → bytes source if it can be parsed as a data URL,
 *     otherwise null (Converse can't fetch arbitrary HTTPS).
 */
function parseInputFileToConverse(file: {
  file_data?: string;
  file_url?: string;
  filename?: string;
}): DocumentBlock | null {
  const name = file.filename ?? 'document';
  if (file.file_data) {
    const match = file.file_data.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      const mediaType = match[1];
      if (mediaType === 'text/plain') {
        return {
          format: 'txt',
          name,
          source: { text: Buffer.from(match[2], 'base64').toString('utf-8') },
        };
      }
      const fmt = inferDocumentFormat(mediaType, file.filename);
      return {
        format: fmt as DocumentBlock['format'],
        name,
        source: { bytes: Buffer.from(match[2], 'base64') },
      };
    }
  }
  if (file.file_url) {
    if (file.file_url.startsWith('s3://')) {
      return {
        format: (inferDocumentFormat(undefined, file.filename) ??
          'pdf') as DocumentBlock['format'],
        name,
        source: { s3Location: { uri: file.file_url } },
      };
    }
    // M3: explicit 400 instead of dropping silently — the
    // Chat-Completions sibling raises here as well so the two paths
    // surface the same error envelope. Data-URL `file_url` callers
    // can still flow through the `file_data` branch above.
    throw new CompletionError({
      message:
        'AWS Bedrock Converse only accepts inline file_data (base64 / data URL) or an `s3://` file_url. HTTPS file URLs cannot be fetched server-side.',
      rate: false,
      retryable: false,
      statusCode: HttpStatus.BAD_REQUEST,
      failureReason:
        'Bedrock requires inline file_data or an s3:// URL; HTTPS file_url is not supported',
      openAICompatibleError: {
        code: 'aws_bedrock_file_url_unsupported',
      },
    });
  }
  return null;
}

/**
 * Best-effort mapping from MIME type / filename extension onto
 * Converse's `DocumentFormat` enum. Mirrors the values Bedrock accepts
 * (`pdf`, `csv`, `doc`, `docx`, `xls`, `xlsx`, `html`, `txt`, `md`).
 */
function inferDocumentFormat(
  mediaType: string | undefined,
  filename: string | undefined
): string | undefined {
  if (mediaType) {
    if (mediaType === 'application/pdf') return 'pdf';
    if (mediaType === 'text/csv') return 'csv';
    if (mediaType === 'text/html') return 'html';
    if (mediaType === 'text/plain') return 'txt';
    if (mediaType === 'text/markdown') return 'md';
    if (mediaType === 'application/msword') return 'doc';
    if (
      mediaType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      return 'docx';
    }
    if (mediaType === 'application/vnd.ms-excel') return 'xls';
    if (
      mediaType ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ) {
      return 'xlsx';
    }
  }
  if (filename) {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (
      ext &&
      [
        'pdf',
        'csv',
        'doc',
        'docx',
        'xls',
        'xlsx',
        'html',
        'txt',
        'md',
      ].includes(ext)
    ) {
      return ext;
    }
  }
  return undefined;
}

/**
 * Convert an OpenAI `function_call_output.output` payload into a
 * Converse `toolResult.content` array. Preserves multimodal parts
 * (text + image) instead of flattening to a single string — Converse
 * accepts `text`, `image`, `document`, `json`, `video`, `searchResult`
 * blocks inside a tool result, and Anthropic Claude 3/4 on Bedrock
 * specifically supports text + image. Strings and pure text arrays
 * still produce a single text block so the upstream sees the same
 * wire shape as before; only mixed-content arrays get the richer mapping.
 */
async function mapFunctionCallOutputToToolResultContent(
  output: ResponseInputItem.FunctionCallOutput['output']
): Promise<ToolResultContentBlock[]> {
  if (typeof output === 'string') {
    return [{ text: output }];
  }
  if (!Array.isArray(output)) return [{ text: '' }];
  const blocks: ToolResultContentBlock[] = [];
  for (const part of output) {
    const p = part as {
      type?: string;
      text?: string;
      image_url?: string;
      file_data?: string;
      file_url?: string;
      filename?: string;
    };
    if (p.type === 'input_text' || p.type === 'output_text') {
      if (p.text) blocks.push({ text: p.text });
      continue;
    }
    if (p.type === 'input_image') {
      const image = await parseInputImageToConverse(p.image_url);
      if (image) blocks.push({ image });
      continue;
    }
    if (p.type === 'input_file') {
      const document = parseInputFileToConverse(p);
      if (document) blocks.push({ document });
    }
  }
  if (blocks.length === 0) blocks.push({ text: '' });
  return blocks;
}

function stringifyResponsesContent(
  content: string | ResponseInputContent[] | unknown
): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return (content as ResponseInputContent[])
    .map((p) => {
      const t = (p as { type?: string }).type;
      if (t === 'input_text' || t === 'output_text') {
        return (p as { text?: string }).text ?? '';
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function mapResponsesToolsToConverse(
  tools: ResponsesTool[] | null,
  toolChoice: ResponseCreateParams['tool_choice']
): ConverseTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  // H2: `tool_choice: { type: 'allowed_tools', tools: [...] }` is the
  // Responses-shape way to scope a request to a subset of the
  // available tools. Converse has no native allowlist knob, so the
  // gateway implements it by filtering the emitted tool list to the
  // allowed names. Mirrors the Chat-Completions sibling.
  const allowedTools =
    toolChoice &&
    typeof toolChoice === 'object' &&
    (toolChoice as { type?: string }).type === 'allowed_tools'
      ? new Set(
          ((toolChoice as { tools?: Array<{ name?: string }> }).tools ?? [])
            .map((t) => t.name)
            .filter((n): n is string => typeof n === 'string')
        )
      : undefined;
  const isAllowed = (name: string | undefined): boolean =>
    !allowedTools || (name !== undefined && allowedTools.has(name));

  const out: ConverseTool[] = [];
  for (const tool of tools) {
    if (tool.type === 'function') {
      const fn = tool as Extract<ResponsesTool, { type: 'function' }>;
      if (!isAllowed(fn.name)) continue;
      out.push({
        toolSpec: {
          name: fn.name,
          description: fn.description ?? undefined,
          // M2: use the canonical empty-object JSON schema instead of
          // a bare `{}` so stricter Claude variants don't 400 on
          // zero-arg tools.
          inputSchema: {
            json: (fn.parameters ??
              DEFAULT_CONVERSE_TOOL_INPUT_SCHEMA) as DocumentType,
          },
          strict: fn.strict ?? undefined,
        },
      });
    }
    // Hosted tools (web_search, file_search, computer_use, mcp,
    // image_gen, code_interpreter, shell, apply_patch) have no
    // direct Converse equivalent — drop silently.
  }
  return out.length > 0 ? out : undefined;
}

function mapResponsesToolChoiceToConverse(
  choice: ResponseCreateParams['tool_choice']
): ConverseToolChoice | undefined {
  if (!choice) return undefined;
  if (choice === 'auto') return { auto: {} };
  if (choice === 'required') return { any: {} };
  if (choice === 'none') return undefined;
  if (
    typeof choice === 'object' &&
    (choice as { type?: string }).type === 'function'
  ) {
    const c = choice as { type: 'function'; name: string };
    return { tool: { name: c.name } };
  }
  // H2: `allowed_tools` is implemented at the tool-list level (see
  // `mapResponsesToolsToConverse`). Converse has no native allowlist
  // knob, so fall back to `auto` here — the model can still call any
  // of the (already filtered) tools the gateway forwarded.
  if (
    typeof choice === 'object' &&
    (choice as { type?: string }).type === 'allowed_tools'
  ) {
    return { auto: {} };
  }
  return undefined;
}

// ─── Response side (non-streaming) ─────────────────────────────────

export function responseConverseToResponses(
  resp: ConverseCommandOutput,
  responseId: string,
  createdAt: number,
  model: string,
  originalReq?: ResponseCreateParams,
  structuredOutputApplied = false
): OpenAIResponse {
  const output: ResponseOutputItem[] = [];
  let outputIndex = 0;
  const baseId = resp.$metadata.requestId ?? uuidv4();
  let structuredOutputText = '';

  for (const block of resp.output?.message?.content ?? []) {
    if (block.text) {
      const message: ResponseOutputMessage = {
        type: 'message',
        id: `msg_${baseId}_${outputIndex++}`,
        status: 'completed',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: block.text,
            annotations: [],
            logprobs: [],
          },
        ],
      };
      output.push(message);
    } else if (block.toolUse) {
      // H5: unwrap the synthetic structured-output tool — the caller
      // asked for `text.format: json_schema`, they expect the JSON in
      // an `output_text` content part, not a function_call item.
      if (
        structuredOutputApplied &&
        block.toolUse.name === CONVERSE_STRUCTURED_OUTPUT_TOOL_NAME
      ) {
        structuredOutputText +=
          typeof block.toolUse.input === 'string'
            ? block.toolUse.input
            : JSON.stringify(block.toolUse.input ?? {});
        continue;
      }
      const fnCall: ResponseFunctionToolCall = {
        type: 'function_call',
        id: `fc_${block.toolUse.toolUseId}`,
        call_id: block.toolUse.toolUseId ?? '',
        name: block.toolUse.name ?? '',
        arguments:
          typeof block.toolUse.input === 'string'
            ? block.toolUse.input
            : JSON.stringify(block.toolUse.input ?? {}),
        status: 'completed',
      };
      output.push(fnCall);
    } else if (block.reasoningContent?.reasoningText) {
      const sig = block.reasoningContent.reasoningText.signature;
      const reasoning: ResponseReasoningItem = {
        type: 'reasoning',
        id: `rs_${baseId}_${outputIndex++}`,
        summary: [
          {
            type: 'summary_text',
            text: block.reasoningContent.reasoningText.text ?? '',
          },
        ],
        // Round-trip the signed-thinking blob via `encrypted_content`
        // so a Responses-shape consumer can re-emit it on the next
        // turn without breaking Bedrock's signature validator (T2).
        ...(sig ? { encrypted_content: sig } : {}),
      };
      output.push(reasoning);
    } else if (block.reasoningContent?.redactedContent) {
      // Redacted reasoning lacks a textual summary — preserve the
      // opaque blob so it round-trips back to Bedrock as
      // `reasoningContent.redactedContent` on a subsequent turn.
      const data = Buffer.isBuffer(block.reasoningContent.redactedContent)
        ? block.reasoningContent.redactedContent.toString('base64')
        : Buffer.from(
            block.reasoningContent.redactedContent as Uint8Array
          ).toString('base64');
      const reasoning: ResponseReasoningItem = {
        type: 'reasoning',
        id: `rs_${baseId}_${outputIndex++}`,
        summary: [],
        encrypted_content: `__vmx_redacted__:${data}`,
      };
      output.push(reasoning);
    }
  }

  if (structuredOutputApplied && structuredOutputText.length > 0) {
    const message: ResponseOutputMessage = {
      type: 'message',
      id: `msg_${baseId}_${outputIndex++}`,
      status: 'completed',
      role: 'assistant',
      content: [
        {
          type: 'output_text',
          text: structuredOutputText,
          annotations: [],
          logprobs: [],
        },
      ],
    };
    output.push(message);
  }

  // H5: collapse Bedrock's `tool_use` stop reason to `completed` when
  // the synthetic structured-output tool fired — from the caller's
  // perspective the model returned JSON, not a tool call.
  const status =
    structuredOutputApplied && resp.stopReason === StopReason.TOOL_USE
      ? 'completed'
      : mapConverseStopToResponseStatus(resp.stopReason);
  const incompleteDetails =
    status === 'incomplete'
      ? mapConverseStopToIncompleteReason(resp.stopReason)
      : null;

  const usage = resp.usage
    ? ({
        input_tokens: resp.usage.inputTokens ?? 0,
        output_tokens: resp.usage.outputTokens ?? 0,
        total_tokens: resp.usage.totalTokens ?? 0,
        input_tokens_details: {
          cached_tokens: resp.usage.cacheReadInputTokens ?? 0,
          ...(resp.usage.cacheWriteInputTokens != null
            ? {
                cache_creation_input_tokens: resp.usage.cacheWriteInputTokens,
              }
            : {}),
        },
        output_tokens_details: { reasoning_tokens: 0 },
      } as OpenAIResponse['usage'])
    : undefined;

  return {
    id: responseId,
    object: 'response',
    created_at: createdAt,
    status,
    error: null,
    incomplete_details: incompleteDetails,
    instructions: originalReq?.instructions ?? null,
    max_output_tokens: originalReq?.max_output_tokens ?? null,
    model,
    output,
    output_text: joinOutputText(output),
    parallel_tool_calls: originalReq?.parallel_tool_calls ?? true,
    previous_response_id: originalReq?.previous_response_id ?? null,
    reasoning: originalReq?.reasoning ?? null,
    temperature: originalReq?.temperature ?? null,
    text: originalReq?.text ?? { format: { type: 'text' } },
    tool_choice: originalReq?.tool_choice ?? 'auto',
    tools: originalReq?.tools ?? [],
    top_p: originalReq?.top_p ?? null,
    truncation: originalReq?.truncation ?? 'disabled',
    usage,
    metadata: originalReq?.metadata ?? null,
  } as OpenAIResponse;
}

/**
 * Build the SDK-required `Response.output_text` field by concatenating
 * every `output_text` part across all `message` output items. The
 * Converse-side caller is the single source of truth for the
 * generated text; mirroring it onto this convenience field keeps
 * OpenAI-SDK consumers happy (they read `response.output_text`
 * directly rather than walking `output[]`).
 */
function joinOutputText(items: ResponseOutputItem[]): string {
  let out = '';
  for (const item of items) {
    if (item.type !== 'message') continue;
    for (const part of item.content ?? []) {
      const p = part as { type?: string; text?: string };
      if (p.type === 'output_text' && typeof p.text === 'string') out += p.text;
    }
  }
  return out;
}

// ─── Stream side ───────────────────────────────────────────────────

export async function* streamConverseToResponses(
  source: AsyncIterable<ConverseStreamOutput>,
  responseId: string,
  createdAt: number,
  model: string,
  originalReq?: ResponseCreateParams,
  structuredOutputApplied = false
): AsyncIterable<ResponseStreamEvent> {
  let sequence = 0;
  let outputIndex = 0;
  // Per Converse contentBlockIndex → { kind, itemId, openOutputIndex }.
  const blockState = new Map<
    number,
    {
      kind: 'text' | 'tool_use' | 'thinking' | 'structured_output';
      itemId: string;
      callId?: string;
      name?: string;
      argumentsAccum?: string;
      textAccum?: string;
      thinkingAccum?: string;
      // Bedrock streams the reasoning signature via a final
      // `delta.reasoningContent.signature` event right before
      // `contentBlockStop`. Accumulate so the closing reasoning item
      // can carry it as `encrypted_content` (T2).
      signatureAccum?: string;
      outputIndex: number;
      // H5 streaming parity: per-block flag set when the structured-
      // output tool fired so input fragments re-emit as `output_text`
      // deltas instead of `function_call_arguments` deltas.
      structuredOutputAccum?: string;
    }
  >();
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadInput = 0;
  let cacheCreationInput = 0;
  let stopReason: StopReason | undefined;
  // T14: accumulate items emitted via per-block `output_item.done` so
  // the final `response.completed` event ships a populated `output[]`.
  const accumulatedItems: ResponseOutputItem[] = [];

  const initial = makeStreamingShellResponse(
    responseId,
    createdAt,
    model,
    originalReq
  );
  yield {
    type: 'response.created',
    response: initial,
    sequence_number: sequence++,
  } as ResponseStreamEvent;
  yield {
    type: 'response.in_progress',
    response: initial,
    sequence_number: sequence++,
  } as ResponseStreamEvent;

  for await (const item of source) {
    if (item.messageStart) continue;

    if (item.contentBlockStart?.start?.toolUse) {
      const idx = item.contentBlockStart.contentBlockIndex ?? 0;
      const tu = item.contentBlockStart.start.toolUse;
      // H5 streaming parity: synthetic structured-output tool starts
      // a message-with-output_text item instead of a function_call.
      // Input fragments stream as `output_text.delta` and the block
      // closes with the same `message`/`output_text` shape as a
      // normal text turn — the caller didn't ask for tool calling.
      if (
        structuredOutputApplied &&
        tu.name === CONVERSE_STRUCTURED_OUTPUT_TOOL_NAME
      ) {
        const itemId = `msg_${responseId}_${outputIndex}`;
        blockState.set(idx, {
          kind: 'structured_output',
          itemId,
          structuredOutputAccum: '',
          outputIndex,
        });
        yield {
          type: 'response.output_item.added',
          output_index: outputIndex,
          item: {
            type: 'message',
            id: itemId,
            status: 'in_progress',
            role: 'assistant',
            content: [],
          },
          sequence_number: sequence++,
        } as ResponseStreamEvent;
        yield {
          type: 'response.content_part.added',
          item_id: itemId,
          output_index: outputIndex,
          content_index: 0,
          part: {
            type: 'output_text',
            text: '',
            annotations: [],
            logprobs: [],
          },
          sequence_number: sequence++,
        } as ResponseStreamEvent;
        outputIndex++;
        continue;
      }
      const itemId = `fc_${tu.toolUseId}`;
      blockState.set(idx, {
        kind: 'tool_use',
        itemId,
        callId: tu.toolUseId,
        name: tu.name,
        argumentsAccum: '',
        outputIndex,
      });
      yield {
        type: 'response.output_item.added',
        output_index: outputIndex,
        item: {
          type: 'function_call',
          id: itemId,
          call_id: tu.toolUseId,
          name: tu.name,
          arguments: '',
          status: 'in_progress',
        },
        sequence_number: sequence++,
      } as ResponseStreamEvent;
      outputIndex++;
      continue;
    }

    if (item.contentBlockDelta) {
      const idx = item.contentBlockDelta.contentBlockIndex ?? 0;
      const delta = item.contentBlockDelta.delta;
      let state = blockState.get(idx);
      if (delta?.text != null) {
        if (!state) {
          // Synthesise a text block start on first delta.
          const itemId = `msg_${responseId}_${outputIndex}`;
          state = {
            kind: 'text',
            itemId,
            textAccum: '',
            outputIndex,
          };
          blockState.set(idx, state);
          yield {
            type: 'response.output_item.added',
            output_index: outputIndex,
            item: {
              type: 'message',
              id: itemId,
              status: 'in_progress',
              role: 'assistant',
              content: [],
            },
            sequence_number: sequence++,
          } as ResponseStreamEvent;
          yield {
            type: 'response.content_part.added',
            item_id: itemId,
            output_index: outputIndex,
            content_index: 0,
            part: {
              type: 'output_text',
              text: '',
              annotations: [],
              logprobs: [],
            },
            sequence_number: sequence++,
          } as ResponseStreamEvent;
          outputIndex++;
        }
        state.textAccum = (state.textAccum ?? '') + delta.text;
        yield {
          type: 'response.output_text.delta',
          item_id: state.itemId,
          output_index: state.outputIndex,
          content_index: 0,
          delta: delta.text,
          sequence_number: sequence++,
        } as ResponseStreamEvent;
      } else if (delta?.toolUse && state?.kind === 'structured_output') {
        // H5 streaming parity: re-emit synthetic-tool input fragments
        // as output_text deltas. The schema-shaped JSON is the model's
        // response, not a tool call.
        const partial = delta.toolUse.input ?? '';
        state.structuredOutputAccum =
          (state.structuredOutputAccum ?? '') + partial;
        yield {
          type: 'response.output_text.delta',
          item_id: state.itemId,
          output_index: state.outputIndex,
          content_index: 0,
          delta: partial,
          sequence_number: sequence++,
        } as ResponseStreamEvent;
      } else if (delta?.toolUse && state?.kind === 'tool_use') {
        const partial = delta.toolUse.input ?? '';
        state.argumentsAccum = (state.argumentsAccum ?? '') + partial;
        yield {
          type: 'response.function_call_arguments.delta',
          item_id: state.itemId,
          output_index: state.outputIndex,
          delta: partial,
          sequence_number: sequence++,
        } as ResponseStreamEvent;
      } else if (delta?.reasoningContent) {
        if (!state) {
          const itemId = `rs_${responseId}_${outputIndex}`;
          state = {
            kind: 'thinking',
            itemId,
            thinkingAccum: '',
            outputIndex,
          };
          blockState.set(idx, state);
          yield {
            type: 'response.output_item.added',
            output_index: outputIndex,
            item: {
              type: 'reasoning',
              id: itemId,
              summary: [],
            },
            sequence_number: sequence++,
          } as ResponseStreamEvent;
          // M4: bracket the summary-text deltas with the OpenAI-spec
          // `reasoning_summary_part.added`/`.done` events. SDK
          // consumers that walk the full event sequence (e.g. the
          // OpenAI SDK's accumulator) expect these around each
          // summary part.
          yield {
            type: 'response.reasoning_summary_part.added',
            item_id: itemId,
            output_index: outputIndex,
            summary_index: 0,
            part: { type: 'summary_text', text: '' },
            sequence_number: sequence++,
          } as ResponseStreamEvent;
          outputIndex++;
        }
        if (delta.reasoningContent.text) {
          state.thinkingAccum =
            (state.thinkingAccum ?? '') + delta.reasoningContent.text;
          yield {
            type: 'response.reasoning_summary_text.delta',
            item_id: state.itemId,
            output_index: state.outputIndex,
            summary_index: 0,
            delta: delta.reasoningContent.text,
            sequence_number: sequence++,
          } as ResponseStreamEvent;
        }
        const sigDelta = (delta.reasoningContent as { signature?: string })
          .signature;
        if (sigDelta) {
          state.signatureAccum = (state.signatureAccum ?? '') + sigDelta;
        }
      }
      continue;
    }

    if (item.contentBlockStop) {
      const idx = item.contentBlockStop.contentBlockIndex ?? 0;
      const state = blockState.get(idx);
      if (!state) continue;
      if (state.kind === 'text') {
        yield {
          type: 'response.output_text.done',
          item_id: state.itemId,
          output_index: state.outputIndex,
          content_index: 0,
          text: state.textAccum ?? '',
          sequence_number: sequence++,
        } as ResponseStreamEvent;
        yield {
          type: 'response.content_part.done',
          item_id: state.itemId,
          output_index: state.outputIndex,
          content_index: 0,
          part: {
            type: 'output_text',
            text: state.textAccum ?? '',
            annotations: [],
            logprobs: [],
          },
          sequence_number: sequence++,
        } as ResponseStreamEvent;
        const messageItem: ResponseOutputMessage = {
          type: 'message',
          id: state.itemId,
          status: 'completed',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: state.textAccum ?? '',
              annotations: [],
              logprobs: [],
            },
          ],
        };
        accumulatedItems.push(messageItem);
        yield {
          type: 'response.output_item.done',
          output_index: state.outputIndex,
          item: messageItem,
          sequence_number: sequence++,
        } as ResponseStreamEvent;
      } else if (state.kind === 'tool_use') {
        yield {
          type: 'response.function_call_arguments.done',
          item_id: state.itemId,
          output_index: state.outputIndex,
          arguments: state.argumentsAccum ?? '',
          sequence_number: sequence++,
        } as ResponseStreamEvent;
        const fcItem: ResponseFunctionToolCall = {
          type: 'function_call',
          id: state.itemId,
          call_id: state.callId ?? '',
          name: state.name ?? '',
          arguments: state.argumentsAccum ?? '',
          status: 'completed',
        };
        accumulatedItems.push(fcItem);
        yield {
          type: 'response.output_item.done',
          output_index: state.outputIndex,
          item: fcItem,
          sequence_number: sequence++,
        } as ResponseStreamEvent;
      } else if (state.kind === 'thinking') {
        yield {
          type: 'response.reasoning_summary_text.done',
          item_id: state.itemId,
          output_index: state.outputIndex,
          summary_index: 0,
          text: state.thinkingAccum ?? '',
          sequence_number: sequence++,
        } as ResponseStreamEvent;
        // M4: close the `summary_text` part before the surrounding
        // `output_item.done`, matching the OpenAI wire-format order.
        yield {
          type: 'response.reasoning_summary_part.done',
          item_id: state.itemId,
          output_index: state.outputIndex,
          summary_index: 0,
          part: {
            type: 'summary_text',
            text: state.thinkingAccum ?? '',
          },
          sequence_number: sequence++,
        } as ResponseStreamEvent;
        const reasoningItem: ResponseReasoningItem = {
          type: 'reasoning',
          id: state.itemId,
          summary: [{ type: 'summary_text', text: state.thinkingAccum ?? '' }],
          ...(state.signatureAccum
            ? { encrypted_content: state.signatureAccum }
            : {}),
        };
        accumulatedItems.push(reasoningItem);
        yield {
          type: 'response.output_item.done',
          output_index: state.outputIndex,
          item: reasoningItem,
          sequence_number: sequence++,
        } as ResponseStreamEvent;
      } else if (state.kind === 'structured_output') {
        // H5 streaming parity: close the synthetic-tool block as a
        // normal message-with-output_text turn.
        const text = state.structuredOutputAccum ?? '';
        yield {
          type: 'response.output_text.done',
          item_id: state.itemId,
          output_index: state.outputIndex,
          content_index: 0,
          text,
          sequence_number: sequence++,
        } as ResponseStreamEvent;
        yield {
          type: 'response.content_part.done',
          item_id: state.itemId,
          output_index: state.outputIndex,
          content_index: 0,
          part: {
            type: 'output_text',
            text,
            annotations: [],
            logprobs: [],
          },
          sequence_number: sequence++,
        } as ResponseStreamEvent;
        const messageItem: ResponseOutputMessage = {
          type: 'message',
          id: state.itemId,
          status: 'completed',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text,
              annotations: [],
              logprobs: [],
            },
          ],
        };
        accumulatedItems.push(messageItem);
        yield {
          type: 'response.output_item.done',
          output_index: state.outputIndex,
          item: messageItem,
          sequence_number: sequence++,
        } as ResponseStreamEvent;
      }
      blockState.delete(idx);
      continue;
    }

    if (item.messageStop) {
      stopReason = item.messageStop.stopReason;
      continue;
    }

    if (item.metadata?.usage) {
      const u = item.metadata.usage;
      inputTokens = u.inputTokens ?? inputTokens;
      outputTokens = u.outputTokens ?? outputTokens;
      cacheReadInput = u.cacheReadInputTokens ?? cacheReadInput;
      cacheCreationInput = u.cacheWriteInputTokens ?? cacheCreationInput;
    }
  }

  // H5 streaming parity: collapse `tool_use` to `completed` when the
  // synthetic structured-output tool fired so the caller doesn't see
  // an `incomplete`-ish terminal event for what is really a JSON
  // response.
  const finalStatus =
    structuredOutputApplied && stopReason === StopReason.TOOL_USE
      ? 'completed'
      : mapConverseStopToResponseStatus(stopReason);
  const finalResponse = makeFinalResponse({
    responseId,
    createdAt,
    model,
    status: finalStatus,
    incompleteDetails:
      finalStatus === 'incomplete'
        ? mapConverseStopToIncompleteReason(stopReason)
        : null,
    outputItems: accumulatedItems,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_read_input_tokens: cacheReadInput,
      cache_creation_input_tokens: cacheCreationInput,
    },
    originalReq,
  });
  // M1: route the terminal event by status so SDK consumers can
  // discriminate `incomplete` (max-tokens / content-filter) from a
  // clean completion via event type alone, per the OpenAI Responses
  // wire format.
  if (finalStatus === 'incomplete') {
    yield {
      type: 'response.incomplete',
      response: finalResponse,
      sequence_number: sequence++,
    } as ResponseStreamEvent;
  } else {
    yield {
      type: 'response.completed',
      response: finalResponse,
      sequence_number: sequence++,
    } as ResponseStreamEvent;
  }
}

function makeStreamingShellResponse(
  responseId: string,
  createdAt: number,
  model: string,
  originalReq?: ResponseCreateParams
): OpenAIResponse {
  return {
    id: responseId,
    object: 'response',
    created_at: createdAt,
    status: 'in_progress',
    error: null,
    incomplete_details: null,
    instructions: originalReq?.instructions ?? null,
    max_output_tokens: originalReq?.max_output_tokens ?? null,
    model,
    output: [],
    output_text: '',
    parallel_tool_calls: originalReq?.parallel_tool_calls ?? true,
    previous_response_id: originalReq?.previous_response_id ?? null,
    reasoning: originalReq?.reasoning ?? null,
    temperature: originalReq?.temperature ?? null,
    text: originalReq?.text ?? { format: { type: 'text' } },
    tool_choice: originalReq?.tool_choice ?? 'auto',
    tools: originalReq?.tools ?? [],
    top_p: originalReq?.top_p ?? null,
    truncation: originalReq?.truncation ?? 'disabled',
    metadata: originalReq?.metadata ?? null,
  } as OpenAIResponse;
}

function makeFinalResponse(args: {
  responseId: string;
  createdAt: number;
  model: string;
  status: OpenAIResponse['status'];
  /** H1 streaming parity: `incomplete_details.reason` derived from the
   * Converse stop reason whenever `status === 'incomplete'`. */
  incompleteDetails?: OpenAIResponse['incomplete_details'];
  /**
   * T14: items the stream emitted via per-block `output_item.done`,
   * accumulated and replayed on the final `response.completed`
   * payload so consumers reading the aggregate event see the real
   * output instead of an empty array.
   */
  outputItems?: ResponseOutputItem[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
  originalReq?: ResponseCreateParams;
}): OpenAIResponse {
  const items = args.outputItems ?? [];
  return {
    id: args.responseId,
    object: 'response',
    created_at: args.createdAt,
    status: args.status,
    error: null,
    incomplete_details: args.incompleteDetails ?? null,
    instructions: args.originalReq?.instructions ?? null,
    max_output_tokens: args.originalReq?.max_output_tokens ?? null,
    model: args.model,
    output: items,
    output_text: joinOutputText(items),
    parallel_tool_calls: args.originalReq?.parallel_tool_calls ?? true,
    previous_response_id: args.originalReq?.previous_response_id ?? null,
    reasoning: args.originalReq?.reasoning ?? null,
    temperature: args.originalReq?.temperature ?? null,
    text: args.originalReq?.text ?? { format: { type: 'text' } },
    tool_choice: args.originalReq?.tool_choice ?? 'auto',
    tools: args.originalReq?.tools ?? [],
    top_p: args.originalReq?.top_p ?? null,
    truncation: args.originalReq?.truncation ?? 'disabled',
    usage: {
      input_tokens: args.usage.input_tokens,
      output_tokens: args.usage.output_tokens,
      total_tokens: args.usage.input_tokens + args.usage.output_tokens,
      input_tokens_details: {
        cached_tokens: args.usage.cache_read_input_tokens,
        ...(args.usage.cache_creation_input_tokens > 0
          ? {
              cache_creation_input_tokens:
                args.usage.cache_creation_input_tokens,
            }
          : {}),
      },
      output_tokens_details: { reasoning_tokens: 0 },
    } as OpenAIResponse['usage'],
    metadata: args.originalReq?.metadata ?? null,
  } as OpenAIResponse;
}

// ─── Provider class ────────────────────────────────────────────────

@Injectable()
export class AWSBedrockConverseOpenAIResponseProvider {
  constructor(private readonly dispatcher: AWSBedrockConverseDispatcher) {}

  async handle(
    request: ResponseCreateParams,
    connection: AIConnectionEntity<AWSBedrockAIConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<OpenAIResponseResponse> {
    // T19: pre-flight gate.
    if (request.tools?.length && request.tool_choice !== 'none') {
      assertModelSupportsFeatures(model.model, { tools: true });
    }
    const { input, structuredOutputApplied } =
      await requestResponsesToConverseWithMeta(request, model.model);
    // T22: thread the connection's `performanceConfig.latency` onto
    // the Converse command input — only the OpenAI Chat path was
    // doing this before, so Resp-input requests silently lost the
    // optimised-latency setting. The Anthropic-input path already
    // does it via the same field on `requestAnthropicToConverse`'s
    // caller; here we patch the input post-build because
    // `requestResponsesToConverse` is a pure function with no
    // connection access.
    if (connection.config?.performanceConfig) {
      input.performanceConfig = {
        latency: connection.config.performanceConfig.latency,
      };
    }
    // T21: same connection-level Bedrock Guardrails config that the
    // Chat-input path applies — propagate so Resp-shape requests
    // get the same protection.
    if (connection.config?.guardrailConfig) {
      input.guardrailConfig = {
        guardrailIdentifier:
          connection.config.guardrailConfig.guardrailIdentifier,
        guardrailVersion: connection.config.guardrailConfig.guardrailVersion,
        trace: connection.config.guardrailConfig.trace ?? 'enabled',
      };
    }
    const native = await this.dispatcher.dispatchConverseRaw(
      input,
      !!request.stream,
      connection,
      options
    );
    const responseId = `resp_${uuidv4()}`;
    const createdAt = Math.floor(Date.now() / 1000);

    if (
      native.data != null &&
      typeof (native.data as AsyncIterable<ConverseStreamOutput>)[
        Symbol.asyncIterator
      ] === 'function'
    ) {
      return {
        data: streamConverseToResponses(
          native.data as AsyncIterable<ConverseStreamOutput>,
          responseId,
          createdAt,
          model.model,
          request,
          structuredOutputApplied
        ),
        headers: native.headers,
        providerRequestPayload: native.providerRequestPayload,
      };
    }
    return {
      data: responseConverseToResponses(
        native.data as ConverseCommandOutput,
        responseId,
        createdAt,
        model.model,
        request,
        structuredOutputApplied
      ),
      headers: native.headers,
      providerRequestPayload: native.providerRequestPayload,
    };
  }
}
