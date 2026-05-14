import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  ChatCompletion,
  ChatCompletionAssistantMessageParam,
  ChatCompletionChunk,
  ChatCompletionCreateParams,
  ChatCompletionMessageToolCall,
  ChatCompletionUserMessageParam,
} from 'openai/resources/index.js';
import type {
  ImageBlockParam,
  RawContentBlockDeltaEvent,
  RawContentBlockStartEvent,
  RawContentBlockStopEvent,
  RawMessageDeltaEvent,
  RawMessageStartEvent,
  RawMessageStopEvent,
  RawMessageStreamEvent,
  ToolResultBlockParam,
  ToolUseBlockParam,
} from '@anthropic-ai/sdk/resources/messages';
import { v4 as uuidv4 } from 'uuid';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import { CompletionError } from '../../gateway/completion.types';
import type {
  AnthropicContentBlock,
  AnthropicContentBlockParam,
  AnthropicMessage,
  AnthropicMessagesRequest,
  AnthropicMessagesResponse,
  AnthropicStopReason,
  AnthropicTextBlockParam,
  AnthropicTool,
  AnthropicToolChoice,
} from '../../gateway/anthropic/anthropic.types';
import type { CompletionRequestDto } from '../../gateway/dto/completion-request.dto';
import {
  takePassthroughEnvelope,
  type AnthropicPassthrough,
  type PassthroughEnvelope,
} from '../passthrough.helpers';
import {
  CompletionRequestOptions,
  OpenAICompletionResponse,
} from '../ai-provider.types';
import {
  applyPassthrough,
  applyStructuredOutputFromSchema,
  coerceInputSchema,
} from '../adapters/anthropic-messages.adapter';
import {
  reasoningBudgetToEffort,
  reasoningEffortToBudget,
} from '../adapters/anthropic-reasoning';
import { AnthropicConnectionConfig, AnthropicDispatcher } from './shared';

/**
 * Anthropic's OpenAI-Chat-Completions input handler.
 *
 * The class is a thin transport wrapper; the meat is the
 * `openAIRequestToAnthropic` / `anthropicResponseToChatCompletion` /
 * `anthropicStreamToChatCompletionChunks` converters at the top of
 * this file. Every provider that speaks Anthropic on the wire
 * (`AWSBedrockInvokeProvider` for the OpenAI-converted path, this
 * class for native Anthropic) imports those converters here — this
 * file is the single source of truth for the Chat-Completions↔Anthropic
 * mapping.
 *
 * Shared utilities that aren't Chat-specific
 * (`applyPassthrough`, `applyStructuredOutputFromSchema`,
 * `assertClaudeModel`, `canonicalAnthropicToBedrockInvoke`) live in
 * `../adapters/anthropic-messages.adapter.ts` because both this Chat
 * mapping and the Responses-side mapping reuse them.
 */

// ───────────────────────────────────────────────────────────────────────
// Constants + shared parser state
// ───────────────────────────────────────────────────────────────────────

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
 * Sentinel tool name used when translating OpenAI's
 * `response_format: { type: 'json_schema' }` into Anthropic's tool-based
 * structured-output pattern (the fallback path for models that don't
 * support `output_config.format` natively). The request side adds a
 * synthetic tool with this name and forces the model to call it; the
 * response side recognises the name and unwraps the tool input into
 * `message.content` as the JSON string the OpenAI caller expects.
 */
const STRUCTURED_OUTPUT_TOOL_NAME = '__vmx_structured_output__';

/**
 * Per-block parser state for the streaming converter. Tool_use blocks
 * accumulate JSON via input_json_delta; thinking blocks accumulate
 * signed reasoning; `structured_output` is a synthetic state for the
 * fallback tool above so its arguments stream out as `delta.content`.
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

// ───────────────────────────────────────────────────────────────────────
// OpenAI Chat Completions → Anthropic (request body)
// ───────────────────────────────────────────────────────────────────────

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

  // Anthropic rejects `n > 1` (only one completion per request).
  // Fail fast at the gateway boundary with a clean 400 instead of
  // sending a body Anthropic will reject.
  if (typeof cleanRequest.n === 'number' && cleanRequest.n > 1) {
    throw new CompletionError({
      message: `Anthropic only supports a single completion per request (n=1). Got n=${cleanRequest.n}.`,
      rate: false,
      retryable: false,
      statusCode: HttpStatus.BAD_REQUEST,
      failureReason: 'Anthropic does not support n > 1',
      openAICompatibleError: { code: 'anthropic_n_unsupported' },
    });
  }

  for (const message of cleanRequest.messages) {
    if (message.role === 'system' || message.role === 'developer') {
      systemParts.push(...extractSystemText(message.content));
      continue;
    }

    if (message.role === 'user') {
      messages.push({
        role: 'user',
        content: convertUserContent(message, options),
      });
    } else if (message.role === 'assistant') {
      const assistantContent = convertAssistantContent(message);
      // Anthropic rejects assistant messages with an empty `content`
      // array. Skip the message entirely when the OpenAI source had
      // no usable text/refusal/tool_calls/reasoning blocks instead of
      // letting the empty turn 400 at the upstream.
      if (typeof assistantContent === 'string' || assistantContent.length > 0) {
        messages.push({
          role: 'assistant',
          content: assistantContent,
        });
      }
    } else if (message.role === 'tool') {
      const block: ToolResultBlockParam = {
        type: 'tool_result',
        tool_use_id: message.tool_call_id,
        content:
          typeof message.content === 'string'
            ? message.content
            : message.content.map((part) => ({
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

  // Translate `response_format: { type: 'json_schema', ... }`. The
  // helper picks between Anthropic's native `output_config.format`
  // (Claude 4.5+) and the synthetic-tool fallback automatically.
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
  for (const part of message.content) {
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
      // OpenAI Chat content part `file: { file_data: 'data:...;base64,...', filename? }`
      // → Anthropic `document` block. Lets PDFs round-trip through
      // Chat→Anthropic→Invoke (and Chat→Anthropic native) without
      // being silently dropped.
      const filePart = part as {
        type: 'file';
        file: { file_data?: string; file_id?: string; filename?: string };
      };
      const parsedFile = parseImageDataUrl(filePart.file?.file_data ?? '');
      if (parsedFile) {
        // Anthropic's `DocumentBlockParam.source` has two non-URL
        // shapes — `Base64PDFSource` (media_type: 'application/pdf')
        // and `PlainTextSource` (media_type: 'text/plain'). Route on
        // the data URL's declared media type; anything else falls
        // back to base64-PDF so the upstream returns a helpful 400
        // instead of us silently dropping the file here.
        const source =
          parsedFile.mediaType === 'text/plain'
            ? {
                type: 'text' as const,
                media_type: 'text/plain' as const,
                data: parsedFile.data,
              }
            : {
                type: 'base64' as const,
                media_type: 'application/pdf' as const,
                data: parsedFile.data,
              };
        blocks.push({
          type: 'document',
          source,
          ...(filePart.file?.filename ? { title: filePart.file.filename } : {}),
        });
      }
      // file_id-only sources require the Files API beta header — left
      // to the `betas[]` plumbing follow-up; today we silently skip.
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
      } else if (part.type === 'refusal') {
        // Anthropic has no native assistant-refusal block; surface the
        // refusal text as plain text so the model has the conversation
        // context, rather than silently dropping the turn.
        blocks.push({ type: 'text', text: part.refusal });
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
      } else if ((toolCall as { type?: string }).type === 'custom') {
        // OpenAI's custom-tool-call shape carries the raw model input
        // as `custom.input` (a string — text or grammar payload).
        // Anthropic only has the `tool_use` block, so emit one with
        // the raw input forwarded verbatim. Anthropic doesn't natively
        // distinguish function vs custom tools at the call-site, so
        // this round-trips correctly through `convertTools` (which
        // also coerces `type: 'custom'` definitions to plain tools).
        const customCall = toolCall as {
          id: string;
          type: 'custom';
          custom: { name: string; input: string };
        };
        blocks.push({
          type: 'tool_use',
          id: customCall.id,
          name: customCall.custom.name,
          input: { input: customCall.custom.input },
        } as ToolUseBlockParam);
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
      // OpenAI's `FunctionDefinition` and Anthropic's `Tool` agree on
      // `name`, `description`, `strict`, and `parameters` ↔
      // `input_schema`. Forward `strict` when set so the upstream's
      // schema-adherence guarantee survives the conversion; leave
      // unset otherwise so Anthropic's default applies.
      const mapped: AnthropicTool = {
        name: tool.function.name,
        description: tool.function.description,
        input_schema: coerceInputSchema(tool.function.parameters),
      };
      if (tool.function.strict != null) {
        mapped.strict = tool.function.strict;
      }
      tools.push(mapped);
    } else if ((tool as { type?: string }).type === 'custom') {
      // OpenAI custom tools take free-form text (or grammar-constrained
      // text) instead of a JSON schema. Anthropic has no native
      // analogue; surface as a plain function-shape tool with a
      // single `input: string` parameter so the model can still call
      // it through the standard tool_use mechanism. Drops `format`
      // grammar constraints — strict grammar enforcement isn't
      // expressible on the Anthropic wire.
      const custom = tool as {
        type: 'custom';
        custom: { name: string; description?: string };
      };
      if (custom.custom.name) {
        tools.push({
          name: custom.custom.name,
          description: custom.custom.description,
          input_schema: {
            type: 'object',
            properties: { input: { type: 'string' } },
            required: ['input'],
          } as AnthropicTool['input_schema'],
        });
      }
    }
  }
  // Deprecated `functions` field has no `strict` on the wire shape;
  // map the basic three fields and let Anthropic's default apply.
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

function convertToolChoice(
  request: ChatCompletionCreateParams
): AnthropicToolChoice | undefined {
  if (request.tool_choice === 'auto') return { type: 'auto' };
  if (request.tool_choice === 'required') return { type: 'any' };
  if (request.tool_choice === 'none') return { type: 'none' };
  if (typeof request.tool_choice === 'object') {
    const tc = request.tool_choice as {
      type: string;
      function?: { name: string };
      custom?: { name: string };
      allowed_tools?: { mode: 'auto' | 'required' };
    };
    if (tc.type === 'function' && tc.function?.name) {
      return { type: 'tool', name: tc.function.name };
    }
    if (tc.type === 'custom' && tc.custom?.name) {
      // OpenAI's custom-tool-choice maps onto the same Anthropic
      // tool-by-name mechanism — the converter normalised the tool
      // definition into a function-shape entry above.
      return { type: 'tool', name: tc.custom.name };
    }
    if (tc.type === 'allowed_tools') {
      // `mode: 'required'` → Anthropic `any`; `mode: 'auto'` → `auto`.
      // The per-tool whitelist itself isn't expressible natively;
      // collapse to the closest gate so requests don't error out.
      return tc.allowed_tools?.mode === 'required'
        ? { type: 'any' }
        : { type: 'auto' };
    }
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
  // `parallel_tool_calls: false` → tool_choice.disable_parallel_tool_use.
  // When the caller didn't provide an explicit `tool_choice`, default
  // to `{type:'auto'}` so the flag lands on a valid Anthropic shape —
  // otherwise the request silently drops `parallel_tool_calls` and
  // the model emits multiple tool calls in parallel anyway.
  if (request.parallel_tool_calls === false && body.tools?.length) {
    if (!body.tool_choice) {
      body.tool_choice = { type: 'auto' };
    }
    if (body.tool_choice.type !== 'none') {
      (
        body.tool_choice as { disable_parallel_tool_use?: boolean }
      ).disable_parallel_tool_use = true;
    }
  }
  // OpenAI's `service_tier` enum doesn't include Anthropic's
  // `standard_only`, but the gateway accepts it as a passthrough value
  // when the caller is targeting an Anthropic upstream.
  const serviceTier = (request as { service_tier?: string | null })
    .service_tier;
  if (serviceTier === 'auto' || serviceTier === 'standard_only') {
    body.service_tier = serviceTier;
  }
  // OpenAI's `user` field (deprecated in newer SDK versions but still
  // emitted by many clients) is the abuse-prevention end-user
  // identifier; Anthropic carries the equivalent on `metadata.user_id`.
  // Forward when present so rate-limit pools / safety classifiers
  // receive it. The passthrough envelope's `metadata` (if any) wins on
  // the re-attach pass below, so explicit caller metadata is never lost.
  const legacyUser = (request as { user?: string }).user;
  if (legacyUser && !body.metadata?.user_id) {
    body.metadata = { ...(body.metadata ?? {}), user_id: legacyUser };
  }
  if (request.reasoning_effort && !body.thinking) {
    body.thinking = mapReasoningEffortToThinking(
      request.reasoning_effort,
      body.max_tokens
    );
  }
  // Anthropic rejects `temperature !== 1` when thinking is enabled,
  // and requires `max_tokens > thinking.budget_tokens`. The caller
  // generally has no way to know either constraint exists, so the
  // converter enforces both whenever it turns thinking on.
  const thinking = body.thinking as
    | { type?: string; budget_tokens?: number }
    | undefined;
  if (thinking?.type === 'enabled') {
    delete (body as { temperature?: number }).temperature;
    if (
      typeof thinking.budget_tokens === 'number' &&
      typeof body.max_tokens === 'number' &&
      body.max_tokens <= thinking.budget_tokens
    ) {
      // Leave a small completion budget on top of the thinking budget
      // so the model has room to actually answer.
      body.max_tokens = thinking.budget_tokens + 256;
    }
  }
}

function mapReasoningEffortToThinking(
  effort: string | null | undefined,
  maxTokens: number
): NonNullable<AnthropicMessagesRequest['thinking']> {
  // `none` (Chat-API extension) maps to disabled; anything the shared
  // helper doesn't recognise also falls to disabled rather than
  // forcing a default budget the caller didn't ask for.
  if (effort === 'none') return { type: 'disabled' };
  const budget = reasoningEffortToBudget(effort, maxTokens);
  return budget == null
    ? { type: 'disabled' }
    : { type: 'enabled', budget_tokens: budget };
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
  if (responseFormat?.type === 'json_schema') {
    const jsonSchema = responseFormat.json_schema;
    if (jsonSchema?.schema && typeof jsonSchema.schema === 'object') {
      applyStructuredOutputFromSchema(
        body,
        jsonSchema.schema,
        jsonSchema.name,
        jsonSchema.description
      );
    }
    return;
  }
  // Anthropic has no native `json_object` (schema-less JSON mode) flag.
  // Mirror OpenAI's behaviour by appending a system instruction so the
  // model is nudged to emit valid JSON. Without this the request used
  // to silently drop `response_format: { type: 'json_object' }` and
  // the model would happily reply in free-form prose.
  if (responseFormat?.type === 'json_object') {
    const hint: AnthropicTextBlockParam = {
      type: 'text',
      text: 'Respond with a single valid JSON object. Do not include any prose, markdown fences, or explanatory text outside of the JSON.',
    };
    if (Array.isArray(body.system)) {
      body.system = [...body.system, hint];
    } else if (typeof body.system === 'string' && body.system.length > 0) {
      body.system = [{ type: 'text', text: body.system }, hint];
    } else {
      body.system = [hint];
    }
  }
}

// ───────────────────────────────────────────────────────────────────────
// Anthropic → OpenAI Chat Completion (response body)
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
      // Synthetic tool used by the `response_format: json_schema`
      // translation fallback — unwrap the tool input as the JSON
      // content the OpenAI caller asked for, and don't surface it as
      // a tool call.
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

  // Attach Anthropic-only extensions (`reasoning` on the message;
  // `cache_creation` / `server_tool_use` on usage). Strict OpenAI
  // clients ignore unknown fields; native consumers via the audit row
  // see them.
  const messageExt = completion.choices[0]
    .message as ChatCompletion['choices'][number]['message'] & {
    reasoning?: {
      thinking?: string;
      signature?: string;
      redacted?: string[];
    };
  };
  if (thinking || redactedThinking.length > 0) {
    messageExt.reasoning = {
      thinking: thinking || undefined,
      signature: thinkingSignature,
      redacted: redactedThinking.length > 0 ? redactedThinking : undefined,
    };
  }
  const usageExt = completion.usage as NonNullable<ChatCompletion['usage']> & {
    prompt_tokens_details?: NonNullable<
      ChatCompletion['usage']
    >['prompt_tokens_details'] & {
      cache_creation_input_tokens?: number;
      cache_creation?: AnthropicMessagesResponse['usage']['cache_creation'];
    };
    server_tool_use?: AnthropicMessagesResponse['usage']['server_tool_use'];
  };
  if (response.usage.cache_creation_input_tokens != null) {
    usageExt.prompt_tokens_details = {
      ...(usageExt.prompt_tokens_details ?? {}),
      cache_creation_input_tokens: response.usage.cache_creation_input_tokens,
    };
  }
  if (response.usage.cache_creation) {
    usageExt.prompt_tokens_details = {
      ...(usageExt.prompt_tokens_details ?? {}),
      cache_creation: response.usage.cache_creation,
    };
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
          chunk.choices = [
            {
              index: 0,
              delta: {
                role: 'assistant',
                // OpenAI-shape extension carrying Anthropic's reasoning
                // delta; strict OpenAI clients ignore unknown fields.
                reasoning: { thinking: event.delta.thinking },
              } as ChatCompletionChunk.Choice['delta'],
              finish_reason: null,
            },
          ];
          yield chunk;
        } else if (event.delta.type === 'signature_delta') {
          thinkingSignature = (thinkingSignature ?? '') + event.delta.signature;
        } else if (event.delta.type === 'citations_delta') {
          chunk.choices = [
            {
              index: 0,
              delta: {
                citations: [event.delta.citation],
              } as ChatCompletionChunk.Choice['delta'],
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
          // `MessageDeltaUsage` carries cumulative-last-wins values
          // for input_tokens / cache_read / cache_creation as well as
          // output_tokens. Earlier code only read output + cache
          // creation, so when Anthropic emitted updated input or
          // cache_read counts mid-stream the gateway saw stale
          // values from `message_start`.
          const u = event.usage as Partial<AnthropicMessagesResponse['usage']>;
          if (typeof u.input_tokens === 'number') {
            promptTokens = u.input_tokens;
          }
          if (u.cache_read_input_tokens != null) {
            cachedTokens = u.cache_read_input_tokens;
          }
          if (u.cache_creation_input_tokens != null) {
            cacheCreationTokens = u.cache_creation_input_tokens;
          }
          if (u.cache_creation) cacheCreation = u.cache_creation;
          if (u.server_tool_use) serverToolUse = u.server_tool_use;
        }
        continue;

      case 'message_stop': {
        // Build the final choice with the gateway extensions
        // (`reasoning` on delta; `stop_details` on the choice) typed
        // via intersections rather than ad-hoc `Record<string, unknown>`
        // casts.
        type FinishChoice = ChatCompletionChunk.Choice & {
          stop_details?: typeof stopDetails;
          delta: ChatCompletionChunk.Choice['delta'] & {
            reasoning?: {
              thinking?: string;
              signature?: string;
              redacted?: string[];
            };
          };
        };
        const finishChoice: FinishChoice = {
          index: 0,
          delta: {},
          finish_reason: usedStructuredOutput
            ? 'stop'
            : stopReason
            ? ANTHROPIC_STOP_REASONS_MAP[stopReason] ?? 'stop'
            : 'stop',
        };
        if (thinkingAccum || redactedThinkingAccum.length > 0) {
          finishChoice.delta.reasoning = {
            thinking: thinkingAccum || undefined,
            signature: thinkingSignature,
            redacted:
              redactedThinkingAccum.length > 0
                ? redactedThinkingAccum
                : undefined,
          };
        }
        if (stopDetails) {
          finishChoice.stop_details = stopDetails;
        }
        chunk.choices = [finishChoice];
        type UsageExt = NonNullable<ChatCompletionChunk['usage']> & {
          prompt_tokens_details?: NonNullable<
            ChatCompletionChunk['usage']
          >['prompt_tokens_details'] & {
            cache_creation_input_tokens?: number;
            cache_creation?: typeof cacheCreation;
          };
          server_tool_use?: typeof serverToolUse;
        };
        const usage: UsageExt = {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
          prompt_tokens_details: { cached_tokens: cachedTokens },
        };
        if (cacheCreationTokens != null && usage.prompt_tokens_details) {
          usage.prompt_tokens_details.cache_creation_input_tokens =
            cacheCreationTokens;
        }
        if (cacheCreation && usage.prompt_tokens_details) {
          usage.prompt_tokens_details.cache_creation = cacheCreation;
        }
        if (serverToolUse) {
          usage.server_tool_use = serverToolUse;
        }
        chunk.usage = usage;
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

// ───────────────────────────────────────────────────────────────────────
// Anthropic Messages → OpenAI Chat Completions (request body)
// ───────────────────────────────────────────────────────────────────────
//
// Used by:
//   - Gateway controller for Anthropic-input clients fronting an
//     OpenAI-Chat-Completions internal pipeline.
//   - `gemini/anthropic-messages.provider.ts` (and Groq/Perplexity which
//     reuse the dispatcher) — Anthropic-input handler over a CC-compat
//     upstream.
//
// Anthropic-only fields that have no OpenAI Chat equivalent
// (cache_control, thinking, top_k, server tools, service_tier,
// container, betas, mcp_servers, context_management, inference_geo)
// ride along inside `__vmx_passthrough.anthropic`. Providers that
// speak Anthropic natively re-attach them on the way out via
// `applyPassthrough`; strict OpenAI upstreams ignore the envelope
// (`takePassthroughEnvelope` strips it before the SDK send).

type OpenAIMessageContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | {
          type: 'image_url';
          image_url: { url: string };
        }
      | {
          type: 'file';
          file: {
            file_data?: string;
            file_id?: string;
            filename?: string;
          };
        }
    >;

type OpenAIMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  // `null` is the explicit OpenAI-spec shape for an assistant message
  // whose only payload is `tool_calls` (no inline text).
  content?: OpenAIMessageContent | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
};

export type OpenAIChatCompletionsRequest = {
  model: string;
  messages: OpenAIMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  user?: string;
  stream?: boolean;
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description?: string;
      parameters: Record<string, unknown>;
    };
  }>;
  tool_choice?:
    | 'auto'
    | 'none'
    | 'required'
    | { type: 'function'; function: { name: string } };
  /**
   * Native Chat-Completions counterpart to Anthropic's
   * `thinking.budget_tokens`. Honoured by Groq's GPT-OSS / Qwen3 /
   * DeepSeek-R1 reasoning models and by OpenAI's o-series models.
   * Strict OpenAI-compat upstreams that don't expose it ignore the
   * key. Set only when the Anthropic source carried
   * `thinking: { type: 'enabled' }`.
   */
  reasoning_effort?: 'minimal' | 'low' | 'medium' | 'high';
  /**
   * Native Chat-Completions counterpart to Anthropic's
   * `tool_choice.disable_parallel_tool_use`. Set to `false` when the
   * Anthropic source disabled parallel tool calls so the OpenAI-compat
   * upstream receives the equivalent gate.
   */
  parallel_tool_calls?: boolean;
  /**
   * Carrier for fields we cannot express natively in OpenAI Chat
   * Completions but must preserve through the gateway pivot so
   * native-format providers (Bedrock-Invoke for `format: 'anthropic'`,
   * native AnthropicProvider) can re-attach them when re-serialising.
   */
  __vmx_passthrough?: PassthroughEnvelope;
};

/**
 * Returns the converted body typed as `CompletionRequestDto` so the
 * gateway controller can pass it to `CompletionService.completion()`
 * without further casting. Internally we build a narrower
 * `OpenAIChatCompletionsRequest` (only the fields VM-X actually
 * threads through), then cast at this boundary — the OpenAI SDK's
 * `ChatCompletionCreateParams` has many union variants we don't need
 * to model exhaustively. The cast is safe because every field we set
 * is structurally a subset of the SDK shape.
 */
export function anthropicRequestToOpenAI(
  req: AnthropicMessagesRequest
): CompletionRequestDto {
  const messages: OpenAIMessage[] = [];
  const passthrough: AnthropicPassthrough = {};

  if (req.system) {
    if (typeof req.system === 'string') {
      if (req.system) messages.push({ role: 'system', content: req.system });
    } else {
      const parts: string[] = [];
      const systemBreakpoints: NonNullable<
        AnthropicPassthrough['system_cache_breakpoints']
      > = [];
      req.system.forEach((block, index) => {
        if (block.type === 'text') {
          parts.push(block.text);
          if (block.cache_control) {
            systemBreakpoints.push({
              index,
              cache_control: block.cache_control,
            });
          }
        }
      });
      const systemText = parts.join('\n');
      if (systemText) messages.push({ role: 'system', content: systemText });
      if (systemBreakpoints.length > 0) {
        passthrough.system_cache_breakpoints = systemBreakpoints;
      }
    }
  }

  const messageBreakpoints: NonNullable<
    AnthropicPassthrough['cache_breakpoints']
  > = [];
  const priorThinking: NonNullable<AnthropicPassthrough['prior_thinking']> = [];

  req.messages.forEach((m, mIdx) => {
    const result = convertAnthropicMessage(m, mIdx);
    messages.push(...result.messages);
    if (result.cacheBreakpoints.length > 0) {
      messageBreakpoints.push(...result.cacheBreakpoints);
    }
    if (result.thinkingBlocks.length > 0) {
      priorThinking.push({
        message_index: messages.length - result.messages.length,
        blocks: result.thinkingBlocks,
      });
    }
  });

  if (messageBreakpoints.length > 0) {
    passthrough.cache_breakpoints = messageBreakpoints;
  }
  if (priorThinking.length > 0) {
    passthrough.prior_thinking = priorThinking;
  }

  const tools: OpenAIChatCompletionsRequest['tools'] = [];
  const serverTools: Array<unknown> = [];
  const toolBreakpoints: NonNullable<
    AnthropicPassthrough['tool_cache_breakpoints']
  > = [];

  req.tools?.forEach((t, idx) => {
    if ('input_schema' in t) {
      // Custom user-defined function tool.
      tools.push({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema as Record<string, unknown>,
        },
      });
      if (t.cache_control) {
        toolBreakpoints.push({ index: idx, cache_control: t.cache_control });
      }
    } else {
      // Server-side tool (web_search_*, code_execution_*, bash_*, text_editor_*, computer_*).
      // Preserve verbatim under passthrough; OpenAI-only providers will
      // surface a 400 from upstream rather than silently dropping.
      serverTools.push(t);
    }
  });

  if (serverTools.length > 0) {
    passthrough.server_tools = serverTools;
  }
  if (toolBreakpoints.length > 0) {
    passthrough.tool_cache_breakpoints = toolBreakpoints;
  }

  // Top-level Anthropic-only fields → passthrough envelope.
  if (req.cache_control) passthrough.cache_control = req.cache_control;
  if (req.thinking) passthrough.thinking = req.thinking;
  if (typeof req.top_k === 'number') passthrough.top_k = req.top_k;
  if (req.service_tier) passthrough.service_tier = req.service_tier;
  if (req.container !== undefined) passthrough.container = req.container;
  if (req.metadata) passthrough.metadata = req.metadata;
  // Capture full tool_choice (including `disable_parallel_tool_use`).
  if (req.tool_choice && hasExtendedToolChoiceFields(req.tool_choice)) {
    passthrough.tool_choice = req.tool_choice;
  }
  // T9: capture the Anthropic-only knobs the doc-comment promises but
  // earlier code never wired up.
  const reqExtras = req as AnthropicMessagesRequest & {
    betas?: unknown;
    mcp_servers?: AnthropicMessagesRequest['mcp_servers'];
    context_management?: AnthropicMessagesRequest['context_management'];
    inference_geo?: AnthropicMessagesRequest['inference_geo'];
  };
  if (Array.isArray(reqExtras.betas) && reqExtras.betas.length > 0) {
    passthrough.betas = reqExtras.betas.filter(
      (b): b is string => typeof b === 'string'
    );
  }
  if (reqExtras.mcp_servers && reqExtras.mcp_servers.length > 0) {
    passthrough.mcp_servers = reqExtras.mcp_servers;
  }
  if (reqExtras.context_management) {
    passthrough.context_management = reqExtras.context_management;
  }
  if (reqExtras.inference_geo) {
    passthrough.inference_geo = reqExtras.inference_geo;
  }

  const out: OpenAIChatCompletionsRequest = {
    model: req.model,
    messages,
    max_tokens: req.max_tokens,
    temperature: req.temperature,
    top_p: req.top_p,
    stop: req.stop_sequences,
    user: req.metadata?.user_id ?? undefined,
    stream: req.stream,
    tools: tools.length > 0 ? tools : undefined,
    tool_choice: anthropicToolChoiceToOpenAI(req.tool_choice),
  };

  // Anthropic `thinking.budget_tokens` → OpenAI `reasoning_effort`.
  // Without this, an Anthropic-input client targeting a Chat-Completions-
  // only upstream (Groq's GPT-OSS / DeepSeek-R1 / Qwen3, future OpenAI-
  // compat reasoning models) sees its `thinking` config silently dropped
  // — the passthrough carries it for native-format re-serialisation, but
  // OpenAI-compat providers strip the envelope before send. Map the
  // budget onto the closest effort tier so the wire request still
  // requests reasoning.
  if (req.thinking?.type === 'enabled' && req.thinking.budget_tokens > 0) {
    out.reasoning_effort = reasoningBudgetToEffort(req.thinking.budget_tokens);
  }
  // Anthropic `tool_choice.disable_parallel_tool_use` → OpenAI
  // `parallel_tool_calls: false`. Same drift class as `reasoning_effort`:
  // the passthrough preserves the verbatim Anthropic flag for native
  // round-trip, but OpenAI-compat providers need the native gate.
  if (
    req.tool_choice &&
    'disable_parallel_tool_use' in req.tool_choice &&
    req.tool_choice.disable_parallel_tool_use === true
  ) {
    out.parallel_tool_calls = false;
  }

  if (Object.keys(passthrough).length > 0) {
    out.__vmx_passthrough = { anthropic: passthrough };
  }

  return out as CompletionRequestDto;
}

function hasExtendedToolChoiceFields(choice: AnthropicToolChoice): boolean {
  if (
    choice.type === 'auto' ||
    choice.type === 'any' ||
    choice.type === 'tool'
  ) {
    return choice.disable_parallel_tool_use === true;
  }
  return false;
}

type ConvertedMessageBlock = {
  messages: OpenAIMessage[];
  cacheBreakpoints: NonNullable<AnthropicPassthrough['cache_breakpoints']>;
  thinkingBlocks: NonNullable<
    AnthropicPassthrough['prior_thinking']
  >[number]['blocks'];
};

function convertAnthropicMessage(
  m: AnthropicMessage,
  messageIndex: number
): ConvertedMessageBlock {
  const cacheBreakpoints: ConvertedMessageBlock['cacheBreakpoints'] = [];
  const thinkingBlocks: ConvertedMessageBlock['thinkingBlocks'] = [];

  if (typeof m.content === 'string') {
    return {
      messages: [{ role: m.role, content: m.content }],
      cacheBreakpoints,
      thinkingBlocks,
    };
  }

  // Multi-block content. tool_use → assistant tool_calls;
  // tool_result → standalone tool message; text/image stay inline.
  const inline: Exclude<OpenAIMessageContent, string> = [];
  const toolCalls: NonNullable<OpenAIMessage['tool_calls']> = [];
  const followups: OpenAIMessage[] = [];

  m.content.forEach((block: AnthropicContentBlockParam, blockIdx) => {
    // Capture cache_control on blocks that carry it. Thinking /
    // redacted_thinking blocks have no cache_control field, so the
    // `'cache_control' in block` narrowing already excludes them.
    if ('cache_control' in block && block.cache_control) {
      cacheBreakpoints.push({
        path: `messages[${messageIndex}].content[${blockIdx}]`,
        cache_control: block.cache_control,
      });
    }

    switch (block.type) {
      case 'text':
        inline.push({ type: 'text', text: block.text });
        break;
      case 'image': {
        const src = block.source;
        const url =
          src.type === 'base64'
            ? `data:${src.media_type};base64,${src.data}`
            : src.type === 'url'
            ? src.url
            : null;
        if (url) {
          inline.push({ type: 'image_url', image_url: { url } });
        }
        break;
      }
      case 'document': {
        const src = block.source;
        if (src.type === 'base64') {
          inline.push({
            type: 'file',
            file: {
              file_data: `data:${src.media_type};base64,${src.data}`,
              filename: block.title ?? undefined,
            },
          });
        } else if (src.type === 'text') {
          // Plain-text document → flatten into a text part with a header.
          const header = block.title ? `# ${block.title}\n\n` : '';
          inline.push({ type: 'text', text: `${header}${src.data}` });
        } else if (src.type === 'url') {
          inline.push({
            type: 'file',
            file: {
              file_data: src.url,
              filename: block.title ?? undefined,
            },
          });
        }
        // `content` (ContentBlockSource) variant: best-effort flatten.
        break;
      }
      case 'tool_use':
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input ?? {}),
          },
        });
        break;
      case 'tool_result': {
        followups.push({
          role: 'tool',
          tool_call_id: block.tool_use_id,
          content: mapToolResultContentToOpenAI(block.content),
        });
        break;
      }
      case 'thinking':
        thinkingBlocks.push({
          type: 'thinking',
          thinking: block.thinking,
          signature: block.signature,
        });
        break;
      case 'redacted_thinking':
        thinkingBlocks.push({
          type: 'redacted_thinking',
          data: block.data,
        });
        break;
      // Server-tool blocks (server_tool_use, web_search_tool_result,
      // code_execution_tool_result, etc.) and container_upload have no
      // OpenAI Chat Completions equivalent; we drop them from the OpenAI
      // body since they're only meaningful in a native-passthrough
      // round-trip. The native provider preserves them via
      // `request.body` directly, not through this converter.
      default:
        break;
    }
  });

  const out: OpenAIMessage[] = [];
  if (inline.length > 0 || toolCalls.length > 0) {
    // OpenAI's spec requires `content: null` (explicit) on assistant
    // messages that carry only `tool_calls` — many providers reject the
    // `undefined` form. We emit `null` when the assistant has tool calls
    // but no inline content.
    const isToolOnlyAssistant =
      m.role === 'assistant' && toolCalls.length > 0 && inline.length === 0;
    out.push({
      role: m.role,
      ...(inline.length > 0
        ? { content: inline }
        : isToolOnlyAssistant
        ? { content: null }
        : {}),
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    });
  }
  out.push(...followups);
  return { messages: out, cacheBreakpoints, thinkingBlocks };
}

/**
 * Map an Anthropic `tool_result.content` payload into the shape an
 * OpenAI Chat Completions tool message accepts. OpenAI's tool messages
 * support `content: string | Array<{type:'text', text}>` — preserve
 * the array form when the source has multiple text parts so downstream
 * consumers see the structure the model emitted, instead of squashing
 * everything into a single newline-joined string. Single-text inputs
 * collapse to a plain string for the common path.
 *
 * Image / document / search_result / tool_reference parts inside a
 * tool_result have no Chat Completions equivalent inside a tool
 * message and are dropped here; native passthrough (Bedrock-Invoke
 * `format:'anthropic'`, native Anthropic) preserves them.
 */
function mapToolResultContentToOpenAI(
  content: Extract<
    AnthropicContentBlockParam,
    { type: 'tool_result' }
  >['content']
): string | Array<{ type: 'text'; text: string }> {
  if (typeof content === 'string') return content;
  if (!content) return '';
  const parts: Array<{ type: 'text'; text: string }> = [];
  for (const c of content) {
    if (c.type === 'text' && c.text) {
      parts.push({ type: 'text', text: c.text });
    }
  }
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0].text;
  return parts;
}

function anthropicToolChoiceToOpenAI(
  choice?: AnthropicToolChoice
): OpenAIChatCompletionsRequest['tool_choice'] {
  if (!choice) return undefined;
  switch (choice.type) {
    case 'auto':
      return 'auto';
    case 'none':
      return 'none';
    case 'any':
      return 'required';
    case 'tool':
      return { type: 'function', function: { name: choice.name } };
  }
}

// ───────────────────────────────────────────────────────────────────────
// OpenAI Chat Completions → Anthropic Messages (response body)
// ───────────────────────────────────────────────────────────────────────

type OpenAIChatCompletionsResponse = {
  id: string;
  model?: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      refusal?: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
      /**
       * Anthropic-only extension surfaced by native passthrough providers
       * (Bedrock-Invoke, future native AnthropicProvider) so reasoning
       * survives the OpenAI Chat Completions pivot. Strict OpenAI clients
       * ignore the field; the converter reads it to reconstruct the
       * thinking content blocks for `format: 'anthropic'` responses.
       */
      reasoning?: {
        thinking?: string;
        signature?: string;
        redacted?: string[];
      };
    };
    finish_reason?: string;
    /**
     * Anthropic stop_details surfaced via OpenAI extension by native
     * passthrough providers. Carries refusal categorisation that
     * `finish_reason: 'content_filter'` alone can't express.
     */
    stop_details?: AnthropicMessagesResponse['stop_details'];
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_creation?: AnthropicMessagesResponse['usage']['cache_creation'];
    };
    /**
     * Server tool counts forwarded by native Anthropic-side providers
     * (Bedrock-Invoke, future native AnthropicProvider). Used to
     * round-trip `usage.server_tool_use` in `format: 'anthropic'`
     * responses.
     */
    server_tool_use?: AnthropicMessagesResponse['usage']['server_tool_use'];
  };
};

/**
 * Build a `Message` from an OpenAI Chat Completions response.
 *
 * Lossy by construction — the OpenAI body is the source of truth
 * here, so cache_creation tokens, server_tool_use counts, citations,
 * and stop_details (refusal category) cannot be recovered. When the
 * upstream provider returns a native Anthropic response (Bedrock-Invoke
 * with `format: 'anthropic'` passthrough, native AnthropicProvider),
 * this converter is bypassed entirely — the native body flows back
 * unchanged.
 */
export function openAIResponseToAnthropic(
  resp: OpenAIChatCompletionsResponse,
  modelOverride?: string
): AnthropicMessagesResponse {
  const choice = resp.choices?.[0];
  const content: AnthropicContentBlock[] = [];

  // Reconstruct thinking blocks first — Anthropic returns thinking
  // before text, so order matters for multi-turn continuity (clients
  // forward the response back unchanged in the next turn).
  const reasoning = choice?.message?.reasoning;
  if (reasoning?.redacted) {
    for (const data of reasoning.redacted) {
      content.push({ type: 'redacted_thinking', data });
    }
  }
  if (reasoning?.thinking) {
    content.push({
      type: 'thinking',
      thinking: reasoning.thinking,
      signature: reasoning.signature ?? '',
    });
  }

  const text = choice?.message?.content;
  if (typeof text === 'string' && text.length > 0) {
    content.push({ type: 'text', text, citations: null });
  }
  for (const tc of choice?.message?.tool_calls ?? []) {
    let parsedInput: Record<string, unknown> = {};
    try {
      parsedInput = tc.function.arguments
        ? JSON.parse(tc.function.arguments)
        : {};
    } catch {
      // Leave as empty object — provider returned malformed JSON args.
    }
    content.push({
      type: 'tool_use',
      id: tc.id,
      name: tc.function.name,
      input: parsedInput,
      caller: { type: 'direct' },
    });
  }

  const refusalText = choice?.message?.refusal;
  const stopReason = openAIFinishToAnthropicStop(
    choice?.finish_reason,
    refusalText
  );
  const ptd = resp.usage?.prompt_tokens_details;

  return {
    id: resp.id,
    type: 'message',
    role: 'assistant',
    container: null,
    model: modelOverride ?? resp.model ?? '',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details:
      // Prefer the explicit stop_details forwarded by the native
      // provider (carries the refusal `category`); fall back to a
      // synthesised one when only the OpenAI `refusal` text survived.
      choice?.stop_details ??
      (stopReason === 'refusal'
        ? {
            type: 'refusal',
            category: null,
            explanation: refusalText ?? null,
          }
        : null),
    usage: {
      input_tokens: resp.usage?.prompt_tokens ?? 0,
      output_tokens: resp.usage?.completion_tokens ?? 0,
      cache_creation_input_tokens: ptd?.cache_creation_input_tokens ?? null,
      cache_read_input_tokens: ptd?.cached_tokens ?? null,
      cache_creation: ptd?.cache_creation ?? null,
      server_tool_use: resp.usage?.server_tool_use ?? null,
      service_tier: null,
      inference_geo: null,
    },
  };
}

function openAIFinishToAnthropicStop(
  reason: string | undefined,
  refusal?: string | null
): AnthropicStopReason | null {
  if (refusal) return 'refusal';
  switch (reason) {
    case 'stop':
      return 'end_turn';
    case 'length':
      return 'max_tokens';
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'content_filter':
      return 'refusal';
    default:
      return reason ? 'end_turn' : null;
  }
}

// ───────────────────────────────────────────────────────────────────────
// OpenAI ChatCompletion stream → Anthropic Messages stream
// ───────────────────────────────────────────────────────────────────────

/**
 * Convert an OpenAI ChatCompletion chunk stream into an Anthropic
 * SSE event sequence. Used by Gemini / Groq / Perplexity's
 * Anthropic-input handlers — those upstreams' wire format is Chat
 * Completions, but Anthropic-SDK clients consuming the gateway
 * expect `message_start` / `content_block_*` / `message_delta` /
 * `message_stop` events. (T17)
 *
 * Maps:
 *   - first chunk → `message_start` (with empty content + initial usage).
 *   - text delta → `content_block_start` (text, on first delta) +
 *     `content_block_delta` (text_delta) on subsequent.
 *   - tool_call delta → `content_block_start` (tool_use, on first) +
 *     `content_block_delta` (input_json_delta) on subsequent.
 *   - finish_reason chunk → `content_block_stop` (close any open
 *     blocks) + `message_delta` (final usage + stop_reason mapped).
 *   - end of stream → `message_stop`.
 */
export async function* chatCompletionStreamToAnthropic(
  source: AsyncIterable<ChatCompletionChunk>,
  model: string
): AsyncIterable<RawMessageStreamEvent> {
  const messageId = `msg_${uuidv4()}`;
  let messageStartEmitted = false;

  // Anthropic content-block index → block kind. Text blocks share
  // index 0 (one text block per assistant turn); tool_use blocks take
  // 1, 2, ... in the order they're seen.
  let textBlockOpen = false;
  let nextToolBlockIndex = 1;
  // OpenAI tool_call index → Anthropic block index.
  const toolBlockIndex = new Map<number, number>();

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let finishReason: ChatCompletionChunk.Choice['finish_reason'] | null = null;

  const emitMessageStart = (): RawMessageStartEvent => {
    messageStartEmitted = true;
    return {
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        content: [],
        model,
        container: null,
        stop_reason: null,
        stop_sequence: null,
        stop_details: null,
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cache_creation_input_tokens: null,
          cache_read_input_tokens: null,
          cache_creation: null,
          server_tool_use: null,
          service_tier: null,
          inference_geo: null,
        },
      },
    };
  };

  for await (const chunk of source) {
    if (!messageStartEmitted) {
      yield emitMessageStart();
    }

    if (chunk.usage) {
      inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
      outputTokens = chunk.usage.completion_tokens ?? outputTokens;
      cacheReadTokens =
        chunk.usage.prompt_tokens_details?.cached_tokens ?? cacheReadTokens;
    }

    const choice = chunk.choices?.[0];
    if (!choice) continue;

    if (typeof choice.delta?.content === 'string' && choice.delta.content) {
      if (!textBlockOpen) {
        const textStart: RawContentBlockStartEvent = {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '', citations: null },
        };
        yield textStart;
        textBlockOpen = true;
      }
      const textDelta: RawContentBlockDeltaEvent = {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: choice.delta.content },
      };
      yield textDelta;
    }

    for (const tc of choice.delta?.tool_calls ?? []) {
      const oaiIdx = tc.index;
      let anthIdx = toolBlockIndex.get(oaiIdx);
      if (anthIdx == null) {
        anthIdx = nextToolBlockIndex++;
        toolBlockIndex.set(oaiIdx, anthIdx);
        const toolStart: RawContentBlockStartEvent = {
          type: 'content_block_start',
          index: anthIdx,
          content_block: {
            type: 'tool_use',
            id: tc.id ?? `toolu_${uuidv4()}`,
            name: tc.function?.name ?? '',
            input: {},
            caller: { type: 'direct' },
          },
        };
        yield toolStart;
      }
      const argsDelta = tc.function?.arguments;
      if (argsDelta) {
        const inputDelta: RawContentBlockDeltaEvent = {
          type: 'content_block_delta',
          index: anthIdx,
          delta: {
            type: 'input_json_delta',
            partial_json: argsDelta,
          },
        };
        yield inputDelta;
      }
    }

    if (choice.finish_reason) {
      finishReason = choice.finish_reason;
    }
  }

  if (!messageStartEmitted) {
    yield emitMessageStart();
  }
  if (textBlockOpen) {
    const stop: RawContentBlockStopEvent = {
      type: 'content_block_stop',
      index: 0,
    };
    yield stop;
  }
  for (const idx of toolBlockIndex.values()) {
    const stop: RawContentBlockStopEvent = {
      type: 'content_block_stop',
      index: idx,
    };
    yield stop;
  }

  const messageDelta: RawMessageDeltaEvent = {
    type: 'message_delta',
    delta: {
      stop_reason:
        openAIFinishToAnthropicStop(finishReason ?? undefined) ?? 'end_turn',
      stop_sequence: null,
      container: null,
      stop_details: null,
    },
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_read_input_tokens: cacheReadTokens || null,
      cache_creation_input_tokens: null,
      server_tool_use: null,
    },
  };
  yield messageDelta;
  const messageStop: RawMessageStopEvent = { type: 'message_stop' };
  yield messageStop;
}

// ───────────────────────────────────────────────────────────────────────
// Provider class
// ───────────────────────────────────────────────────────────────────────

/**
 * Anthropic's OpenAI-Chat-Completions input handler.
 *
 * Converts the OpenAI body into Anthropic Messages shape (preserving
 * cache_control / thinking / top_k / server tools via the
 * `__vmx_passthrough` envelope), then delegates the wire call to the
 * shared `AnthropicDispatcher`.
 */
@Injectable()
export class AnthropicOpenAICompletionProvider {
  constructor(private readonly dispatcher: AnthropicDispatcher) {}

  async handle(
    request: ChatCompletionCreateParams,
    connection: AIConnectionEntity<AnthropicConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<OpenAICompletionResponse> {
    const body = openAIRequestToAnthropic(request);
    body.model = model.model;
    return this.dispatcher.dispatch(body, connection, model, options);
  }
}
