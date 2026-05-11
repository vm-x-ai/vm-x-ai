import { HttpStatus } from '@nestjs/common';
import type {
  ChatCompletion,
  ChatCompletionAssistantMessageParam,
  ChatCompletionChunk,
  ChatCompletionContentPart,
  ChatCompletionCreateParams,
  ChatCompletionMessageToolCall,
  ChatCompletionToolMessageParam,
  ChatCompletionUserMessageParam,
} from 'openai/resources/index.js';
import type {
  ImageBlockParam,
  RawMessageStreamEvent,
  Tool as SdkTool,
  ToolResultBlockParam,
  ToolUseBlockParam,
} from '@anthropic-ai/sdk/resources/messages';
import { v4 as uuidv4 } from 'uuid';
import type { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import { CompletionError } from '../../gateway/completion.types';
import type {
  AnthropicContentBlockParam,
  AnthropicMessage,
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
  AnthropicStopReason,
  AnthropicTextBlockParam,
  AnthropicTool,
  AnthropicToolChoice,
} from '../../gateway/anthropic/anthropic.types';
import {
  takePassthroughEnvelope,
  type WithPassthrough,
} from '../passthrough.helpers';
import type { AnthropicPassthrough } from '../../gateway/anthropic/anthropic-converter';

/**
 * Pure converters between OpenAI Chat Completions and Anthropic
 * Messages API shapes — shared between every provider that speaks
 * Anthropic on the wire (`AWSBedrockInvokeProvider`, native
 * `AnthropicProvider`).
 *
 * This module is the single source of truth for the OpenAI ↔ Anthropic
 * mapping; provider classes stay thin and only handle transport
 * (creating the SDK client, threading credentials, attaching the
 * audit `providerRequestPayload`).
 */

export const ANTHROPIC_STOP_REASONS_MAP: Record<
  AnthropicStopReason,
  ChatCompletion.Choice['finish_reason']
> = {
  end_turn: 'stop',
  max_tokens: 'length',
  stop_sequence: 'stop',
  tool_use: 'tool_calls',
  pause_turn: 'stop',
  refusal: 'content_filter',
};

/**
 * Per-block parser state used by the streaming converter. Tool_use
 * blocks accumulate JSON via input_json_delta; thinking blocks
 * accumulate signed reasoning; we track them here so message_stop can
 * emit the final aggregate on the OpenAI-shape `delta.reasoning`
 * extension.
 *
 * `structured_output` is a synthetic state for tool_use blocks that
 * came from the OpenAI `response_format: json_schema` translation —
 * they get unwrapped back into `delta.content` (a JSON string) instead
 * of being surfaced as a tool call, so OpenAI clients see the
 * structured-output contract they asked for.
 */
type StreamBlockState = {
  type:
    | 'text'
    | 'tool_use'
    | 'thinking'
    | 'redacted_thinking'
    | 'structured_output'
    | 'other';
  toolCallIndex?: number;
};

/**
 * Sentinel tool name used when translating OpenAI's
 * `response_format: { type: 'json_schema', json_schema: {...} }` into
 * Anthropic's tool-based structured-output pattern. The request side
 * adds a synthetic tool with this name and forces the model to call
 * it; the response side recognises the name and unwraps the tool
 * input into `message.content` as the JSON string the OpenAI caller
 * expects. Picked to be unlikely to collide with a real user tool.
 */
const STRUCTURED_OUTPUT_TOOL_NAME = '__vmx_structured_output__';

/**
 * Options recognised by `openAIRequestToAnthropic`. Each consumer flips
 * the bits that match its upstream's contract — native Anthropic and
 * AWS Bedrock-Invoke speak the same Messages API but Bedrock can't
 * fetch external image URLs, so callers targeting Bedrock pass
 * `rejectExternalImageUrls: true` to fail fast at the gateway boundary
 * instead of round-tripping a 400 from the wire.
 */
export type OpenAIToAnthropicOptions = {
  /** Default `max_tokens` when the request doesn't specify one. */
  defaultMaxTokens?: number;
  /**
   * Reject external image URLs (anything that isn't a `data:` base64
   * URL). Bedrock Invoke can't fetch URLs server-side; native
   * Anthropic accepts `{type:'url', url}` so leave this `false` for
   * AnthropicProvider and `true` for AWSBedrockInvokeProvider.
   */
  rejectExternalImageUrls?: boolean;
};

/**
 * Bedrock-Invoke wire body for Anthropic Claude models — same as the
 * canonical `AnthropicMessagesRequest` but with `model`/`stream`
 * stripped (those go on the InvokeModel command) and an
 * `anthropic_version` discriminator. Re-exported so providers don't
 * have to redefine the shape.
 */
export type BedrockInvokeWireBody = Omit<
  AnthropicMessagesRequest,
  'model' | 'stream'
> & { anthropic_version: string };

// ───────────────────────────────────────────────────────────────────────
// OpenAI → Anthropic (request body)
// ───────────────────────────────────────────────────────────────────────

/**
 * Convert an OpenAI Chat Completions request into an Anthropic
 * Messages API body. Honours the `__vmx_passthrough.anthropic`
 * envelope so cache_control markers, thinking config, top_k, server
 * tools, service_tier, container, etc. survive the OpenAI pivot.
 *
 * The returned body is in the canonical Anthropic shape (no
 * `anthropic_version` discriminator) — providers tack on transport-
 * specific fields like `anthropic_version` for Bedrock InvokeModel
 * themselves.
 */
export function openAIRequestToAnthropic(
  request: ChatCompletionCreateParams,
  options: OpenAIToAnthropicOptions = {}
): AnthropicMessagesRequest {
  const { body: cleanRequest, anthropic: passthrough } =
    takePassthroughEnvelope(request);
  const systemParts: AnthropicTextBlockParam[] = [];
  const messages: AnthropicMessage[] = [];

  for (const message of cleanRequest.messages) {
    if (message.role === 'system' || message.role === 'developer') {
      systemParts.push(...extractSystemText(message.content));
      continue;
    }

    if (message.role === 'user') {
      messages.push({
        role: 'user',
        content: convertUserContent(
          message as ChatCompletionUserMessageParam,
          options
        ),
      });
    } else if (message.role === 'assistant') {
      messages.push({
        role: 'assistant',
        content: convertAssistantContent(
          message as ChatCompletionAssistantMessageParam
        ),
      });
    } else if (message.role === 'tool') {
      const toolMessage = message as ChatCompletionToolMessageParam;
      const block: ToolResultBlockParam = {
        type: 'tool_result',
        tool_use_id: toolMessage.tool_call_id,
        content:
          typeof toolMessage.content === 'string'
            ? toolMessage.content
            : toolMessage.content.map((part) => ({
                type: 'text' as const,
                text: part.text,
              })),
      };
      // Anthropic requires tool_result blocks inside a user message;
      // coalesce consecutive tool results into the same user message.
      const last = messages[messages.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        last.content.push(block);
      } else {
        messages.push({ role: 'user', content: [block] });
      }
    }
  }

  const body: AnthropicMessagesRequest = {
    model: cleanRequest.model,
    max_tokens:
      cleanRequest.max_completion_tokens ??
      cleanRequest.max_tokens ??
      options.defaultMaxTokens ??
      4096,
    messages,
  };

  if (systemParts.length > 0) {
    body.system = systemParts;
  }
  if (
    cleanRequest.temperature !== null &&
    cleanRequest.temperature !== undefined
  ) {
    body.temperature = cleanRequest.temperature;
  }
  if (cleanRequest.top_p !== null && cleanRequest.top_p !== undefined) {
    body.top_p = cleanRequest.top_p;
  }
  if (cleanRequest.stop) {
    // Filter empty strings — Anthropic rejects `stop_sequences: ['']`
    // (treats it as a stop on every token), and clients sometimes
    // send `stop: ''` to mean "no stop". Normalising here keeps the
    // wire body well-formed.
    const stops = (
      Array.isArray(cleanRequest.stop) ? cleanRequest.stop : [cleanRequest.stop]
    ).filter((s) => typeof s === 'string' && s.length > 0);
    if (stops.length > 0) body.stop_sequences = stops;
  }
  if (cleanRequest.stream != null) {
    body.stream = cleanRequest.stream;
  }

  const tools = convertTools(cleanRequest);
  if (tools && tools.length > 0) {
    body.tools = tools;
    const toolChoice = convertToolChoice(cleanRequest);
    if (toolChoice) {
      body.tool_choice = toolChoice;
    }
  }

  // Translate `response_format: { type: 'json_schema', ... }` into a
  // forced tool call. Anthropic doesn't support OpenAI's structured-
  // output flag directly, but its tool-input schema validation gives
  // us the same guarantee: force the model to emit valid JSON
  // matching the schema. Response-side, the tool input is unwrapped
  // back into `message.content`.
  applyStructuredOutput(body, cleanRequest);

  // Map OpenAI-specific extras to Anthropic equivalents.
  applyOpenAIExtras(body, cleanRequest);

  // Re-attach Anthropic-only fields stowed by the gateway converter
  // last so they win over the OpenAI-side mapping.
  if (passthrough) {
    applyPassthrough(body, systemParts, passthrough);
  }

  return body;
}

function extractSystemText(
  content: string | Array<{ type: string; text?: string }>
): AnthropicTextBlockParam[] {
  if (typeof content === 'string') {
    return content.length > 0 ? [{ type: 'text', text: content }] : [];
  }
  return content
    .filter((part) => part.type === 'text' && part.text)
    .map((part) => ({ type: 'text' as const, text: part.text as string }));
}

function convertUserContent(
  message: ChatCompletionUserMessageParam,
  options: OpenAIToAnthropicOptions = {}
): string | AnthropicContentBlockParam[] {
  if (typeof message.content === 'string') {
    return message.content;
  }

  const blocks: AnthropicContentBlockParam[] = [];
  for (const part of message.content as ChatCompletionContentPart[]) {
    if (part.type === 'text') {
      blocks.push({ type: 'text', text: part.text });
    } else if (part.type === 'image_url') {
      const parsed = parseImageDataUrl(part.image_url.url);
      if (parsed) {
        blocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: parsed.mediaType as ImageBlockParam['source'] extends {
              type: 'base64';
              media_type: infer M;
            }
              ? M
              : never,
            data: parsed.data,
          },
        });
      } else if (options.rejectExternalImageUrls) {
        // Bedrock InvokeModel can't fetch external URLs; fail fast at
        // the gateway boundary so the caller gets a clean 400 instead
        // of a noisy upstream error.
        throw new CompletionError({
          message:
            'AWS Bedrock Invoke (Anthropic) requires base64 data URLs for images, not external URLs',
          rate: false,
          retryable: false,
          statusCode: HttpStatus.BAD_REQUEST,
          failureReason:
            'Anthropic Messages API does not accept external image URLs',
          openAICompatibleError: {
            code: 'aws_bedrock_invoke_image_url_unsupported',
          },
        });
      } else {
        // External URL → native Anthropic supports `{type:'url', url}`.
        blocks.push({
          type: 'image',
          source: {
            type: 'url',
            url: part.image_url.url,
          },
        });
      }
    } else if ((part as { type?: string }).type === 'file') {
      // T8: OpenAI Chat content part `file: { file_data: 'data:...;base64,...', filename? }`
      // → Anthropic `document` block. Lets PDFs round-trip through
      // Chat→Anthropic→Invoke (and Chat→Anthropic native) without
      // being silently dropped — the previous adapter only handled
      // text + image content parts.
      const filePart = part as {
        type: 'file';
        file: { file_data?: string; file_id?: string; filename?: string };
      };
      const parsedFile = parseImageDataUrl(filePart.file?.file_data ?? '');
      if (parsedFile) {
        const docBlock: AnthropicContentBlockParam = {
          type: 'document',
          source: {
            type: 'base64',
            // Anthropic accepts `application/pdf` plus a few text
            // formats; pass whatever media_type the data URL declared.
            media_type: parsedFile.mediaType as never,
            data: parsedFile.data,
          },
          ...(filePart.file?.filename ? { title: filePart.file.filename } : {}),
        } as AnthropicContentBlockParam;
        blocks.push(docBlock);
      }
      // file_id-only sources (`{file_id: 'file_abc'}`) require the
      // Files API beta header — leave to T9's `betas[]` plumbing for
      // a follow-up; today we silently skip.
    }
  }
  return blocks;
}

function convertAssistantContent(
  message: ChatCompletionAssistantMessageParam
): AnthropicContentBlockParam[] {
  const blocks: AnthropicContentBlockParam[] = [];

  if (typeof message.content === 'string' && message.content.length > 0) {
    blocks.push({ type: 'text', text: message.content });
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part.type === 'text') {
        blocks.push({ type: 'text', text: part.text });
      }
    }
  }

  // Re-emit thinking blocks the model returned in a prior turn so
  // multi-turn extended-thinking continuity works (Anthropic requires
  // the assistant to send back the signed reasoning in the next turn).
  const reasoning = (
    message as ChatCompletionAssistantMessageParam & {
      reasoning?: {
        thinking?: string;
        signature?: string;
        redacted?: string[];
      };
    }
  ).reasoning;
  if (reasoning?.redacted) {
    for (const data of reasoning.redacted) {
      blocks.push({ type: 'redacted_thinking', data });
    }
  }
  if (reasoning?.thinking) {
    blocks.push({
      type: 'thinking',
      thinking: reasoning.thinking,
      signature: reasoning.signature ?? '',
    });
  }

  if (message.tool_calls) {
    for (const toolCall of message.tool_calls) {
      if (toolCall.type === 'function') {
        const useBlock: ToolUseBlockParam = {
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.function.name,
          input: parseToolArguments(toolCall.function.arguments),
        };
        blocks.push(useBlock);
      }
    }
  }

  return blocks;
}

function parseImageDataUrl(
  url: string
): { mediaType: string; data: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(url);
  if (!match) return null;
  return { mediaType: match[1], data: match[2] };
}

function parseToolArguments(args: string): unknown {
  try {
    return JSON.parse(args || '{}');
  } catch {
    return args;
  }
}

function convertTools(
  request: ChatCompletionCreateParams
): AnthropicTool[] | undefined {
  if (!request.tools?.length && !request.functions?.length) {
    return undefined;
  }
  const tools: AnthropicTool[] = [];
  for (const tool of request.tools ?? []) {
    if (tool.type === 'function' && tool.function.name) {
      tools.push({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: coerceInputSchema(tool.function.parameters),
      });
    }
  }
  for (const fn of request.functions ?? []) {
    if (fn.name) {
      tools.push({
        name: fn.name,
        description: fn.description,
        input_schema: coerceInputSchema(fn.parameters),
      });
    }
  }
  return tools;
}

function coerceInputSchema(raw: unknown): SdkTool['input_schema'] {
  if (
    raw &&
    typeof raw === 'object' &&
    (raw as { type?: unknown }).type === 'object'
  ) {
    return raw as SdkTool['input_schema'];
  }
  return {
    type: 'object',
    ...((raw as object) ?? {}),
  } as SdkTool['input_schema'];
}

function convertToolChoice(
  request: ChatCompletionCreateParams
): AnthropicToolChoice | undefined {
  if (request.tool_choice === 'auto') return { type: 'auto' };
  if (request.tool_choice === 'required') return { type: 'any' };
  if (request.tool_choice === 'none') return { type: 'none' };
  if (
    typeof request.tool_choice === 'object' &&
    request.tool_choice.type === 'function'
  ) {
    return { type: 'tool', name: request.tool_choice.function.name };
  }
  if (request.function_call === 'auto') return { type: 'auto' };
  if (request.function_call === 'none') return { type: 'none' };
  if (
    typeof request.function_call === 'object' &&
    request.function_call?.name
  ) {
    return { type: 'tool', name: request.function_call.name };
  }
  return undefined;
}

function applyOpenAIExtras(
  body: AnthropicMessagesRequest,
  request: ChatCompletionCreateParams
): void {
  // `parallel_tool_calls: false` → tool_choice.disable_parallel_tool_use
  if (
    request.parallel_tool_calls === false &&
    body.tool_choice &&
    body.tool_choice.type !== 'none'
  ) {
    (
      body.tool_choice as { disable_parallel_tool_use?: boolean }
    ).disable_parallel_tool_use = true;
  }
  const reqExtras = request as unknown as {
    service_tier?: string | null;
    reasoning_effort?: 'minimal' | 'low' | 'medium' | 'high' | null;
  };
  if (
    reqExtras.service_tier === 'auto' ||
    reqExtras.service_tier === 'standard_only'
  ) {
    body.service_tier = reqExtras.service_tier;
  }
  if (reqExtras.reasoning_effort && !body.thinking) {
    body.thinking = mapReasoningEffortToThinking(
      reqExtras.reasoning_effort,
      body.max_tokens
    );
  }
}

/**
 * If the OpenAI request uses `response_format: { type: 'json_schema',
 * json_schema: { schema, ... } }`, append a synthetic tool whose
 * `input_schema` is the supplied JSON schema and force the model to
 * call it. Anthropic's tool-input validation gives us the strict-
 * JSON-output guarantee OpenAI's structured-output flag provides.
 *
 * No-op for `response_format: { type: 'json_object' }` (free-form
 * JSON, no schema) and for any unrecognised shape — those just pass
 * through unchanged so older clients keep working.
 */
/**
 * Append a synthetic `__vmx_structured_output__` tool whose
 * `input_schema` is `schema`, and force the model to call it. Used by
 * both the Chat (`response_format: json_schema`) and Resp
 * (`text.format: json_schema`) converters to give Anthropic
 * structured-output semantics that match OpenAI's flag.
 */
export function applyStructuredOutputFromSchema(
  body: AnthropicMessagesRequest,
  schema: Record<string, unknown>,
  name?: string,
  description?: string
): void {
  const sotool: AnthropicTool = {
    name: STRUCTURED_OUTPUT_TOOL_NAME,
    description:
      description ??
      `Return the response as a JSON object that conforms to the${
        name ? ` "${name}"` : ''
      } schema.`,
    input_schema: coerceInputSchema(schema),
  };
  body.tools = [...(body.tools ?? []), sotool];
  body.tool_choice = { type: 'tool', name: STRUCTURED_OUTPUT_TOOL_NAME };
}

function applyStructuredOutput(
  body: AnthropicMessagesRequest,
  request: ChatCompletionCreateParams
): void {
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
    return;
  }
  applyStructuredOutputFromSchema(
    body,
    jsonSchema.schema,
    jsonSchema.name,
    jsonSchema.description
  );
}

function mapReasoningEffortToThinking(
  effort: 'minimal' | 'low' | 'medium' | 'high' | null,
  maxTokens: number
): AnthropicMessagesRequest['thinking'] {
  if (!effort || effort === 'minimal') {
    return { type: 'disabled' };
  }
  const budgetByEffort: Record<'low' | 'medium' | 'high', number> = {
    low: 2048,
    medium: 8192,
    high: Math.max(1024, Math.floor(maxTokens * 0.5)),
  };
  const budget = Math.max(
    1024,
    Math.min(budgetByEffort[effort], maxTokens - 1)
  );
  return { type: 'enabled', budget_tokens: budget };
}

export function applyPassthrough(
  body: AnthropicMessagesRequest,
  systemParts: AnthropicTextBlockParam[],
  passthrough: AnthropicPassthrough
): void {
  if (passthrough.thinking) body.thinking = passthrough.thinking;
  if (typeof passthrough.top_k === 'number') body.top_k = passthrough.top_k;
  if (passthrough.service_tier) body.service_tier = passthrough.service_tier;
  if (passthrough.metadata) body.metadata = passthrough.metadata;
  if (passthrough.container !== undefined) {
    body.container = passthrough.container;
  }
  if (passthrough.cache_control) {
    body.cache_control = passthrough.cache_control;
  }
  if (passthrough.tool_choice && body.tool_choice) {
    body.tool_choice = passthrough.tool_choice;
  }
  if (passthrough.system_cache_breakpoints && systemParts.length > 0) {
    for (const bp of passthrough.system_cache_breakpoints) {
      const part = systemParts[bp.index];
      if (part) part.cache_control = bp.cache_control;
    }
  }
  if (passthrough.tool_cache_breakpoints && body.tools) {
    for (const bp of passthrough.tool_cache_breakpoints) {
      const tool = body.tools[bp.index];
      if (tool && 'name' in tool) {
        (tool as SdkTool).cache_control = bp.cache_control;
      }
    }
  }
  if (passthrough.server_tools && passthrough.server_tools.length > 0) {
    body.tools = [
      ...(body.tools ?? []),
      ...(passthrough.server_tools as NonNullable<
        AnthropicMessagesRequest['tools']
      >),
    ];
  }
  // T9: Anthropic-only knobs the canonical converter now captures.
  if (passthrough.mcp_servers && passthrough.mcp_servers.length > 0) {
    body.mcp_servers = passthrough.mcp_servers;
  }
  if (passthrough.context_management) {
    body.context_management = passthrough.context_management;
  }
  if (passthrough.inference_geo) {
    body.inference_geo = passthrough.inference_geo;
  }
  if (passthrough.betas && passthrough.betas.length > 0) {
    (body as AnthropicMessagesRequest & { betas?: string[] }).betas =
      passthrough.betas;
  }
}

/**
 * Adapt a canonical client-facing Anthropic Messages body to the
 * Bedrock Invoke wire body. Strips request-envelope fields that don't
 * belong on the wire (`model`/`stream` are passed via the InvokeModel
 * command, not the JSON body) and the gateway-internal scaffolding
 * (`vmx`, `__vmx_passthrough`) Anthropic would 400 on, then adds the
 * `anthropic_version` discriminator. Used by `AWSBedrockInvokeProvider`
 * for both the OpenAI-converted path and the Anthropic-input
 * passthrough path.
 */
export function canonicalAnthropicToBedrockInvoke(
  canonical: AnthropicMessagesRequest,
  anthropicVersion: string
): BedrockInvokeWireBody {
  const {
    model: _model,
    stream: _stream,
    vmx: _vmx,
    __vmx_passthrough: _envelope,
    // T10: Bedrock-Invoke's Anthropic body expects `anthropic_beta`,
    // not the `betas` field name the canonical Anthropic-API shape
    // uses. Strip `betas` here so the spread below doesn't leak it,
    // then re-emit under the correct key.
    betas,
    ...rest
  } = canonical as AnthropicMessagesRequest & {
    vmx?: unknown;
    __vmx_passthrough?: unknown;
  };
  void _model;
  void _stream;
  void _vmx;
  void _envelope;
  return {
    ...rest,
    anthropic_version: anthropicVersion,
    ...(betas && betas.length > 0 ? { anthropic_beta: betas } : {}),
  } as BedrockInvokeWireBody;
}

/**
 * Validate that an Anthropic Messages request is targeting a Claude
 * model. Used by providers that only support Anthropic-family models
 * (Bedrock-Invoke for Anthropic, native AnthropicProvider).
 */
export function assertClaudeModel(model: string): void {
  if (!/claude/i.test(model) && !/anthropic/i.test(model)) {
    throw new CompletionError({
      message: `This provider only supports Anthropic Claude models. Got: ${model}`,
      rate: false,
      retryable: false,
      statusCode: HttpStatus.BAD_REQUEST,
      failureReason: 'Unsupported model for Anthropic provider',
      openAICompatibleError: { code: 'anthropic_unsupported_model' },
    });
  }
}

// ───────────────────────────────────────────────────────────────────────
// Anthropic → OpenAI (response body)
// ───────────────────────────────────────────────────────────────────────

/**
 * Convert a non-streaming Anthropic Messages response into an OpenAI
 * Chat Completion. Surfaces Anthropic-only fields — thinking blocks,
 * cache_creation tokens, server_tool_use counts, refusal stop_details
 * — as OpenAI extensions so the audit row + cost reader pick them up
 * and the gateway can round-trip back into Anthropic format on the
 * way out.
 */
export function anthropicResponseToChatCompletion(
  response: AnthropicMessagesResponse,
  model: AIResourceModelConfigEntity
): ChatCompletion {
  let content = '';
  const toolCalls: ChatCompletionMessageToolCall[] = [];
  let thinking = '';
  let thinkingSignature: string | undefined;
  const redactedThinking: string[] = [];
  let usedStructuredOutput = false;

  for (const block of response.content) {
    if (block.type === 'text') {
      content += block.text;
    } else if (block.type === 'thinking') {
      thinking += block.thinking;
      thinkingSignature = block.signature;
    } else if (block.type === 'redacted_thinking') {
      redactedThinking.push(block.data);
    } else if (block.type === 'tool_use') {
      // Synthetic tool used by the OpenAI `response_format: json_schema`
      // translation — unwrap the tool input as the JSON content the
      // OpenAI caller asked for, and don't surface it as a tool call.
      if (block.name === STRUCTURED_OUTPUT_TOOL_NAME) {
        usedStructuredOutput = true;
        content +=
          typeof block.input === 'string'
            ? block.input
            : JSON.stringify(block.input);
      } else {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments:
              typeof block.input === 'string'
                ? block.input
                : JSON.stringify(block.input),
          },
        });
      }
    }
    // Server-tool blocks are dropped from the OpenAI pivot but
    // preserved verbatim in the audit row's responseData via the
    // native body capture pre-flight.
  }

  const refusal =
    response.stop_reason === 'refusal'
      ? response.stop_details?.type === 'refusal'
        ? response.stop_details.explanation
        : null
      : null;

  const completion: ChatCompletion = {
    id: response.id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: model.model,
    choices: [
      {
        index: 0,
        logprobs: null,
        message: {
          role: 'assistant',
          content,
          refusal: refusal ?? null,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        },
        finish_reason: usedStructuredOutput
          ? 'stop'
          : response.stop_reason
          ? ANTHROPIC_STOP_REASONS_MAP[response.stop_reason] ?? 'stop'
          : 'stop',
      },
    ],
    usage: {
      prompt_tokens: response.usage.input_tokens,
      completion_tokens: response.usage.output_tokens,
      total_tokens: response.usage.input_tokens + response.usage.output_tokens,
      prompt_tokens_details: {
        cached_tokens: response.usage.cache_read_input_tokens ?? 0,
      },
    },
  };

  const messageExt = completion.choices[0].message as unknown as Record<
    string,
    unknown
  >;
  if (thinking || redactedThinking.length > 0) {
    messageExt.reasoning = {
      thinking: thinking || undefined,
      signature: thinkingSignature,
      redacted: redactedThinking.length > 0 ? redactedThinking : undefined,
    };
  }
  const usageExt = completion.usage as unknown as Record<string, unknown> & {
    prompt_tokens_details?: Record<string, unknown>;
  };
  if (response.usage.cache_creation_input_tokens != null) {
    usageExt.prompt_tokens_details = {
      ...(usageExt.prompt_tokens_details ?? {}),
      cache_creation_input_tokens: response.usage.cache_creation_input_tokens,
    };
  }
  if (response.usage.cache_creation) {
    const ptd = usageExt.prompt_tokens_details ?? {};
    ptd.cache_creation = response.usage.cache_creation;
    usageExt.prompt_tokens_details = ptd;
  }
  if (response.usage.server_tool_use) {
    usageExt.server_tool_use = response.usage.server_tool_use;
  }

  return completion;
}

// ───────────────────────────────────────────────────────────────────────
// Anthropic stream → OpenAI Chat Completion chunks
// ───────────────────────────────────────────────────────────────────────

/**
 * Convert a stream of native Anthropic SSE events into OpenAI Chat
 * Completion chunks. Used by Bedrock-Invoke (parses `chunk.bytes`
 * events from the InvokeModel stream) and by the native
 * AnthropicProvider (consumes the SDK's `MessageStream`).
 *
 * `requestId` and `model` come from the transport layer; `eventSource`
 * is an async iterable of parsed `RawMessageStreamEvent`s the
 * provider hands in (the provider knows how to extract the events
 * from its specific SDK shape).
 *
 * Surfaces `thinking_delta` / `signature_delta` / cache tokens via
 * OpenAI extension fields (`delta.reasoning`,
 * `usage.prompt_tokens_details.cache_creation_input_tokens`,
 * `usage.server_tool_use`) — strict OpenAI clients ignore unknown
 * fields, native consumers via the audit row see them.
 */
export async function* anthropicStreamToChatCompletionChunks(
  eventSource: AsyncIterable<RawMessageStreamEvent>,
  options: {
    requestId?: string;
    model: string;
    /**
     * Hook fired before throwing inside the loop so providers can
     * attach their `providerRequestPayload` / map upstream
     * exceptions to `CompletionError` consistently.
     */
    onError?: (event: unknown) => never;
  }
): AsyncIterable<ChatCompletionChunk> {
  const created = Math.floor(Date.now() / 1000);
  const id = options.requestId ?? `anthropic-${uuidv4()}`;
  let promptTokens = 0;
  let cachedTokens = 0;
  let cacheCreationTokens: number | null = null;
  let cacheCreation:
    | AnthropicMessagesResponse['usage']['cache_creation']
    | null = null;
  let serverToolUse:
    | AnthropicMessagesResponse['usage']['server_tool_use']
    | null = null;
  let completionTokens = 0;
  let stopReason: AnthropicStopReason | null = null;
  let stopDetails: AnthropicMessagesResponse['stop_details'] | null = null;
  let thinkingAccum = '';
  let thinkingSignature: string | undefined;
  const redactedThinkingAccum: string[] = [];
  const blockState = new Map<number, StreamBlockState>();
  let nextToolCallIndex = 0;
  let usedStructuredOutput = false;

  for await (const event of eventSource) {
    const chunk: ChatCompletionChunk = {
      id,
      object: 'chat.completion.chunk',
      created,
      model: options.model,
      choices: [],
    };

    switch (event.type) {
      case 'message_start':
        if (event.message.usage) {
          promptTokens = event.message.usage.input_tokens ?? 0;
          cachedTokens = event.message.usage.cache_read_input_tokens ?? 0;
          cacheCreationTokens =
            event.message.usage.cache_creation_input_tokens ?? null;
          cacheCreation = event.message.usage.cache_creation ?? null;
          serverToolUse = event.message.usage.server_tool_use ?? null;
        }
        continue;

      case 'content_block_start':
        if (event.content_block.type === 'tool_use') {
          // Synthetic structured-output tool — treat the block as a
          // streaming text source whose content is the JSON the model
          // is producing (input_json_delta events get rewritten into
          // delta.content below). No tool_calls preamble; OpenAI
          // clients expect the JSON to land in `message.content`.
          if (event.content_block.name === STRUCTURED_OUTPUT_TOOL_NAME) {
            blockState.set(event.index, { type: 'structured_output' });
            usedStructuredOutput = true;
            continue;
          }
          const toolCallIndex = nextToolCallIndex++;
          blockState.set(event.index, {
            type: 'tool_use',
            toolCallIndex,
          });
          chunk.choices = [
            {
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [
                  {
                    index: toolCallIndex,
                    id: event.content_block.id,
                    type: 'function',
                    function: {
                      name: event.content_block.name,
                      arguments: '',
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ];
          yield chunk;
        } else if (event.content_block.type === 'text') {
          blockState.set(event.index, { type: 'text' });
        } else if (event.content_block.type === 'thinking') {
          blockState.set(event.index, { type: 'thinking' });
          if (event.content_block.thinking) {
            thinkingAccum += event.content_block.thinking;
          }
        } else if (event.content_block.type === 'redacted_thinking') {
          blockState.set(event.index, { type: 'redacted_thinking' });
          redactedThinkingAccum.push(event.content_block.data);
        } else {
          blockState.set(event.index, { type: 'other' });
        }
        continue;

      case 'content_block_delta': {
        const state = blockState.get(event.index);
        if (
          state?.type === 'structured_output' &&
          event.delta.type === 'input_json_delta'
        ) {
          chunk.choices = [
            {
              index: 0,
              delta: {
                role: 'assistant',
                content: event.delta.partial_json,
              },
              finish_reason: null,
            },
          ];
          yield chunk;
        } else if (
          state?.type === 'tool_use' &&
          event.delta.type === 'input_json_delta' &&
          state.toolCallIndex !== undefined
        ) {
          chunk.choices = [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: state.toolCallIndex,
                    function: { arguments: event.delta.partial_json },
                  },
                ],
              },
              finish_reason: null,
            },
          ];
          yield chunk;
        } else if (event.delta.type === 'text_delta') {
          chunk.choices = [
            {
              index: 0,
              delta: { role: 'assistant', content: event.delta.text },
              finish_reason: null,
            },
          ];
          yield chunk;
        } else if (event.delta.type === 'thinking_delta') {
          thinkingAccum += event.delta.thinking;
          (chunk.choices as unknown as Array<Record<string, unknown>>) = [
            {
              index: 0,
              delta: {
                role: 'assistant',
                reasoning: { thinking: event.delta.thinking },
              },
              finish_reason: null,
            },
          ];
          yield chunk;
        } else if (event.delta.type === 'signature_delta') {
          thinkingSignature = (thinkingSignature ?? '') + event.delta.signature;
        } else if (event.delta.type === 'citations_delta') {
          (chunk.choices as unknown as Array<Record<string, unknown>>) = [
            {
              index: 0,
              delta: { citations: [event.delta.citation] },
              finish_reason: null,
            },
          ];
          yield chunk;
        }
        continue;
      }

      case 'content_block_stop':
        blockState.delete(event.index);
        continue;

      case 'message_delta':
        stopReason = (event.delta.stop_reason ??
          stopReason) as AnthropicStopReason | null;
        stopDetails =
          (event.delta as { stop_details?: typeof stopDetails }).stop_details ??
          stopDetails;
        completionTokens = event.usage?.output_tokens ?? completionTokens;
        if (event.usage) {
          const u = event.usage as Partial<AnthropicMessagesResponse['usage']>;
          if (u.cache_creation_input_tokens != null) {
            cacheCreationTokens = u.cache_creation_input_tokens;
          }
          if (u.cache_creation) cacheCreation = u.cache_creation;
          if (u.server_tool_use) serverToolUse = u.server_tool_use;
        }
        continue;

      case 'message_stop': {
        const finishChoice: ChatCompletionChunk.Choice = {
          index: 0,
          delta: {},
          finish_reason: usedStructuredOutput
            ? 'stop'
            : stopReason
            ? ANTHROPIC_STOP_REASONS_MAP[stopReason] ?? 'stop'
            : 'stop',
        };
        if (thinkingAccum || redactedThinkingAccum.length > 0) {
          (finishChoice.delta as Record<string, unknown>).reasoning = {
            thinking: thinkingAccum || undefined,
            signature: thinkingSignature,
            redacted:
              redactedThinkingAccum.length > 0
                ? redactedThinkingAccum
                : undefined,
          };
        }
        if (stopDetails) {
          (finishChoice as unknown as Record<string, unknown>).stop_details =
            stopDetails;
        }
        chunk.choices = [finishChoice];
        chunk.usage = {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
          prompt_tokens_details: { cached_tokens: cachedTokens },
        };
        const ptdExt = chunk.usage.prompt_tokens_details as unknown as
          | Record<string, unknown>
          | undefined;
        if (cacheCreationTokens != null && ptdExt) {
          ptdExt.cache_creation_input_tokens = cacheCreationTokens;
        }
        if (cacheCreation && ptdExt) {
          ptdExt.cache_creation = cacheCreation;
        }
        if (serverToolUse) {
          (chunk.usage as unknown as Record<string, unknown>).server_tool_use =
            serverToolUse;
        }
        yield chunk;
        continue;
      }
    }
  }
  // Reference `options.onError` to keep the parameter in the public
  // surface; providers wire their own error mapping in around the
  // event source rather than via this hook today.
  void options.onError;
}

/** Re-export so providers can import everything from the adapter. */
export type { WithPassthrough };
