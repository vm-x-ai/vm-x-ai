import { Injectable } from '@nestjs/common';
import type {
  Response as OpenAIResponse,
  ResponseCreateParams,
  ResponseInputContent,
  ResponseInputItem,
  ResponseOutputItem,
  ResponseStreamEvent,
  Tool as ResponsesTool,
} from 'openai/resources/responses/responses.js';
import type {
  ContentBlockParam as AnthropicContentBlockParam,
  Message as AnthropicMessage,
  MessageParam as AnthropicMessageParam,
  RawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages';
import { v4 as uuidv4 } from 'uuid';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import {
  CompletionRequestOptions,
  OpenAIResponseResponse,
} from '../ai-provider.types';
import type {
  AnthropicMessagesRequest,
  AnthropicTool,
} from '../../gateway/anthropic/anthropic.types';
import { HttpStatus } from '@nestjs/common';
import { CompletionError } from '../../gateway/completion.types';
import { AnthropicConnectionConfig, AnthropicDispatcher } from './shared';
import {
  applyPassthrough,
  applyStructuredOutputFromSchema,
} from '../adapters/anthropic-messages.adapter';
import { reasoningEffortToBudget } from '../adapters/anthropic-reasoning';
import { takePassthroughEnvelope } from '../passthrough.helpers';
import type { TextBlockParam as AnthropicTextBlockParam } from '@anthropic-ai/sdk/resources/messages';

/**
 * Options recognised by `requestResponsesToAnthropic`. Mirrors the
 * `OpenAIToAnthropicOptions` on the Chat-Completion converter — callers
 * targeting a wire format that can't fetch external image URLs
 * (Bedrock InvokeModel) flip `rejectExternalImageUrls: true` so the
 * gateway 400s with a clean error instead of round-tripping a noisy
 * upstream failure.
 */
export type ResponsesToAnthropicOptions = {
  /**
   * Reject external image URLs (anything that isn't a `data:` base64
   * URL). Bedrock Invoke can't fetch URLs server-side; native
   * Anthropic accepts `{type:'url', url}` so leave this `false` for
   * the native AnthropicProvider and `true` for AWSBedrockInvokeProvider.
   */
  rejectExternalImageUrls?: boolean;
};

/**
 * Anthropic's OpenAI-Responses input handler — direct one-pair
 * Responses ↔ Anthropic converter (no internal pivot through
 * ChatCompletion).
 *
 * The adapter functions live at the top of the file (pure, importable
 * by sibling provider folders that need the same conversion — today
 * `aws-bedrock-invoke/openai-response.provider.ts` is the only candidate
 * since Bedrock-Invoke speaks Anthropic on the wire too).
 *
 * Mapping summary:
 *
 *   Request  Responses → Anthropic
 *     instructions    → system (string)
 *     input (string)  → messages [{role:'user', content:string}]
 *     input (items)
 *       message       → messages entry
 *       function_call → assistant msg with tool_use block
 *       function_call_output → user msg with tool_result block
 *       reasoning     → recorded thinking block on previous assistant
 *     tools (function) → Anthropic custom tool
 *     tools (hosted, e.g. web_search) → server tool passthrough
 *     temperature, top_p, top_k → same
 *     max_output_tokens → max_tokens
 *     stop          → stop_sequences
 *     tool_choice   → tool_choice
 *     reasoning     → thinking config (effort → budget tier)
 *
 *   Response  Anthropic Message → Response
 *     content[]
 *       text          → output[] message → output_text part
 *       thinking      → output[] reasoning → summary text
 *       tool_use      → output[] function_call (call_id, name, args)
 *     usage           → usage (input_tokens / output_tokens / details)
 *     stop_reason     → status (end_turn / tool_use → completed,
 *                       max_tokens → incomplete, refusal → completed)
 *     model + id passthrough
 *
 *   Stream  Anthropic SSE → ResponseStreamEvent[]
 *     message_start → response.created + response.in_progress
 *     content_block_start (text) → output_item.added(message) +
 *                                  content_part.added(output_text)
 *     content_block_start (tool_use) → output_item.added(function_call)
 *     content_block_start (thinking) → output_item.added(reasoning)
 *     content_block_delta (text_delta) → output_text.delta
 *     content_block_delta (input_json_delta) → function_call_arguments.delta
 *     content_block_delta (thinking_delta) → reasoning_summary_text.delta
 *     content_block_stop → content_part.done + output_item.done
 *     message_delta (usage) → accumulate
 *     message_stop → response.completed
 *
 * Unsupported items / blocks raise a 400 from the Anthropic SDK rather
 * than silently dropping data — surfacing the gap is more useful than
 * a quiet truncation.
 */

// ─── Request side ──────────────────────────────────────────────────

export function requestResponsesToAnthropic(
  req: ResponseCreateParams,
  options: ResponsesToAnthropicOptions = {}
): AnthropicMessagesRequest {
  // Lift the `__vmx_passthrough.anthropic` envelope so we can re-apply
  // Anthropic-only fields the converter would otherwise drop on the
  // ground (cache_control, top_k, service_tier, metadata, container,
  // server tools, structured-output schema, tool_choice override). T7
  // closes the silent-fidelity gap audit-matrix flagged here.
  const { body: cleanReq, anthropic: passthrough } =
    takePassthroughEnvelope(req);
  const messages: AnthropicMessageParam[] = [];

  // Build `systemParts` first so any role:`system`/`developer` items
  // emitted by `appendInputItem` below can append to it instead of
  // being folded into a synthetic user message.
  const systemParts: AnthropicTextBlockParam[] = [];
  if (
    typeof cleanReq.instructions === 'string' &&
    cleanReq.instructions.length > 0
  ) {
    systemParts.push({ type: 'text', text: cleanReq.instructions });
  }

  const inputItems: ResponseInputItem[] = Array.isArray(cleanReq.input)
    ? cleanReq.input
    : [
        {
          type: 'message',
          role: 'user',
          content: cleanReq.input ?? '',
        } as ResponseInputItem,
      ];

  for (const item of inputItems) {
    appendInputItem(messages, systemParts, item, options);
  }

  const out: AnthropicMessagesRequest = {
    model: cleanReq.model,
    max_tokens: cleanReq.max_output_tokens ?? 1024,
    messages,
  } as AnthropicMessagesRequest;

  if (systemParts.length > 0) {
    out.system = systemParts;
  }
  if (typeof cleanReq.temperature === 'number') {
    out.temperature = cleanReq.temperature;
  }
  if (typeof cleanReq.top_p === 'number') {
    out.top_p = cleanReq.top_p;
  }
  // ResponseCreateParams has no `stop` field today (the Responses API
  // doesn't expose stop sequences directly); Anthropic's
  // `stop_sequences` is left unset on this conversion path.
  if (cleanReq.stream) {
    (out as AnthropicMessagesRequest & { stream?: boolean }).stream = true;
  }

  const tools = mapTools(cleanReq.tools ?? null);
  if (tools && tools.length > 0) {
    out.tools = tools;
  }
  // `tool_choice` is meaningful even without `tools` for the `'none'`
  // case (forbid tool use even though tools may have been registered
  // earlier in a multi-turn conversation). Map regardless of tool count.
  if (cleanReq.tool_choice !== undefined && cleanReq.tool_choice !== null) {
    const tc = mapToolChoice(cleanReq.tool_choice);
    if (tc) out.tool_choice = tc;
  }
  // Responses-side `parallel_tool_calls: false` ↔ Anthropic's
  // `disable_parallel_tool_use: true`. The flag lives on the
  // tool_choice variants (`auto` / `any` / `tool`), so populate a
  // default `{ type: 'auto' }` when the caller asked to disable
  // parallelism without otherwise pinning a choice.
  if (cleanReq.parallel_tool_calls === false) {
    const existing = out.tool_choice;
    if (!existing) {
      out.tool_choice = { type: 'auto', disable_parallel_tool_use: true };
    } else if (
      existing.type === 'auto' ||
      existing.type === 'any' ||
      existing.type === 'tool'
    ) {
      (
        existing as { disable_parallel_tool_use?: boolean }
      ).disable_parallel_tool_use = true;
    }
  }

  // `reasoning.effort` mapping → Anthropic thinking config.
  // The Responses API uses `effort: 'minimal'|'low'|'medium'|'high'|'xhigh'`;
  // Anthropic's thinking config takes a `budget_tokens` integer. The
  // shared helper maps low/medium/high → 1024/4096/16384 and returns
  // `null` for unsupported tiers (`minimal`/`none`). Treat `'xhigh'`
  // as `'high'` since Anthropic's max thinking budget is bounded by
  // `max_tokens` anyway. Pass `max_output_tokens` so the clamp keeps
  // `budget_tokens < max_tokens` (Anthropic rejects budgets ≥ max_tokens).
  if (cleanReq.reasoning?.effort) {
    const effort =
      cleanReq.reasoning.effort === 'xhigh'
        ? 'high'
        : cleanReq.reasoning.effort;
    const budget = reasoningEffortToBudget(
      effort,
      typeof cleanReq.max_output_tokens === 'number'
        ? cleanReq.max_output_tokens
        : undefined
    );
    if (budget != null) {
      (
        out as AnthropicMessagesRequest & {
          thinking?: { type: 'enabled'; budget_tokens: number };
        }
      ).thinking = { type: 'enabled', budget_tokens: budget };
      // Anthropic rejects `temperature !== 1` when thinking is
      // enabled, and requires `max_tokens > thinking.budget_tokens`.
      // Drop the caller's `temperature` (Responses callers can't know
      // about Anthropic's constraint) and bump `max_tokens` if the
      // budget would consume the entire generation cap.
      delete (out as { temperature?: number }).temperature;
      if (typeof out.max_tokens === 'number' && out.max_tokens <= budget) {
        out.max_tokens = budget + 256;
      }
    }
  }

  // T7: `text.format = json_schema` → synthetic Anthropic tool. Same
  // pattern the Chat→Anthropic adapter uses; the model is forced to
  // call the synthetic tool, and the response side unwraps the input
  // back into an OpenAI-shape JSON content string.
  const textFormat = cleanReq.text?.format as
    | {
        type?: string;
        name?: string;
        description?: string;
        schema?: Record<string, unknown>;
      }
    | undefined;
  if (
    textFormat?.type === 'json_schema' &&
    textFormat.schema &&
    typeof textFormat.schema === 'object'
  ) {
    applyStructuredOutputFromSchema(
      out,
      textFormat.schema,
      textFormat.name,
      textFormat.description
    );
  }

  // T7: re-apply Anthropic-only fields stowed by the cross-format
  // converter (cache_control, top_k, service_tier, metadata,
  // container, tool_choice override, system+tool cache breakpoints,
  // server tools).
  if (passthrough) {
    applyPassthrough(out, systemParts, passthrough);
  }

  return out;
}

function appendInputItem(
  messages: AnthropicMessageParam[],
  systemParts: AnthropicTextBlockParam[],
  item: ResponseInputItem,
  options: ResponsesToAnthropicOptions = {}
): void {
  const type = (item as { type?: string }).type;

  if (type === 'message' || type === undefined) {
    const msg = item as Extract<
      ResponseInputItem,
      { type?: 'message'; role: 'user' | 'system' | 'developer' | 'assistant' }
    >;
    if (msg.role === 'system' || msg.role === 'developer') {
      // Promote system/developer-role items into `req.system` rather
      // than folding them onto a synthetic user message — Anthropic's
      // `system` field accepts a `TextBlockParam[]`, so multiple
      // entries (e.g. top-level `instructions` plus mid-conversation
      // re-prompts) compose naturally. The wire-rejection that the
      // older `[system]` fold was avoiding only applies to system
      // turns inside `messages[]`, which we still don't emit.
      const text = stringifyContent(msg.content);
      if (text) {
        systemParts.push({ type: 'text', text });
      }
      return;
    }
    if (msg.role === 'user') {
      messages.push({
        role: 'user',
        content: mapInputContentToBlocks(msg.content, options),
      } as AnthropicMessageParam);
      return;
    }
    if (msg.role === 'assistant') {
      const blocks = mapInputContentToBlocks(msg.content, options);
      messages.push({
        role: 'assistant',
        content: blocks,
      } as AnthropicMessageParam);
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
    const block: AnthropicContentBlockParam = {
      type: 'tool_use',
      id: call.call_id,
      name: call.name,
      input: parsed,
    };
    const last = messages[messages.length - 1];
    if (last && last.role === 'assistant' && Array.isArray(last.content)) {
      (last.content as AnthropicContentBlockParam[]).push(block);
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
    // Responses' `function_call_output.output` is `string` OR an array
    // of `input_text` / `input_image` / `input_file` content items.
    // Anthropic's `tool_result.content` accepts string OR an array of
    // text / image / document blocks — preserve the array shape when
    // there's any non-text part so multimodal tool outputs survive
    // the conversion.
    const content = mapFunctionCallOutputToToolResultContent(
      out.output,
      options
    );
    const block: AnthropicContentBlockParam = {
      type: 'tool_result',
      tool_use_id: out.call_id,
      content,
    } as AnthropicContentBlockParam;
    const last = messages[messages.length - 1];
    if (last && last.role === 'user' && Array.isArray(last.content)) {
      (last.content as AnthropicContentBlockParam[]).push(block);
    } else {
      messages.push({ role: 'user', content: [block] });
    }
    return;
  }

  if (type === 'reasoning') {
    // Pinning a reasoning summary onto the previous assistant message
    // as a `thinking` block lets multi-turn agent loops continue with
    // signed reasoning preserved. The signature round-trips via the
    // Responses item's `encrypted_content` (sentinel prefix marks
    // `redacted_thinking` blocks), so Anthropic's signed-thinking
    // validator accepts the next request.
    const r = item as Extract<ResponseInputItem, { type: 'reasoning' }> & {
      encrypted_content?: string;
    };
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant' || !Array.isArray(last.content)) {
      return;
    }
    if (
      typeof r.encrypted_content === 'string' &&
      r.encrypted_content.startsWith('__vmx_redacted__:')
    ) {
      (last.content as AnthropicContentBlockParam[]).unshift({
        type: 'redacted_thinking',
        data: r.encrypted_content.slice('__vmx_redacted__:'.length),
      } as AnthropicContentBlockParam);
      return;
    }
    const text = (r.summary ?? [])
      .map((s) => (s as { text?: string }).text ?? '')
      .filter(Boolean)
      .join('\n');
    if (!text && !r.encrypted_content) return;
    (last.content as AnthropicContentBlockParam[]).unshift({
      type: 'thinking',
      thinking: text,
      signature: r.encrypted_content ?? '',
    });
    return;
  }
  // Unknown item types fall through silently — the SDK will emit a
  // 400 if the resulting body is invalid, which surfaces the gap.
}

/**
 * Map a single Responses-shape content part to its Anthropic
 * counterpart. Returns `null` for parts we can't represent (audio,
 * unknown types) so callers can drop them.
 *
 * Covered today:
 *   - `input_text` / `output_text` → `TextBlockParam`
 *   - `input_image`                → `ImageBlockParam` (base64 data URL
 *                                    or external URL)
 *   - `input_file`                 → `DocumentBlockParam`
 *                                    (PDF base64 / URL / plain text)
 *
 * `input_audio` has no Anthropic standard equivalent — dropped.
 */
function inputContentPartToAnthropicBlock(
  part: unknown,
  options: ResponsesToAnthropicOptions = {}
): AnthropicContentBlockParam | null {
  const t = (part as { type?: string }).type;
  if (t === 'input_text' || t === 'output_text') {
    return { type: 'text', text: (part as { text: string }).text };
  }
  if (t === 'refusal') {
    // `ResponseOutputRefusal` blocks come from prior assistant turns
    // when the model refused. Anthropic has no `refusal` ContentBlock,
    // but dropping the block silently strips conversation context the
    // model relies on for follow-up turns. Surface as a plain text
    // block — the refusal text is the only payload anyway.
    const refusal = (part as { refusal?: string }).refusal ?? '';
    if (!refusal) return null;
    return { type: 'text', text: refusal };
  }
  if (t === 'input_image') {
    const img = part as { image_url?: string };
    if (!img.image_url) return null;
    // Data URLs go to base64 source; HTTPS URLs to url source.
    if (img.image_url.startsWith('data:')) {
      const match = img.image_url.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) return null;
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: match[1] as 'image/jpeg',
          data: match[2],
        },
      } as AnthropicContentBlockParam;
    }
    if (options.rejectExternalImageUrls) {
      // Bedrock InvokeModel can't fetch external URLs; fail fast at the
      // gateway boundary with a clean 400 instead of round-tripping a
      // noisy upstream error. Matches the Chat-Completion converter's
      // behaviour for the same wire surface.
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
    }
    return {
      type: 'image',
      source: { type: 'url', url: img.image_url },
    } as AnthropicContentBlockParam;
  }
  if (t === 'input_file') {
    const f = part as {
      file_data?: string | null;
      file_url?: string | null;
      filename?: string | null;
    };
    // Prefer file_url (Anthropic's `url` PDF source); otherwise an
    // inline base64 blob. `file_data` is an OpenAI base64 payload —
    // it can be a bare base64 string or a `data:...;base64,...` URL.
    if (f.file_url) {
      return {
        type: 'document',
        source: { type: 'url', url: f.file_url },
        ...(f.filename ? { title: f.filename } : {}),
      } as AnthropicContentBlockParam;
    }
    if (f.file_data) {
      const dataUrlMatch = f.file_data.match(/^data:([^;]+);base64,(.+)$/);
      const mediaType = (dataUrlMatch?.[1] ?? 'application/pdf') as
        | 'application/pdf'
        | 'text/plain';
      const data = dataUrlMatch?.[2] ?? f.file_data;
      const source =
        mediaType === 'text/plain'
          ? { type: 'text' as const, media_type: 'text/plain' as const, data }
          : {
              type: 'base64' as const,
              media_type: 'application/pdf' as const,
              data,
            };
      return {
        type: 'document',
        source,
        ...(f.filename ? { title: f.filename } : {}),
      } as AnthropicContentBlockParam;
    }
    return null;
  }
  return null;
}

function mapInputContentToBlocks(
  content: string | ResponseInputContent[] | unknown,
  options: ResponsesToAnthropicOptions = {}
): string | AnthropicContentBlockParam[] {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  const blocks: AnthropicContentBlockParam[] = [];
  for (const part of content as ResponseInputContent[]) {
    const block = inputContentPartToAnthropicBlock(part, options);
    if (block) blocks.push(block);
  }
  return blocks;
}
function stringifyContent(
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

/**
 * Convert a Responses `function_call_output.output` (string | array of
 * `input_text`/`input_image`/`input_file`) into an Anthropic
 * `tool_result.content` value. Folds to a string when there's nothing
 * but text, otherwise emits an array so non-text parts (images,
 * documents) survive.
 */
function mapFunctionCallOutputToToolResultContent(
  output: unknown,
  options: ResponsesToAnthropicOptions = {}
): string | AnthropicContentBlockParam[] {
  if (typeof output === 'string') return output;
  if (!Array.isArray(output)) return '';
  const blocks: AnthropicContentBlockParam[] = [];
  let hasNonText = false;
  for (const part of output) {
    const block = inputContentPartToAnthropicBlock(part, options);
    if (!block) continue;
    if (block.type !== 'text') hasNonText = true;
    blocks.push(block);
  }
  if (!hasNonText) {
    return blocks
      .map((b) => (b.type === 'text' ? (b as { text: string }).text : ''))
      .join('');
  }
  return blocks;
}

function mapTools(tools: ResponsesTool[] | null): AnthropicTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  const out: AnthropicTool[] = [];
  for (const tool of tools) {
    if (tool.type === 'function') {
      const fn = tool as Extract<ResponsesTool, { type: 'function' }> & {
        strict?: boolean | null;
        defer_loading?: boolean;
      };
      // Responses' `FunctionTool` and Anthropic's `Tool` agree on
      // `name`, `description`, `strict`, and `defer_loading` — forward
      // them verbatim instead of dropping. `parameters` ↔ `input_schema`.
      const mapped: AnthropicTool = {
        name: fn.name,
        description: fn.description ?? undefined,
        input_schema: (fn.parameters ?? {}) as AnthropicTool['input_schema'],
      };
      if (fn.strict != null) mapped.strict = fn.strict;
      if (fn.defer_loading != null) mapped.defer_loading = fn.defer_loading;
      out.push(mapped);
    }
    // Hosted tools (web_search, file_search, code_interpreter, MCP,
    // computer use, image_gen, shell, apply_patch) have no Anthropic
    // equivalent in the standard schema — drop them to let the SDK
    // 400 if the model needs them. Server-tool passthrough for the
    // small subset Anthropic supports natively (web_search,
    // code_execution) is a future extension.
  }
  return out;
}

function mapToolChoice(
  choice: ResponseCreateParams['tool_choice']
): AnthropicMessagesRequest['tool_choice'] | undefined {
  if (!choice) return undefined;
  if (choice === 'auto') return { type: 'auto' };
  // Anthropic exposes an explicit `{ type: 'none' }` variant — keep
  // the semantic distinction between "no tool_choice set" (auto) and
  // "callers told us to forbid tool use" (none).
  if (choice === 'none') return { type: 'none' };
  if (choice === 'required') return { type: 'any' };
  if (
    typeof choice === 'object' &&
    (choice as { type?: string }).type === 'function'
  ) {
    const c = choice as { type: 'function'; name: string };
    return { type: 'tool', name: c.name };
  }
  // Responses-side `tool_choice` also accepts an `{ type: 'allowed_tools' }`
  // / `{ type: 'custom' }` / hosted-tool variants. Anthropic has no
  // direct equivalent so we fall through silently — callers needing
  // those routes can stow the original Anthropic `tool_choice` in the
  // passthrough envelope (see `applyPassthrough`).
  return undefined;
}

// ─── Response side (non-streaming) ─────────────────────────────────

export function responseAnthropicToResponses(
  message: AnthropicMessage,
  responseId: string,
  createdAt: number,
  model: string,
  originalReq?: ResponseCreateParams
): OpenAIResponse {
  const output: ResponseOutputItem[] = [];
  let outputIndex = 0;

  for (const block of message.content) {
    if (block.type === 'thinking') {
      // Preserve the Anthropic signature on the way out so a Responses
      // client that round-trips this item back through the gateway
      // re-emits a signed thinking block (T2).
      output.push({
        type: 'reasoning',
        id: `rs_${message.id}_${outputIndex++}`,
        summary: [{ type: 'summary_text', text: block.thinking ?? '' }],
        ...(block.signature ? { encrypted_content: block.signature } : {}),
      });
    } else if (block.type === 'redacted_thinking') {
      output.push({
        type: 'reasoning',
        id: `rs_${message.id}_${outputIndex++}`,
        summary: [],
        encrypted_content: `__vmx_redacted__:${block.data}`,
      });
    } else if (block.type === 'text') {
      output.push({
        type: 'message',
        id: `msg_${message.id}_${outputIndex++}`,
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
      });
    } else if (block.type === 'tool_use') {
      output.push({
        type: 'function_call',
        id: `fc_${block.id}`,
        call_id: block.id,
        name: block.name,
        arguments: JSON.stringify(block.input ?? {}),
        status: 'completed',
      });
    }
    // Server-tool blocks (server_tool_use, web_search_tool_result,
    // code_execution_tool_result, container_upload) lack Responses-API
    // equivalents in the simple-passthrough form. Drop silently — they
    // surface on the audit row's `responseData` (native Message body)
    // for any debugging that needs them.
  }

  const status: OpenAIResponse['status'] = mapStopReasonToStatus(
    message.stop_reason
  );

  const usage = message.usage ? buildResponsesUsage(message.usage) : undefined;

  return {
    id: responseId,
    object: 'response',
    created_at: createdAt,
    status,
    error: null,
    incomplete_details: buildIncompleteDetails(message.stop_reason),
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
  };
}

/**
 * Concatenate the `output_text` content parts from the response's
 * `output[]` — the SDK's `Response.output_text` convenience field is
 * non-optional, so every `Response` we synthesise has to populate it.
 */
function joinOutputText(items: ResponseOutputItem[]): string {
  const parts: string[] = [];
  for (const item of items) {
    if (item.type !== 'message') continue;
    for (const c of (
      item as { content?: Array<{ type?: string; text?: string }> }
    ).content ?? []) {
      if (c.type === 'output_text' && typeof c.text === 'string') {
        parts.push(c.text);
      }
    }
  }
  return parts.join('');
}

function buildResponsesUsage(
  usage: AnthropicMessage['usage']
): OpenAIResponse['usage'] {
  const cacheCreation = (
    usage as { cache_creation?: Record<string, number> | null }
  ).cache_creation;
  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    total_tokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
    input_tokens_details: {
      cached_tokens: usage.cache_read_input_tokens ?? 0,
      ...(usage.cache_creation_input_tokens != null
        ? { cache_creation_input_tokens: usage.cache_creation_input_tokens }
        : {}),
      ...(cacheCreation ? { cache_creation: cacheCreation } : {}),
    },
    output_tokens_details: {
      reasoning_tokens: 0,
    },
  } as OpenAIResponse['usage'];
}

function mapStopReasonToStatus(
  reason: AnthropicMessage['stop_reason']
): OpenAIResponse['status'] {
  switch (reason) {
    case 'end_turn':
    case 'tool_use':
    case 'stop_sequence':
      return 'completed';
    case 'max_tokens':
      return 'incomplete';
    case 'pause_turn':
      return 'incomplete';
    case 'refusal':
      // A streaming refusal is the closest Anthropic analogue to
      // OpenAI's `content_filter` interruption — propagate as
      // `incomplete` so strict consumers reading `incomplete_details`
      // recognise the safety stop.
      return 'incomplete';
    default:
      return 'completed';
  }
}

/**
 * Build the `incomplete_details` field on a non-streaming or final
 * streaming Response from Anthropic's `stop_reason`. Anthropic's
 * `max_tokens` → `'max_output_tokens'` and `refusal` → `'content_filter'`
 * are the only two cases the Responses spec recognises today;
 * everything else stays `null`.
 */
function buildIncompleteDetails(
  reason: AnthropicMessage['stop_reason']
): { reason: 'max_output_tokens' | 'content_filter' } | null {
  if (reason === 'max_tokens') return { reason: 'max_output_tokens' };
  if (reason === 'refusal') return { reason: 'content_filter' };
  return null;
}

// ─── Stream side ───────────────────────────────────────────────────

export async function* streamAnthropicToResponses(
  source: AsyncIterable<RawMessageStreamEvent>,
  responseId: string,
  createdAt: number,
  model: string,
  originalReq?: ResponseCreateParams
): AsyncIterable<ResponseStreamEvent> {
  let sequence = 0;
  let messageId = '';
  let outputIndex = 0;
  // Per content_block index → kind + accumulated state.
  const blockState = new Map<
    number,
    {
      kind: 'text' | 'tool_use' | 'thinking' | 'other';
      itemId: string;
      callId?: string;
      name?: string;
      argumentsAccum?: string;
      textAccum?: string;
      thinkingAccum?: string;
      // Anthropic emits the signature via `signature_delta` events
      // (typically a single delta right before `content_block_stop`).
      // We accumulate here so the final reasoning item carries the
      // signed reasoning blob in `encrypted_content` for multi-turn
      // continuity (T2).
      signatureAccum?: string;
      outputIndex: number;
    }
  >();
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadInput = 0;
  let cacheCreationInput = 0;
  let stopReason: AnthropicMessage['stop_reason'] | null = null;
  // T14: accumulate the items emitted via per-block `output_item.done`
  // so the final `response.completed` event ships a populated
  // `output[]` array — strict consumers reading the final aggregate
  // event would otherwise see `output: []` despite valid items being
  // streamed.
  const accumulatedItems: ResponseOutputItem[] = [];

  const initialResponse = makeStreamingShellResponse(
    responseId,
    createdAt,
    model,
    originalReq
  );

  yield {
    type: 'response.created',
    response: initialResponse,
    sequence_number: sequence++,
  };
  yield {
    type: 'response.in_progress',
    response: initialResponse,
    sequence_number: sequence++,
  };

  for await (const event of source) {
    switch (event.type) {
      case 'message_start': {
        messageId = event.message.id;
        const u = event.message.usage as AnthropicMessage['usage'] | undefined;
        if (u) {
          inputTokens = u.input_tokens ?? 0;
          outputTokens = u.output_tokens ?? 0;
          cacheReadInput = u.cache_read_input_tokens ?? 0;
          cacheCreationInput = u.cache_creation_input_tokens ?? 0;
        }
        break;
      }
      case 'content_block_start': {
        const idx = event.index;
        const block = event.content_block;
        if (block.type === 'text') {
          const itemId = `msg_${messageId}_${outputIndex}`;
          blockState.set(idx, {
            kind: 'text',
            itemId,
            outputIndex,
            textAccum: '',
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
          };
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
          };
          outputIndex++;
        } else if (block.type === 'tool_use') {
          const itemId = `fc_${block.id}`;
          blockState.set(idx, {
            kind: 'tool_use',
            itemId,
            callId: block.id,
            name: block.name,
            argumentsAccum: '',
            outputIndex,
          });
          yield {
            type: 'response.output_item.added',
            output_index: outputIndex,
            item: {
              type: 'function_call',
              id: itemId,
              call_id: block.id,
              name: block.name,
              arguments: '',
              status: 'in_progress',
            },
            sequence_number: sequence++,
          };
          outputIndex++;
        } else if (block.type === 'thinking') {
          const itemId = `rs_${messageId}_${outputIndex}`;
          blockState.set(idx, {
            kind: 'thinking',
            itemId,
            outputIndex,
            thinkingAccum: '',
          });
          yield {
            type: 'response.output_item.added',
            output_index: outputIndex,
            item: {
              type: 'reasoning',
              id: itemId,
              summary: [],
            },
            sequence_number: sequence++,
          };
          outputIndex++;
        } else {
          // Server-tool / unknown blocks — track to drop the matching
          // content_block_stop without yielding spurious Response events.
          blockState.set(idx, {
            kind: 'other',
            itemId: '',
            outputIndex: -1,
          });
        }
        break;
      }
      case 'content_block_delta': {
        const idx = event.index;
        const state = blockState.get(idx);
        if (!state) break;
        const delta = event.delta;
        if (state.kind === 'text' && delta.type === 'text_delta') {
          const text = delta.text ?? '';
          state.textAccum = (state.textAccum ?? '') + text;
          yield {
            type: 'response.output_text.delta',
            item_id: state.itemId,
            output_index: state.outputIndex,
            content_index: 0,
            delta: text,
            logprobs: [],
            sequence_number: sequence++,
          };
        } else if (
          state.kind === 'tool_use' &&
          delta.type === 'input_json_delta'
        ) {
          const partial = delta.partial_json ?? '';
          state.argumentsAccum = (state.argumentsAccum ?? '') + partial;
          yield {
            type: 'response.function_call_arguments.delta',
            item_id: state.itemId,
            output_index: state.outputIndex,
            delta: partial,
            sequence_number: sequence++,
          };
        } else if (
          state.kind === 'thinking' &&
          delta.type === 'thinking_delta'
        ) {
          const text = delta.thinking ?? '';
          state.thinkingAccum = (state.thinkingAccum ?? '') + text;
          yield {
            type: 'response.reasoning_summary_text.delta',
            item_id: state.itemId,
            output_index: state.outputIndex,
            summary_index: 0,
            delta: text,
            sequence_number: sequence++,
          };
        } else if (
          state.kind === 'thinking' &&
          delta.type === 'signature_delta'
        ) {
          // Accumulate the signature; emit it on the final reasoning
          // item below so the Responses-shape `encrypted_content` field
          // carries it for multi-turn signed-thinking continuity.
          state.signatureAccum = (state.signatureAccum ?? '') + delta.signature;
        }
        break;
      }
      case 'content_block_stop': {
        const idx = event.index;
        const state = blockState.get(idx);
        if (!state) break;
        if (state.kind === 'text') {
          const text = state.textAccum ?? '';
          yield {
            type: 'response.output_text.done',
            item_id: state.itemId,
            output_index: state.outputIndex,
            content_index: 0,
            text,
            logprobs: [],
            sequence_number: sequence++,
          };
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
          };
          const messageItem: ResponseOutputItem = {
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
          };
        } else if (state.kind === 'tool_use') {
          yield {
            type: 'response.function_call_arguments.done',
            item_id: state.itemId,
            output_index: state.outputIndex,
            arguments: state.argumentsAccum ?? '',
            name: state.name ?? '',
            sequence_number: sequence++,
          };
          const functionCallItem: ResponseOutputItem = {
            type: 'function_call',
            id: state.itemId,
            call_id: state.callId ?? '',
            name: state.name ?? '',
            arguments: state.argumentsAccum ?? '',
            status: 'completed',
          };
          accumulatedItems.push(functionCallItem);
          yield {
            type: 'response.output_item.done',
            output_index: state.outputIndex,
            item: functionCallItem,
            sequence_number: sequence++,
          };
        } else if (state.kind === 'thinking') {
          yield {
            type: 'response.reasoning_summary_text.done',
            item_id: state.itemId,
            output_index: state.outputIndex,
            summary_index: 0,
            text: state.thinkingAccum ?? '',
            sequence_number: sequence++,
          };
          // Surface the accumulated Anthropic signature on the
          // Responses item so a downstream caller can round-trip
          // it back through the gateway with multi-turn signed-
          // thinking continuity intact (T2).
          const reasoningItem: ResponseOutputItem = {
            type: 'reasoning',
            id: state.itemId,
            summary: [
              { type: 'summary_text', text: state.thinkingAccum ?? '' },
            ],
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
          };
        }
        blockState.delete(idx);
        break;
      }
      case 'message_delta': {
        const u = event.usage as
          | (AnthropicMessage['usage'] & {
              cache_read_input_tokens?: number | null;
              cache_creation_input_tokens?: number | null;
            })
          | undefined;
        if (u) {
          // Anthropic emits cumulative-last-wins on message_delta.
          if (typeof u.output_tokens === 'number') {
            outputTokens = u.output_tokens;
          }
          if (typeof u.input_tokens === 'number') {
            inputTokens = u.input_tokens;
          }
          // `message_delta.usage` also carries cumulative cache-token
          // counters per the SDK's `MessageDeltaUsage` shape — propagate
          // so the final `response.completed` usage reflects them.
          if (typeof u.cache_read_input_tokens === 'number') {
            cacheReadInput = u.cache_read_input_tokens;
          }
          if (typeof u.cache_creation_input_tokens === 'number') {
            cacheCreationInput = u.cache_creation_input_tokens;
          }
        }
        if (event.delta.stop_reason) {
          stopReason = event.delta.stop_reason;
        }
        break;
      }
      case 'message_stop': {
        const finalResponse = makeFinalResponse({
          responseId,
          createdAt,
          model,
          outputItems: accumulatedItems,
          stopReason,
          usage: {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cache_read_input_tokens: cacheReadInput,
            cache_creation_input_tokens: cacheCreationInput,
          },
          originalReq,
        });
        yield {
          type: 'response.completed',
          response: finalResponse,
          sequence_number: sequence++,
        };
        break;
      }
      // Server-tool start / stop / delta and citation events fall
      // through silently — no Responses-API equivalent.
      default:
        break;
    }
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
  };
}

function makeFinalResponse(args: {
  responseId: string;
  createdAt: number;
  model: string;
  outputItems: ResponseOutputItem[];
  stopReason: AnthropicMessage['stop_reason'] | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
  originalReq?: ResponseCreateParams;
}): OpenAIResponse {
  return {
    id: args.responseId,
    object: 'response',
    created_at: args.createdAt,
    status: mapStopReasonToStatus(args.stopReason),
    error: null,
    incomplete_details: buildIncompleteDetails(args.stopReason),
    instructions: args.originalReq?.instructions ?? null,
    max_output_tokens: args.originalReq?.max_output_tokens ?? null,
    model: args.model,
    output: args.outputItems,
    output_text: joinOutputText(args.outputItems),
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
    },
    metadata: args.originalReq?.metadata ?? null,
  };
}

// ─── Provider class ────────────────────────────────────────────────

@Injectable()
export class AnthropicOpenAIResponseProvider {
  constructor(private readonly dispatcher: AnthropicDispatcher) {}

  async handle(
    request: ResponseCreateParams,
    connection: AIConnectionEntity<AnthropicConnectionConfig>,
    model: AIResourceModelConfigEntity,
    options?: CompletionRequestOptions
  ): Promise<OpenAIResponseResponse> {
    const anthropicBody: AnthropicMessagesRequest = {
      ...requestResponsesToAnthropic(request),
      model: model.model,
    };
    const native = await this.dispatcher.dispatchNative(
      anthropicBody,
      connection,
      model,
      options
    );
    const responseId = `resp_${uuidv4()}`;
    const createdAt = Math.floor(Date.now() / 1000);

    if (
      native.data != null &&
      typeof (native.data as AsyncIterable<RawMessageStreamEvent>)[
        Symbol.asyncIterator
      ] === 'function'
    ) {
      return {
        data: streamAnthropicToResponses(
          native.data as AsyncIterable<RawMessageStreamEvent>,
          responseId,
          createdAt,
          model.model,
          request
        ),
        headers: native.headers,
        providerRequestPayload: native.providerRequestPayload,
      };
    }
    return {
      data: responseAnthropicToResponses(
        native.data as AnthropicMessage,
        responseId,
        createdAt,
        model.model,
        request
      ),
      headers: native.headers,
      providerRequestPayload: native.providerRequestPayload,
    };
  }
}
