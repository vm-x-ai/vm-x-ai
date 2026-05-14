import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ContentBlock,
  ConverseCommandInput,
  ConverseCommandOutput,
  ConverseStreamOutput,
  DocumentBlock,
  DocumentFormat,
  DocumentSource,
  Message as ConverseMessage,
  StopReason,
  Tool as ConverseTool,
  ToolChoice as ConverseToolChoice,
  ToolResultContentBlock,
} from '@aws-sdk/client-bedrock-runtime';
import type {
  CacheCreation,
  ContentBlockParam as AnthropicContentBlockParam,
  ImageBlockParam,
  Message as AnthropicMessage,
  MessageParam as AnthropicMessageParam,
  RawMessageStreamEvent,
  TextBlockParam,
} from '@anthropic-ai/sdk/resources/messages';
import { v4 as uuidv4 } from 'uuid';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import {
  AnthropicMessagesResponse,
  CompletionRequestOptions,
} from '../ai-provider.types';
import type {
  AnthropicMessagesRequest,
  AnthropicTool,
  AnthropicToolChoice,
} from '../../gateway/anthropic/anthropic.types';
import {
  AWSBedrockAIConnectionConfig,
  AWSBedrockConverseDispatcher,
  DEFAULT_CONVERSE_TOOL_INPUT_SCHEMA,
  inferConverseImageFormat,
} from './shared';
import { assertModelSupportsFeatures } from './capability-gate';
import { assertSafeOutboundUrl } from '../url-safety';
import { CompletionError } from '../../gateway/completion.types';
import { DocumentType } from '@smithy/types';
import {
  classifyAnthropicServerTool,
  isServerToolHistoryBlock,
  liftAnthropicServerToolBlockToText,
  raiseUnsupportedServerTool,
} from '../adapters/anthropic-server-tools';
import type { ToolUnion as AnthropicToolUnion } from '@anthropic-ai/sdk/resources/messages';

/**
 * Bedrock Converse handler for Anthropic Messages input — direct
 * Anthropic ↔ Converse converter. No internal pivot through
 * ChatCompletion.
 *
 * The adapter functions live at the top of this file (pure,
 * importable). The class at the bottom builds the `ConverseCommandInput`
 * via `requestAnthropicToConverse`, dispatches via
 * `AWSBedrockConverseDispatcher.dispatchConverseRaw`, then converts
 * the native AWS response back to Anthropic Message shape via
 * `responseConverseToAnthropic` (or `streamConverseToAnthropic` for
 * the streaming case).
 *
 * Mapping summary:
 *
 *   Request  Anthropic → Converse
 *     system (string | TextBlockParam[]) → system: SystemContentBlock[]
 *     messages
 *       text content    → ContentBlock.text
 *       image content   → ContentBlock.image (base64 inline; https:// fetched
 *                         server-side with SSRF guard, format inferred from
 *                         Content-Type / URL extension)
 *       document (base64 / url / text / content[]) → ContentBlock.document
 *       tool_use        → ContentBlock.toolUse
 *       tool_result     → ContentBlock.toolResult (text + image + document
 *                         content sub-blocks)
 *       thinking        → ContentBlock.reasoningContent.reasoningText
 *       redacted_thinking → ContentBlock.reasoningContent.redactedContent
 *     tools (custom)    → toolConfig.tools[].toolSpec (default empty-object
 *                         input schema on zero-arg tools)
 *     tool_choice       → toolConfig.toolChoice (none → strip tools)
 *     temperature, top_p → inferenceConfig
 *     max_tokens        → inferenceConfig.maxTokens
 *     stop_sequences    → inferenceConfig.stopSequences
 *     top_k             → additionalModelRequestFields.top_k
 *     thinking          → additionalModelRequestFields.thinking
 *     metadata.user_id  → requestMetadata.user_id
 *
 *   Response  Converse → Anthropic
 *     output.message.content
 *       text                                  → TextBlock (citations: null)
 *       toolUse                               → ToolUseBlock (caller: direct)
 *       reasoningContent.reasoningText        → ThinkingBlock
 *       reasoningContent.redactedContent      → RedactedThinkingBlock
 *     stopReason                              → stop_reason (via map; refusal
 *                                                + GUARDRAIL_INTERVENED → refusal
 *                                                with stop_details)
 *     additionalModelResponseFields.stop_sequence → stop_sequence
 *     usage                                   → input/output/cache + cache_creation
 *                                                breakdown from cacheDetails
 *
 *   Stream  Converse → Anthropic SSE
 *     messageStart                                → message_start (with full
 *                                                    Message skeleton and
 *                                                    Usage with all 8 fields)
 *     contentBlockStart (toolUse)                 → content_block_start (tool_use)
 *     contentBlockDelta (text)                    → content_block_delta (text_delta)
 *     contentBlockDelta (toolUse)                 → content_block_delta (input_json_delta)
 *     contentBlockDelta (reasoningContent.text)   → content_block_delta (thinking_delta)
 *     contentBlockDelta (reasoningContent.signature) → content_block_delta (signature_delta)
 *     contentBlockStop                            → content_block_stop
 *     messageStop                                 → buffered for terminal message_delta
 *     metadata.usage                              → buffered for terminal message_delta
 *     final                                       → message_delta + message_stop
 */

// ─── Stop reason mapping ───────────────────────────────────────────

const CONVERSE_STOP_TO_ANTHROPIC: Record<
  StopReason,
  AnthropicMessage['stop_reason']
> = {
  [StopReason.END_TURN]: 'end_turn',
  [StopReason.STOP_SEQUENCE]: 'stop_sequence',
  [StopReason.MAX_TOKENS]: 'max_tokens',
  [StopReason.TOOL_USE]: 'tool_use',
  [StopReason.CONTENT_FILTERED]: 'refusal',
  [StopReason.GUARDRAIL_INTERVENED]: 'refusal',
  [StopReason.MALFORMED_MODEL_OUTPUT]: 'end_turn',
  [StopReason.MALFORMED_TOOL_USE]: 'tool_use',
  [StopReason.MODEL_CONTEXT_WINDOW_EXCEEDED]: 'max_tokens',
};

// ─── Document format helpers ───────────────────────────────────────

/**
 * Map an Anthropic document `media_type` / filename onto Bedrock's
 * `DocumentFormat` enum. Bedrock requires the format on bytes-source
 * documents to parse them correctly; an explicit hint is also recommended
 * for ambiguous types (CSV vs TXT). Returns `undefined` so the caller
 * can raise an explicit error or fall back to a permissive default.
 */
function inferAnthropicDocumentFormat(
  mediaType?: string,
  filename?: string
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

// ─── Request side ──────────────────────────────────────────────────

export async function requestAnthropicToConverse(
  req: AnthropicMessagesRequest,
  modelId: string
): Promise<ConverseCommandInput> {
  const messages: ConverseMessage[] = [];
  for (let i = 0; i < req.messages.length; i++) {
    const conv = await mapAnthropicMessageToConverse(req.messages[i], i);
    if (conv) messages.push(conv);
  }

  const system: ConverseCommandInput['system'] = [];
  if (typeof req.system === 'string' && req.system.length > 0) {
    system.push({ text: req.system });
  } else if (Array.isArray(req.system)) {
    for (const block of req.system as TextBlockParam[]) {
      if (block.type === 'text' && block.text) {
        system.push({ text: block.text });
        if (block.cache_control) {
          system.push({
            cachePoint: {
              type: 'default',
              ...(block.cache_control.ttl
                ? { ttl: block.cache_control.ttl }
                : {}),
            },
          } as ConverseCommandInput['system'] extends (infer S)[] | undefined ? S : never);
        }
      }
    }
  }

  // T11: Anthropic `tool_choice: { type: 'none' }` has no Converse
  // equivalent. Map it to "no tools sent" so the model literally
  // can't call any tool, mirroring the intent.
  const toolChoiceIsNone = req.tool_choice?.type === 'none';
  const tools = toolChoiceIsNone
    ? undefined
    : mapAnthropicToolsToConverse(
        req.tools as AnthropicToolUnion[] | undefined
      );
  const toolChoice = toolChoiceIsNone
    ? undefined
    : mapAnthropicToolChoiceToConverse(req.tool_choice);

  const additionalModelRequestFields: Record<string, unknown> = {};
  if (typeof req.top_k === 'number') {
    additionalModelRequestFields.top_k = req.top_k;
  }
  if (req.thinking) {
    additionalModelRequestFields.thinking = req.thinking;
  }

  // F-M1: `metadata.user_id` → `requestMetadata.user_id`. Bedrock's
  // requestMetadata is a free-form string map; Anthropic's metadata
  // is a `{ user_id }` shape. Round-tripping the user_id preserves
  // the abuse-detection / per-tenant filtering signal.
  const requestMetadata: Record<string, string> | undefined = req.metadata
    ?.user_id
    ? { user_id: req.metadata.user_id }
    : undefined;

  const input: ConverseCommandInput = {
    modelId,
    messages,
    inferenceConfig: {
      temperature: req.temperature ?? undefined,
      topP: req.top_p ?? undefined,
      maxTokens: req.max_tokens,
      stopSequences: req.stop_sequences ?? undefined,
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
    ...(Object.keys(additionalModelRequestFields).length > 0
      ? {
          additionalModelRequestFields:
            additionalModelRequestFields as unknown as ConverseCommandInput['additionalModelRequestFields'],
        }
      : {}),
    ...(requestMetadata ? { requestMetadata } : {}),
    // F-M4: ask Bedrock to echo the matched stop_sequence string back
    // via `additionalModelResponseFields./stop_sequence` so the
    // response converter can populate Anthropic's `stop_sequence`
    // field on the Message. The path is a JSON Pointer (RFC 6901).
    ...(req.stop_sequences && req.stop_sequences.length > 0
      ? { additionalModelResponseFieldPaths: ['/stop_sequence'] }
      : {}),
  };

  return input;
}

async function mapAnthropicMessageToConverse(
  m: AnthropicMessageParam,
  _messageIndex: number
): Promise<ConverseMessage | null> {
  if (m.role !== 'user' && m.role !== 'assistant') return null;
  let content: ContentBlock[];
  if (typeof m.content === 'string') {
    content = [{ text: m.content }];
  } else {
    content = [];
    for (const block of m.content) {
      const converted = await mapAnthropicContentBlockToConverse(block);
      if (converted) content.push(converted);
      if ('cache_control' in block && block.cache_control) {
        content.push({
          cachePoint: {
            type: 'default',
            ...(block.cache_control.ttl
              ? { ttl: block.cache_control.ttl }
              : {}),
          },
        });
      }
    }
  }
  // F-M11: Bedrock rejects messages with empty `content`. Preserve
  // turn position by substituting a placeholder text block — mirrors
  // the Chat / Resp sibling cells' `ensureNonEmptyContent`.
  if (content.length === 0) {
    content = [{ text: '(no content)' }];
  }
  return { role: m.role, content };
}

async function mapAnthropicContentBlockToConverse(
  block: AnthropicContentBlockParam
): Promise<ContentBlock | null> {
  switch (block.type) {
    case 'text':
      return { text: block.text };
    case 'image':
      return await mapAnthropicImageBlock(block);
    case 'document':
      return await mapAnthropicDocumentBlock(block);
    case 'tool_use':
      return {
        toolUse: {
          toolUseId: block.id,
          name: block.name,
          input: (block.input ?? {}) as DocumentType,
        },
      };
    case 'tool_result':
      return {
        toolResult: {
          toolUseId: block.tool_use_id,
          content: await mapToolResultContent(block.content),
          status: block.is_error ? 'error' : 'success',
        },
      };
    case 'thinking':
      return {
        reasoningContent: {
          reasoningText: {
            text: block.thinking ?? '',
            ...(block.signature ? { signature: block.signature } : {}),
          },
        },
      };
    case 'redacted_thinking':
      // F-F5: Bedrock natively supports redacted reasoning round-trips
      // via `reasoningContent.redactedContent`. The Anthropic param
      // carries the opaque blob as a base64 string in `data`.
      return {
        reasoningContent: {
          redactedContent: Buffer.from(block.data ?? '', 'base64'),
        },
      } as ContentBlock;
    default:
      // Server-tool history blocks (web_search_tool_result, server_tool_use,
      // *_code_execution_tool_result, container_upload, etc.) have no
      // first-class Converse equivalent. Lift to a plain text block so
      // the model's prior search / execution context survives the cross-
      // provider hop instead of corrupting multi-turn semantics.
      if (isServerToolHistoryBlock(block)) {
        const lifted = liftAnthropicServerToolBlockToText(block);
        return lifted ? { text: lifted.text } : null;
      }
      return null;
  }
}

async function mapAnthropicImageBlock(
  block: Extract<AnthropicContentBlockParam, { type: 'image' }>
): Promise<ContentBlock | null> {
  const src = block.source as ImageBlockParam['source'];
  if (src.type === 'base64') {
    // F-F1: use shared `inferConverseImageFormat` instead of an
    // ad-hoc split; raise an explicit 400 on unknown subtypes rather
    // than silently emitting `format: 'jpeg'` for SVG/AVIF/HEIC.
    const format = inferConverseImageFormat(src.media_type);
    if (!format) {
      throw new CompletionError({
        message: `Unsupported image format "${src.media_type}" — AWS Bedrock Converse only accepts jpeg / png / gif / webp.`,
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
      image: {
        format,
        source: { bytes: Buffer.from(src.data, 'base64') },
      },
    };
  }
  if (src.type === 'url') {
    // F-F2: parity with the Converse Chat / Resp sibling cells —
    // fetch the URL server-side (SSRF-guarded), infer the format
    // from Content-Type / URL extension. Drop-silently was an
    // audit-row inconsistency with the other Converse cells.
    assertSafeOutboundUrl(src.url, {});
    try {
      const imageResponse = await fetch(src.url);
      if (!imageResponse.ok) {
        throw new Error(`image fetch returned HTTP ${imageResponse.status}`);
      }
      const contentType = imageResponse.headers.get('content-type');
      const urlPath = new URL(src.url).pathname;
      const ext = urlPath.split('.').pop()?.toLowerCase();
      const format =
        inferConverseImageFormat(contentType ?? undefined) ??
        inferConverseImageFormat(ext);
      if (!format) {
        throw new CompletionError({
          message: `Could not determine image format for ${src.url} — AWS Bedrock Converse requires one of jpeg / png / gif / webp.`,
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
        image: {
          format,
          source: {
            bytes: new Uint8Array(await imageResponse.arrayBuffer()),
          },
        },
      };
    } catch (error) {
      if (error instanceof CompletionError) throw error;
      throw new CompletionError({
        message: `Error fetching image from URL ${src.url}`,
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
  // `file` source type requires the Anthropic Files API and has no
  // direct Bedrock equivalent — dropped.
  return null;
}

async function mapAnthropicDocumentBlock(
  block: Extract<AnthropicContentBlockParam, { type: 'document' }>
): Promise<ContentBlock | null> {
  // F-F3: Anthropic supports four document source variants — base64,
  // url, text, and content (an array of text blocks). Each maps onto
  // a Converse `DocumentBlock` source variant. The previous code
  // dropped all four silently.
  const src = block.source as {
    type: string;
    media_type?: string;
    data?: string;
    url?: string;
    content?: Array<{ type?: string; text?: string }>;
  };
  const filename =
    (block as { title?: string; filename?: string }).title ??
    (block as { filename?: string }).filename ??
    'document';
  let source: DocumentSource | undefined;
  let format: DocumentFormat | undefined;
  if (src.type === 'base64' && src.data) {
    format = inferAnthropicDocumentFormat(src.media_type, filename);
    source = {
      bytes: new Uint8Array(Buffer.from(src.data, 'base64')),
    } as DocumentSource.BytesMember;
  } else if (
    src.type === 'text' &&
    typeof (src as { data?: string }).data === 'string'
  ) {
    format = DocumentFormat.TXT;
    source = {
      text: (src as { data: string }).data,
    } as DocumentSource.TextMember;
  } else if (src.type === 'content' && Array.isArray(src.content)) {
    // Flatten the inline-content shape into a single text source.
    const text = src.content
      .map((c) => (c.type === 'text' ? c.text ?? '' : ''))
      .filter(Boolean)
      .join('\n');
    if (text.length > 0) {
      format = DocumentFormat.TXT;
      source = { text } as DocumentSource.TextMember;
    }
  } else if (src.type === 'url' && src.url) {
    if (src.url.startsWith('s3://')) {
      format =
        inferAnthropicDocumentFormat(undefined, filename) ?? DocumentFormat.PDF;
      source = {
        s3Location: { uri: src.url },
      } as DocumentSource.S3LocationMember;
    } else {
      // HTTPS document URLs cannot be fetched server-side onto Bedrock
      // (Converse's DocumentSource has no httpUrl variant). Raise a
      // clear 400 so the caller knows to use base64 or an s3:// URL.
      throw new CompletionError({
        message:
          'AWS Bedrock Converse only accepts inline document bytes (base64), inline text, or an `s3://` URL. HTTPS document URLs cannot be fetched server-side.',
        rate: false,
        retryable: false,
        statusCode: HttpStatus.BAD_REQUEST,
        failureReason:
          'Bedrock requires inline document data or an s3:// URL; HTTPS document URL is not supported',
        openAICompatibleError: {
          code: 'aws_bedrock_document_url_unsupported',
        },
      });
    }
  }
  if (!source) return null;
  const documentBlock: DocumentBlock = {
    name: filename,
    source,
    ...(format ? { format } : {}),
  };
  return { document: documentBlock };
}

async function mapToolResultContent(
  content: Extract<
    AnthropicContentBlockParam,
    { type: 'tool_result' }
  >['content']
): Promise<ToolResultContentBlock[]> {
  if (typeof content === 'string') return [{ text: content }];
  if (!Array.isArray(content)) return [{ text: '' }];
  const blocks: ToolResultContentBlock[] = [];
  for (const c of content as Array<{
    type?: string;
    text?: string;
    source?: ImageBlockParam['source'] | unknown;
    [k: string]: unknown;
  }>) {
    if (c.type === 'text') {
      // Bedrock rejects empty-text ToolResultContentBlocks — placeholder
      // empty turns to keep the position alignment.
      blocks.push({ text: c.text ?? '' } as ToolResultContentBlock);
      continue;
    }
    if (c.type === 'image') {
      // F-F11: Anthropic's tool_result content can include image
      // blocks; Bedrock's ToolResultContentBlock natively supports
      // an ImageMember variant on Claude 3+ / Nova.
      const imageBlock = await mapAnthropicImageBlock(
        c as Extract<AnthropicContentBlockParam, { type: 'image' }>
      );
      if (imageBlock?.image) {
        blocks.push({ image: imageBlock.image } as ToolResultContentBlock);
      }
      continue;
    }
    if (c.type === 'document') {
      const documentBlock = await mapAnthropicDocumentBlock(
        c as Extract<AnthropicContentBlockParam, { type: 'document' }>
      );
      if (documentBlock?.document) {
        blocks.push({
          document: documentBlock.document,
        } as ToolResultContentBlock);
      }
      continue;
    }
    if (c.type === 'search_result') {
      // Convert search_result block to Converse searchResult variant.
      const sr = c as {
        source?: string;
        title?: string;
        content?: Array<{ type?: string; text?: string }>;
      };
      const textContent = (sr.content ?? [])
        .map((p) => (p.type === 'text' ? { text: p.text ?? '' } : undefined))
        .filter((p): p is { text: string } => p !== undefined);
      blocks.push({
        searchResult: {
          source: sr.source ?? '',
          title: sr.title ?? '',
          content: textContent,
        },
      } as ToolResultContentBlock);
      continue;
    }
    // tool_reference and other variants have no Converse equivalent
    // — dropped.
  }
  if (blocks.length === 0) return [{ text: '' }];
  return blocks;
}

function mapAnthropicToolsToConverse(
  tools?: AnthropicToolUnion[]
): ConverseTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  const out: ConverseTool[] = [];
  // Bedrock Converse's `toolConfig.tools[]` only accepts custom
  // `toolSpec` entries — no built-in `web_search` / `code_execution` /
  // etc. analogue. Reject server tools explicitly so the customer
  // sees the gap rather than wondering why their declared tool went
  // unused.
  const unsupported: string[] = [];
  for (const t of tools) {
    const family = classifyAnthropicServerTool(t);
    if (family !== 'custom') {
      unsupported.push((t as { type?: string }).type ?? family);
      continue;
    }
    const ct = t as AnthropicTool;
    // F-F6: zero-arg tools (or callers that pass `{}`) hit a stricter
    // Claude variant's "must be of type object" 400 unless we pass
    // the canonical empty-object schema. Mirrors both sibling cells.
    const schema =
      ct.input_schema &&
      typeof ct.input_schema === 'object' &&
      Object.keys(ct.input_schema).length > 0
        ? ct.input_schema
        : DEFAULT_CONVERSE_TOOL_INPUT_SCHEMA;
    out.push({
      toolSpec: {
        name: ct.name,
        description: ct.description,
        inputSchema: {
          json: schema as DocumentType,
        },
        strict: ct.strict,
      },
    });
    const cc = (
      ct as { cache_control?: { type: 'ephemeral'; ttl?: '5m' | '1h' } }
    ).cache_control;
    if (cc) {
      out.push({
        cachePoint: {
          type: 'default',
          ...(cc.ttl ? { ttl: cc.ttl } : {}),
        },
      } as ConverseTool);
    }
  }
  if (unsupported.length > 0) {
    raiseUnsupportedServerTool(unsupported, 'bedrock_converse');
  }
  return out.length > 0 ? out : undefined;
}

function mapAnthropicToolChoiceToConverse(
  choice?: AnthropicToolChoice
): ConverseToolChoice | undefined {
  if (!choice) return undefined;
  switch (choice.type) {
    case 'auto':
      return { auto: {} };
    case 'any':
      return { any: {} };
    case 'tool':
      return { tool: { name: choice.name } };
    default:
      // F-F7: `disable_parallel_tool_use` has no Converse-native
      // equivalent; the choice variant survives this switch via
      // `auto`/`any`/`tool` above. The flag is documented-gap.
      return undefined;
  }
}

// ─── Response side (non-streaming) ─────────────────────────────────

/**
 * F-M5: build Anthropic's `cache_creation` per-TTL breakdown from
 * Bedrock's `cacheDetails` array. Bedrock emits the breakdown when
 * caching actually fired and the granular field is present on the
 * 0.95.1 SDK Usage type. Defaults to zeros so the field is always
 * non-null when overall caching happened.
 */
function mapCacheCreation(
  cacheDetails: Array<{ ttl?: '5m' | '1h'; inputTokens?: number }> | undefined,
  cacheWriteInputTokens: number | null | undefined
): CacheCreation | null {
  if (
    !cacheDetails ||
    cacheDetails.length === 0 ||
    cacheWriteInputTokens == null
  ) {
    return null;
  }
  let ephemeral_5m_input_tokens = 0;
  let ephemeral_1h_input_tokens = 0;
  for (const detail of cacheDetails) {
    if (detail.ttl === '5m') {
      ephemeral_5m_input_tokens += detail.inputTokens ?? 0;
    } else if (detail.ttl === '1h') {
      ephemeral_1h_input_tokens += detail.inputTokens ?? 0;
    }
  }
  return {
    ephemeral_5m_input_tokens,
    ephemeral_1h_input_tokens,
  };
}

export function responseConverseToAnthropic(
  resp: ConverseCommandOutput,
  model: string
): AnthropicMessage {
  const content: AnthropicMessage['content'] = [];
  for (const block of resp.output?.message?.content ?? []) {
    if (block.text) {
      // F-F4: TextBlock requires `citations: null` on SDK 0.95.1.
      content.push({
        type: 'text',
        text: block.text,
        citations: null,
      } as AnthropicMessage['content'][number]);
    } else if (block.toolUse) {
      content.push({
        type: 'tool_use',
        id: block.toolUse.toolUseId ?? uuidv4(),
        name: block.toolUse.name ?? '',
        input: (block.toolUse.input as Record<string, unknown>) ?? {},
        // F-F4: ToolUseBlock requires `caller` on SDK 0.95.1 — a
        // Bedrock-side tool call surfaces as the direct-caller variant.
        caller: { type: 'direct' },
      } as AnthropicMessage['content'][number]);
    } else if (block.reasoningContent?.reasoningText) {
      content.push({
        type: 'thinking',
        thinking: block.reasoningContent.reasoningText.text ?? '',
        signature: block.reasoningContent.reasoningText.signature ?? '',
      } as AnthropicMessage['content'][number]);
    } else if (block.reasoningContent?.redactedContent) {
      // F-F5: surface RedactedThinkingBlock — the round-trip back into
      // a follow-up request will land it on `reasoningContent.redactedContent`
      // via the request-side mapper above.
      const data = block.reasoningContent.redactedContent;
      const buf = Buffer.isBuffer(data)
        ? data
        : Buffer.from(data as Uint8Array);
      content.push({
        type: 'redacted_thinking',
        data: buf.toString('base64'),
      } as AnthropicMessage['content'][number]);
    }
  }

  const stopReason: AnthropicMessage['stop_reason'] = resp.stopReason
    ? CONVERSE_STOP_TO_ANTHROPIC[resp.stopReason] ?? 'end_turn'
    : 'end_turn';

  // F-M4: extract the matched stop sequence from
  // additionalModelResponseFields (requires the request to set
  // additionalModelResponseFieldPaths: ['/stop_sequence']).
  const stopSequence =
    stopReason === 'stop_sequence'
      ? (
          resp.additionalModelResponseFields as
            | { stop_sequence?: string }
            | undefined
        )?.stop_sequence ?? null
      : null;

  // F-M10: when GUARDRAIL_INTERVENED maps to 'refusal', Anthropic's
  // SDK Message expects a `stop_details: RefusalStopDetails` envelope.
  const stopDetails: {
    type: 'refusal';
    category: null;
    explanation: string | null;
  } | null =
    stopReason === 'refusal'
      ? { type: 'refusal', category: null, explanation: null }
      : null;

  const usage = resp.usage
    ? {
        input_tokens: resp.usage.inputTokens ?? 0,
        output_tokens: resp.usage.outputTokens ?? 0,
        cache_read_input_tokens: resp.usage.cacheReadInputTokens ?? null,
        cache_creation_input_tokens: resp.usage.cacheWriteInputTokens ?? null,
        // F-M5: granular cache_creation breakdown when Bedrock emits
        // cacheDetails alongside the cumulative count.
        cache_creation: mapCacheCreation(
          (
            resp.usage as {
              cacheDetails?: Array<{ ttl?: '5m' | '1h'; inputTokens?: number }>;
            }
          ).cacheDetails,
          resp.usage.cacheWriteInputTokens
        ),
        server_tool_use: null,
        service_tier: null,
        // F-F10: SDK 0.95.1 lists `inference_geo` as a required key
        // (nullable); not present on Bedrock TokenUsage.
        inference_geo: null,
      }
    : undefined;

  // F-F10: Anthropic SDK 0.95.1 Message requires `container` and
  // `stop_details` keys (nullable). Setting them explicitly so the
  // returned object satisfies the SDK shape verbatim.
  return {
    id: `msg_${uuidv4()}`,
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: stopReason,
    stop_sequence: stopSequence,
    container: null,
    stop_details: stopDetails,
    ...(usage ? { usage } : {}),
  } as AnthropicMessage;
}

// ─── Stream side ───────────────────────────────────────────────────

/**
 * Build the canonical `message_start.message` skeleton with every
 * required field populated to the SDK 0.95.1 shape — usage carries
 * all 8 fields (input_tokens, output_tokens, cache_creation_input_tokens,
 * cache_read_input_tokens, cache_creation, server_tool_use, service_tier,
 * inference_geo), and Message itself carries `container` /
 * `stop_details`. Bedrock's `messageStart` doesn't include token
 * counts (they only arrive at the trailing `metadata` event), so the
 * leading `message_start.usage` is zero-initialised.
 */
function buildStreamStartMessage(
  messageId: string,
  model: string
): AnthropicMessage {
  return {
    id: messageId,
    type: 'message',
    role: 'assistant',
    model,
    content: [],
    stop_reason: null,
    stop_sequence: null,
    container: null,
    stop_details: null,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      cache_creation: null,
      server_tool_use: null,
      service_tier: null,
      inference_geo: null,
    },
  } as AnthropicMessage;
}

export async function* streamConverseToAnthropic(
  source: AsyncIterable<ConverseStreamOutput>,
  model: string
): AsyncIterable<RawMessageStreamEvent> {
  const messageId = `msg_${uuidv4()}`;
  let outputBlocks = 0;
  const blockKinds = new Map<number, 'text' | 'tool_use' | 'thinking'>();
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadInput: number | null = null;
  let cacheCreationInput: number | null = null;
  let cacheCreationBreakdown: CacheCreation | null = null;
  let stopReason: AnthropicMessage['stop_reason'] | null = null;
  let stopSequence: string | null = null;
  let messageStartEmitted = false;

  for await (const item of source) {
    if (item.messageStart) {
      yield {
        type: 'message_start',
        message: buildStreamStartMessage(messageId, model),
      } as RawMessageStreamEvent;
      messageStartEmitted = true;
      continue;
    }
    if (item.contentBlockStart) {
      const idx = item.contentBlockStart.contentBlockIndex ?? outputBlocks;
      const start = item.contentBlockStart.start;
      if (start?.toolUse) {
        blockKinds.set(idx, 'tool_use');
        yield {
          type: 'content_block_start',
          index: idx,
          content_block: {
            type: 'tool_use',
            id: start.toolUse.toolUseId ?? uuidv4(),
            name: start.toolUse.name ?? '',
            input: {},
            // F-F4: ToolUseBlock requires `caller` on SDK 0.95.1.
            caller: { type: 'direct' },
          },
        } as RawMessageStreamEvent;
      }
      continue;
    }
    if (item.contentBlockDelta) {
      const idx = item.contentBlockDelta.contentBlockIndex ?? outputBlocks;
      const delta = item.contentBlockDelta.delta;
      if (delta?.text != null) {
        if (!blockKinds.has(idx)) {
          blockKinds.set(idx, 'text');
          yield {
            type: 'content_block_start',
            index: idx,
            // F-F4: TextBlock requires `citations: null` on SDK 0.95.1.
            content_block: { type: 'text', text: '', citations: null },
          } as RawMessageStreamEvent;
        }
        yield {
          type: 'content_block_delta',
          index: idx,
          delta: { type: 'text_delta', text: delta.text },
        } as RawMessageStreamEvent;
      } else if (delta?.toolUse) {
        if (!blockKinds.has(idx)) blockKinds.set(idx, 'tool_use');
        yield {
          type: 'content_block_delta',
          index: idx,
          delta: {
            type: 'input_json_delta',
            partial_json: delta.toolUse.input ?? '',
          },
        } as RawMessageStreamEvent;
      } else if (delta?.reasoningContent) {
        if (!blockKinds.has(idx)) {
          blockKinds.set(idx, 'thinking');
          yield {
            type: 'content_block_start',
            index: idx,
            content_block: {
              type: 'thinking',
              thinking: '',
              signature: '',
            },
          } as RawMessageStreamEvent;
        }
        // F-L5: typeof guard (parity with the text-delta branch) —
        // empty-string thinking deltas are valid events the model can
        // emit between blocks and should be forwarded, not dropped.
        if (typeof delta.reasoningContent.text === 'string') {
          yield {
            type: 'content_block_delta',
            index: idx,
            delta: {
              type: 'thinking_delta',
              thinking: delta.reasoningContent.text,
            },
          } as RawMessageStreamEvent;
        }
        // F-L5 (HIGH): signature deltas were silently dropped, so
        // signed-thinking blocks never round-tripped through the stream.
        // Anthropic's SSE protocol emits a `signature_delta` event
        // right before `content_block_stop` on thinking blocks; pass
        // it through verbatim.
        const sigDelta = (delta.reasoningContent as { signature?: string })
          .signature;
        if (typeof sigDelta === 'string') {
          yield {
            type: 'content_block_delta',
            index: idx,
            delta: {
              type: 'signature_delta',
              signature: sigDelta,
            },
          } as RawMessageStreamEvent;
        }
      }
      continue;
    }
    if (item.contentBlockStop) {
      const idx = item.contentBlockStop.contentBlockIndex ?? outputBlocks;
      yield {
        type: 'content_block_stop',
        index: idx,
      } as RawMessageStreamEvent;
      outputBlocks = Math.max(outputBlocks, idx + 1);
      continue;
    }
    if (item.messageStop) {
      stopReason = item.messageStop.stopReason
        ? CONVERSE_STOP_TO_ANTHROPIC[item.messageStop.stopReason] ?? 'end_turn'
        : 'end_turn';
      // F-M6: capture the matched stop_sequence from the trailing
      // additionalModelResponseFields blob so the final message_delta
      // can populate stop_sequence (per Anthropic streaming spec).
      const fields = item.messageStop.additionalModelResponseFields as
        | { stop_sequence?: string }
        | undefined;
      if (fields?.stop_sequence) stopSequence = fields.stop_sequence;
      continue;
    }
    if (item.metadata?.usage) {
      const u = item.metadata.usage;
      inputTokens = u.inputTokens ?? inputTokens;
      outputTokens = u.outputTokens ?? outputTokens;
      cacheReadInput = u.cacheReadInputTokens ?? cacheReadInput;
      cacheCreationInput = u.cacheWriteInputTokens ?? cacheCreationInput;
      const cacheDetails = (
        u as {
          cacheDetails?: Array<{ ttl?: '5m' | '1h'; inputTokens?: number }>;
        }
      ).cacheDetails;
      const breakdown = mapCacheCreation(cacheDetails, cacheCreationInput);
      if (breakdown) cacheCreationBreakdown = breakdown;
    }
  }

  // Anthropic SSE always ends with message_delta (carrying stop_reason
  // + usage) followed by message_stop. Emit both even when Converse
  // didn't surface a metadata.usage event — clients rely on the
  // terminator pair.
  if (!messageStartEmitted) {
    yield {
      type: 'message_start',
      message: buildStreamStartMessage(messageId, model),
    } as RawMessageStreamEvent;
  }

  // F-M10: refusal stop_reason carries stop_details on Anthropic's
  // wire format — mirror that on the streaming terminal event so
  // refusal-aware consumers can branch.
  const stopDetails: {
    type: 'refusal';
    category: null;
    explanation: string | null;
  } | null =
    stopReason === 'refusal'
      ? { type: 'refusal', category: null, explanation: null }
      : null;

  yield {
    type: 'message_delta',
    delta: {
      stop_reason: stopReason ?? 'end_turn',
      stop_sequence: stopSequence,
      stop_details: stopDetails,
      container: null,
    },
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_read_input_tokens: cacheReadInput,
      cache_creation_input_tokens: cacheCreationInput,
      server_tool_use: null,
    },
  } as RawMessageStreamEvent;
  // Suppress unused-variable lint for the granular breakdown — it
  // surfaces on the non-streaming converter; Anthropic's streaming
  // MessageDeltaUsage shape does not currently expose `cache_creation`.
  void cacheCreationBreakdown;
  yield { type: 'message_stop' } as RawMessageStreamEvent;
}

// ─── Provider class ────────────────────────────────────────────────

@Injectable()
export class AWSBedrockConverseAnthropicMessagesProvider {
  constructor(private readonly dispatcher: AWSBedrockConverseDispatcher) {}

  async handle(
    request: AnthropicMessagesRequest,
    connection: AIConnectionEntity<AWSBedrockAIConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<AnthropicMessagesResponse> {
    // T19: pre-flight gate.
    if (request.tools?.length && request.tool_choice?.type !== 'none') {
      assertModelSupportsFeatures(model.model, { tools: true });
    }
    const input = await requestAnthropicToConverse(request, model.model);
    // T22: same fix as the Resp-input path — propagate the
    // connection's `performanceConfig.latency` onto the Converse
    // input.
    if (connection.config?.performanceConfig) {
      input.performanceConfig = {
        latency: connection.config.performanceConfig.latency,
      };
    }
    // T21: same Bedrock Guardrails config the Chat-input path
    // applies.
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

    if (
      native.data != null &&
      typeof (native.data as AsyncIterable<ConverseStreamOutput>)[
        Symbol.asyncIterator
      ] === 'function'
    ) {
      return {
        data: streamConverseToAnthropic(
          native.data as AsyncIterable<ConverseStreamOutput>,
          model.model
        ),
        headers: native.headers,
        providerRequestPayload: native.providerRequestPayload,
      };
    }
    return {
      data: responseConverseToAnthropic(
        native.data as ConverseCommandOutput,
        model.model
      ),
      headers: native.headers,
      providerRequestPayload: native.providerRequestPayload,
    };
  }
}
