import { Injectable } from '@nestjs/common';
import {
  ContentBlock,
  ConverseCommandInput,
  ConverseCommandOutput,
  ConverseStreamOutput,
  Message as ConverseMessage,
  StopReason,
  Tool as ConverseTool,
  ToolChoice as ConverseToolChoice,
  ToolResultContentBlock,
} from '@aws-sdk/client-bedrock-runtime';
import type {
  ContentBlockParam as AnthropicContentBlockParam,
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
} from './shared';
import { assertModelSupportsFeatures } from './capability-gate';

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
 *       text content   → ContentBlock.text
 *       image content  → ContentBlock.image
 *       document       → ContentBlock.document
 *       tool_use       → ContentBlock.toolUse
 *       tool_result    → ContentBlock.toolResult
 *       thinking       → ContentBlock.reasoningContent
 *     tools (custom)   → toolConfig.tools[].toolSpec
 *     tool_choice      → toolConfig.toolChoice
 *     temperature, top_p → inferenceConfig
 *     max_tokens       → inferenceConfig.maxTokens
 *     stop_sequences   → inferenceConfig.stopSequences
 *     top_k            → additionalModelRequestFields.top_k
 *
 *   Response  Converse → Anthropic
 *     output.message.content
 *       text           → text block
 *       toolUse        → tool_use block
 *       reasoningContent → thinking block
 *     stopReason       → stop_reason (mapped via STOP_REASONS_MAP)
 *     usage            → input_tokens / output_tokens / cache_*
 *
 *   Stream  Converse → Anthropic SSE
 *     messageStart → message_start
 *     contentBlockStart (toolUse) → content_block_start (tool_use)
 *     contentBlockDelta (text) → content_block_delta (text_delta)
 *     contentBlockDelta (toolUse) → content_block_delta (input_json_delta)
 *     contentBlockDelta (reasoningContent) → content_block_delta (thinking_delta)
 *     contentBlockStop → content_block_stop
 *     messageStop      → message_delta + message_stop
 *     metadata.usage   → message_delta with usage
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

// ─── Request side ──────────────────────────────────────────────────

export function requestAnthropicToConverse(
  req: AnthropicMessagesRequest,
  modelId: string
): ConverseCommandInput {
  const messages: ConverseMessage[] = [];
  for (const m of req.messages) {
    const conv = mapAnthropicMessageToConverse(m);
    if (conv) messages.push(conv);
  }

  const system: ConverseCommandInput['system'] = [];
  if (typeof req.system === 'string' && req.system.length > 0) {
    system.push({ text: req.system });
  } else if (Array.isArray(req.system)) {
    for (const block of req.system as TextBlockParam[]) {
      if (block.type === 'text' && block.text) {
        system.push({ text: block.text });
        // Per-block `cache_control` on a system text block → trailing
        // `cachePoint` block in the Converse system array.
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
    : mapAnthropicToolsToConverse(req.tools as AnthropicTool[] | undefined);
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
  };

  return input;
}

function mapAnthropicMessageToConverse(
  m: AnthropicMessageParam
): ConverseMessage | null {
  if (m.role !== 'user' && m.role !== 'assistant') return null;
  let content: ContentBlock[];
  if (typeof m.content === 'string') {
    content = [{ text: m.content }];
  } else {
    content = [];
    // Walk Anthropic blocks; emit the converted Converse block, then
    // emit a `cachePoint` block right after if the source carried
    // `cache_control` (caller's "cache up to here" marker). Bedrock
    // Converse interprets a `cachePoint` interleaved with content as
    // the cacheable-prefix terminator, matching Anthropic semantics.
    for (const block of m.content as AnthropicContentBlockParam[]) {
      const converted = mapAnthropicContentBlockToConverse(block);
      if (converted) content.push(converted);
      if ('cache_control' in block && block.cache_control) {
        content.push({
          cachePoint: {
            type: 'default',
            ...(block.cache_control.ttl
              ? { ttl: block.cache_control.ttl }
              : {}),
          },
        } as ContentBlock);
      }
    }
  }
  if (content.length === 0) return null;
  return { role: m.role, content };
}

function mapAnthropicContentBlockToConverse(
  block: AnthropicContentBlockParam
): ContentBlock | null {
  switch (block.type) {
    case 'text':
      return { text: block.text };
    case 'image': {
      const src = block.source;
      if (src.type === 'base64') {
        const format = src.media_type.split('/').pop()?.toLowerCase();
        return {
          image: {
            format: (format ?? 'jpeg') as never,
            source: { bytes: Buffer.from(src.data, 'base64') },
          },
        };
      }
      // URL-source images aren't natively supported by Converse's
      // ImageBlock — drop silently rather than failing the call.
      return null;
    }
    case 'tool_use':
      return {
        toolUse: {
          toolUseId: block.id,
          name: block.name,
          // SDK types `input` as `DocumentType` (effectively any
          // JSON-serialisable value); cast through unknown to widen
          // from Anthropic's `Record<string, unknown>` shape.
          input: (block.input ?? {}) as unknown as never,
        },
      };
    case 'tool_result':
      return {
        toolResult: {
          toolUseId: block.tool_use_id,
          content: mapToolResultContent(block.content),
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
    // redacted_thinking, document (with non-base64 source), server-tool
    // blocks have no Converse equivalent / are non-trivial — drop.
    default:
      return null;
  }
}

function mapToolResultContent(
  content: Extract<
    AnthropicContentBlockParam,
    { type: 'tool_result' }
  >['content']
): ToolResultContentBlock[] {
  if (typeof content === 'string') return [{ text: content }];
  if (!Array.isArray(content)) return [{ text: '' }];
  return (content as Array<{ type?: string; text?: string }>)
    .map((c) =>
      c.type === 'text'
        ? ({ text: c.text ?? '' } as ToolResultContentBlock)
        : null
    )
    .filter((b): b is ToolResultContentBlock => b != null);
}

function mapAnthropicToolsToConverse(
  tools?: AnthropicTool[]
): ConverseTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  const out: ConverseTool[] = [];
  for (const t of tools) {
    if (!('input_schema' in t)) continue;
    out.push({
      toolSpec: {
        name: t.name,
        description: t.description,
        inputSchema: {
          json: t.input_schema as Record<string, unknown> as never,
        },
      },
    });
    // Per-tool `cache_control` → trailing `cachePoint` Tool entry.
    // Bedrock Converse caches the tool definitions through the
    // breakpoint, mirroring Anthropic's behaviour.
    const cc = (
      t as { cache_control?: { type: 'ephemeral'; ttl?: '5m' | '1h' } }
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
      return undefined;
  }
}

// ─── Response side (non-streaming) ─────────────────────────────────

export function responseConverseToAnthropic(
  resp: ConverseCommandOutput,
  model: string
): AnthropicMessage {
  const content: AnthropicContentBlockParam[] = [];
  for (const block of resp.output?.message?.content ?? []) {
    if (block.text) {
      content.push({ type: 'text', text: block.text });
    } else if (block.toolUse) {
      content.push({
        type: 'tool_use',
        id: block.toolUse.toolUseId ?? uuidv4(),
        name: block.toolUse.name ?? '',
        input: (block.toolUse.input as Record<string, unknown>) ?? {},
      });
    } else if (block.reasoningContent?.reasoningText) {
      content.push({
        type: 'thinking',
        thinking: block.reasoningContent.reasoningText.text ?? '',
        signature: block.reasoningContent.reasoningText.signature ?? '',
      });
    }
  }

  const stopReason: AnthropicMessage['stop_reason'] = resp.stopReason
    ? CONVERSE_STOP_TO_ANTHROPIC[resp.stopReason] ?? 'end_turn'
    : 'end_turn';

  const usage = resp.usage
    ? {
        input_tokens: resp.usage.inputTokens ?? 0,
        output_tokens: resp.usage.outputTokens ?? 0,
        cache_read_input_tokens: resp.usage.cacheReadInputTokens ?? null,
        cache_creation_input_tokens: resp.usage.cacheWriteInputTokens ?? null,
        server_tool_use: null,
        service_tier: null,
      }
    : undefined;

  return {
    id: `msg_${uuidv4()}`,
    type: 'message',
    role: 'assistant',
    model,
    content: content as AnthropicMessage['content'],
    stop_reason: stopReason,
    stop_sequence: null,
    ...(usage ? { usage } : {}),
  } as unknown as AnthropicMessage;
}

// ─── Stream side ───────────────────────────────────────────────────

export async function* streamConverseToAnthropic(
  source: AsyncIterable<ConverseStreamOutput>,
  model: string
): AsyncIterable<RawMessageStreamEvent> {
  const messageId = `msg_${uuidv4()}`;
  let outputBlocks = 0;
  // Per Converse contentBlockIndex → which Anthropic block kind it is,
  // so we can emit the right delta type and stop event later.
  const blockKinds = new Map<number, 'text' | 'tool_use' | 'thinking'>();
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadInput: number | null = null;
  let cacheCreationInput: number | null = null;
  let stopReason: AnthropicMessage['stop_reason'] | null = null;
  let messageStartEmitted = false;

  for await (const item of source) {
    if (item.messageStart) {
      yield {
        type: 'message_start',
        message: {
          id: messageId,
          type: 'message',
          role: 'assistant',
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_read_input_tokens: null,
            cache_creation_input_tokens: null,
            server_tool_use: null,
            service_tier: null,
          } as never,
        } as never,
      } as unknown as RawMessageStreamEvent;
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
          } as never,
        } as unknown as RawMessageStreamEvent;
      }
      // Converse only sends contentBlockStart for tool_use; text +
      // reasoningContent blocks emit their first delta as the "start".
      // We emit a synthetic content_block_start on first delta below.
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
            content_block: { type: 'text', text: '' } as never,
          } as unknown as RawMessageStreamEvent;
        }
        yield {
          type: 'content_block_delta',
          index: idx,
          delta: { type: 'text_delta', text: delta.text } as never,
        } as unknown as RawMessageStreamEvent;
      } else if (delta?.toolUse) {
        if (!blockKinds.has(idx)) blockKinds.set(idx, 'tool_use');
        yield {
          type: 'content_block_delta',
          index: idx,
          delta: {
            type: 'input_json_delta',
            partial_json: delta.toolUse.input ?? '',
          } as never,
        } as unknown as RawMessageStreamEvent;
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
            } as never,
          } as unknown as RawMessageStreamEvent;
        }
        if (delta.reasoningContent.text) {
          yield {
            type: 'content_block_delta',
            index: idx,
            delta: {
              type: 'thinking_delta',
              thinking: delta.reasoningContent.text,
            } as never,
          } as unknown as RawMessageStreamEvent;
        }
      }
      continue;
    }
    if (item.contentBlockStop) {
      const idx = item.contentBlockStop.contentBlockIndex ?? outputBlocks;
      yield {
        type: 'content_block_stop',
        index: idx,
      } as unknown as RawMessageStreamEvent;
      outputBlocks = Math.max(outputBlocks, idx + 1);
      continue;
    }
    if (item.messageStop) {
      stopReason = item.messageStop.stopReason
        ? CONVERSE_STOP_TO_ANTHROPIC[item.messageStop.stopReason] ?? 'end_turn'
        : 'end_turn';
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

  // Anthropic SSE always ends with message_delta (carrying stop_reason
  // + usage) followed by message_stop. Emit both even when Converse
  // didn't surface a metadata.usage event — clients rely on the
  // terminator pair.
  if (!messageStartEmitted) {
    // Defensive: Converse was silent; emit a minimal start so the
    // stream is still a valid Anthropic event sequence.
    yield {
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
        } as never,
      } as never,
    } as unknown as RawMessageStreamEvent;
  }

  yield {
    type: 'message_delta',
    delta: { stop_reason: stopReason ?? 'end_turn', stop_sequence: null },
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_read_input_tokens: cacheReadInput,
      cache_creation_input_tokens: cacheCreationInput,
      server_tool_use: null,
    } as never,
  } as unknown as RawMessageStreamEvent;
  yield { type: 'message_stop' } as unknown as RawMessageStreamEvent;
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
    const input = requestAnthropicToConverse(request, model.model);
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
