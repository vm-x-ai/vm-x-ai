import { HttpStatus } from '@nestjs/common';
import type {
  ChatCompletion,
  ChatCompletionAssistantMessageParam,
  ChatCompletionChunk,
  ChatCompletionContentPart,
  ChatCompletionCreateParams,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
  ChatCompletionToolChoiceOption,
} from 'openai/resources/index.js';
import type {
  Response,
  ResponseCreateParams,
  ResponseFunctionToolCall,
  ResponseInputContent,
  ResponseInputItem,
  ResponseOutputItem,
  ResponseStreamEvent,
  ResponseTextConfig,
  Tool,
} from 'openai/resources/responses/responses';
import { CompletionError } from '../completion.types';
import { ResponsesRequestDto } from './dto/responses-request.dto';

export type ResponsesToChatCompletionOptions = {
  /**
   * Default `'strict'`. Throws on Responses-only tools (`web_search`,
   * `file_search`, `code_interpreter`, MCP, `computer_use_preview`,
   * `image_generation`, `shell`, `apply_patch`) that have no Chat
   * Completions equivalent — appropriate when the converted body is
   * about to be dispatched to an OpenAI-compat upstream that genuinely
   * can't speak hosted tools.
   *
   * `'lenient'` drops unsupported tool types and returns a converted
   * body with only the function tools intact. Use this when the
   * converted body is only needed for routing/gating/audit scoping —
   * the original Responses body still carries the dropped tools and
   * survives intact when dispatch actually goes native.
   */
  unsupportedToolPolicy?: 'strict' | 'lenient';
};

/**
 * Convert a VM-X Responses-API request into a Chat Completions request that
 * existing VM-X CompletionService machinery can dispatch.
 *
 * Supported subset (matches the typical multi-turn agent loop):
 * - input: string OR array of {message, function_call, function_call_output, reasoning}
 * - text.format: text | json_object | json_schema
 * - reasoning: {effort, summary} -> reasoning_effort (chat completions extension)
 * - function tools only
 *
 * Unsupported items (file_search, web_search, computer use, MCP, image gen,
 * code interpreter, shell, apply_patch) raise a 400 in `'strict'` mode
 * (the default) — those tools are provider-side rather than
 * gateway-routable. Use `unsupportedToolPolicy: 'lenient'` when the
 * converted body is only needed for routing/gating scoping and the
 * original Responses body will be used for the actual dispatch.
 */
export function responsesRequestToChatCompletion(
  payload: ResponsesRequestDto,
  options: ResponsesToChatCompletionOptions = {}
): ChatCompletionCreateParams {
  const messages: ChatCompletionMessageParam[] = [];

  if (payload.instructions) {
    messages.push({ role: 'system', content: payload.instructions });
  }

  const inputItems: ResponseInputItem[] = Array.isArray(payload.input)
    ? payload.input
    : [
        {
          type: 'message',
          role: 'user',
          content: payload.input,
        } as ResponseInputItem,
      ];

  for (const item of inputItems) {
    appendInputItem(messages, item);
  }

  const out: ChatCompletionCreateParams = {
    model: payload.model,
    messages,
  };

  if (payload.temperature !== null && payload.temperature !== undefined) {
    out.temperature = payload.temperature;
  }
  if (payload.top_p !== null && payload.top_p !== undefined) {
    out.top_p = payload.top_p;
  }
  if (
    payload.max_output_tokens !== null &&
    payload.max_output_tokens !== undefined
  ) {
    out.max_completion_tokens = payload.max_output_tokens;
  }
  if (payload.stop) {
    out.stop = payload.stop;
  }
  if (payload.stream) {
    (out as ChatCompletionCreateParams & { stream?: boolean }).stream = true;
  }

  const responseFormat = mapTextToResponseFormat(payload.text ?? null);
  if (responseFormat) {
    out.response_format = responseFormat;
  }

  if (payload.reasoning?.effort) {
    (
      out as ChatCompletionCreateParams & {
        reasoning_effort?: string;
      }
    ).reasoning_effort = payload.reasoning.effort;
  }

  const tools = mapTools(
    payload.tools ?? null,
    options.unsupportedToolPolicy ?? 'strict'
  );
  if (tools && tools.length > 0) {
    out.tools = tools;
    const toolChoice = mapToolChoice(payload.tool_choice);
    if (toolChoice !== undefined) {
      out.tool_choice = toolChoice;
    }
  }

  // Forward Responses-API extras to OpenAI Chat Completions where the
  // SDK has a direct equivalent. Strict OpenAI ignores unknown extras
  // and the OpenAI provider strips the `__vmx_passthrough` envelope
  // before send, so adding plumbing here is safe.
  if (payload.parallel_tool_calls === false) {
    out.parallel_tool_calls = false;
  }
  if (payload.metadata) {
    out.metadata = payload.metadata;
  }
  if (payload.prompt_cache_key) {
    (
      out as ChatCompletionCreateParams & { prompt_cache_key?: string }
    ).prompt_cache_key = payload.prompt_cache_key;
  }
  if (payload.previous_response_id) {
    // No native Chat Completions field for this — pass through on the
    // body so providers that recognise it (native Responses API
    // upstream) can read it. OpenAI Chat Completions ignores unknown
    // top-level fields.
    (
      out as ChatCompletionCreateParams & { previous_response_id?: string }
    ).previous_response_id = payload.previous_response_id;
  }
  if (payload.service_tier) {
    (out as unknown as { service_tier?: string }).service_tier =
      payload.service_tier;
  }
  if (payload.truncation && payload.truncation !== 'disabled') {
    (out as ChatCompletionCreateParams & { truncation?: string }).truncation =
      payload.truncation;
  }

  // Carry the vmx envelope so CompletionService still picks up correlationId,
  // metadata, secondaryModelIndex, resourceConfigOverrides.
  (out as ChatCompletionCreateParams & { vmx?: typeof payload.vmx }).vmx =
    payload.vmx ?? null;

  return out;
}

function appendInputItem(
  messages: ChatCompletionMessageParam[],
  item: ResponseInputItem
): void {
  // Some items don't carry a `type` (EasyInputMessage); detect by shape.
  const type = (item as { type?: string }).type;

  if (type === 'message' || type === undefined) {
    const msg = item as Extract<
      ResponseInputItem,
      { type?: 'message'; role: 'user' | 'system' | 'developer' | 'assistant' }
    >;
    const role = msg.role;
    const content = mapInputMessageContent(msg.content);

    if (role === 'system' || role === 'developer') {
      messages.push({
        role: 'system',
        content: typeof content === 'string' ? content : flattenToText(content),
      });
    } else if (role === 'user') {
      messages.push({
        role: 'user',
        content: content as string | ChatCompletionContentPart[],
      });
    } else if (role === 'assistant') {
      const assistantMsg: ChatCompletionAssistantMessageParam = {
        role: 'assistant',
        content: typeof content === 'string' ? content : flattenToText(content),
      };
      messages.push(assistantMsg);
    }
    return;
  }

  if (type === 'function_call') {
    const call = item as ResponseFunctionToolCall;
    // Function calls belong on an assistant message — coalesce onto the last
    // assistant message if present, otherwise create a new empty one.
    const last = messages[messages.length - 1];
    const toolCall: ChatCompletionMessageToolCall = {
      id: call.call_id,
      type: 'function',
      function: { name: call.name, arguments: call.arguments },
    };
    if (last && last.role === 'assistant') {
      const asst = last as ChatCompletionAssistantMessageParam;
      asst.tool_calls = [...(asst.tool_calls ?? []), toolCall];
    } else {
      messages.push({
        role: 'assistant',
        content: '',
        tool_calls: [toolCall],
      });
    }
    return;
  }

  if (type === 'function_call_output') {
    const out = item as Extract<
      ResponseInputItem,
      { type: 'function_call_output' }
    >;
    messages.push({
      role: 'tool',
      tool_call_id: out.call_id,
      content:
        typeof out.output === 'string'
          ? out.output
          : Array.isArray(out.output)
          ? flattenFunctionCallOutputContent(out.output)
          : '',
    });
    return;
  }

  if (type === 'reasoning') {
    // Chat Completions has no first-class reasoning input. Preserve
    // the encrypted summary on the previous assistant message so
    // native-Responses providers can re-attach it for multi-turn
    // continuity; OpenAI Chat Completions ignores the unknown field.
    const reasoningItem = item as Extract<
      ResponseInputItem,
      { type: 'reasoning' }
    >;
    const last = messages[messages.length - 1];
    if (last && last.role === 'assistant') {
      (
        last as ChatCompletionAssistantMessageParam & {
          reasoning?: typeof reasoningItem;
        }
      ).reasoning = reasoningItem;
    }
    return;
  }

  throw new CompletionError({
    message: `Unsupported Responses-API input item type: ${type}`,
    rate: false,
    retryable: false,
    statusCode: HttpStatus.BAD_REQUEST,
    failureReason: 'Unsupported input item type',
    openAICompatibleError: {
      code: 'responses_unsupported_input_item',
      param: `input.${type}`,
    },
  });
}

function mapInputMessageContent(
  content: string | ResponseInputContent[] | unknown
): string | ChatCompletionContentPart[] {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  const parts: ChatCompletionContentPart[] = [];
  for (const part of content as ResponseInputContent[]) {
    const t = (part as { type?: string }).type;
    if (t === 'input_text' || t === 'output_text') {
      parts.push({ type: 'text', text: (part as { text: string }).text });
    } else if (t === 'input_image') {
      const imagePart = part as { image_url?: string; detail?: string };
      if (imagePart.image_url) {
        parts.push({
          type: 'image_url',
          image_url: {
            url: imagePart.image_url,
            ...(imagePart.detail
              ? { detail: imagePart.detail as 'auto' | 'low' | 'high' }
              : {}),
          },
        });
      }
    }
  }
  return parts;
}

function flattenToText(content: ChatCompletionContentPart[] | string): string {
  if (typeof content === 'string') return content;
  return content
    .filter((p) => p.type === 'text')
    .map((p) => (p as { text: string }).text)
    .join('\n');
}

function flattenFunctionCallOutputContent(
  parts: Array<{ type?: string; text?: string }>
): string {
  return parts
    .filter((p) => p.type === 'input_text' || p.type === 'output_text')
    .map((p) => p.text ?? '')
    .join('');
}

function mapTextToResponseFormat(
  text: ResponseTextConfig | null
): ChatCompletionCreateParams['response_format'] | undefined {
  if (!text?.format) return undefined;
  const fmt = text.format;
  if (fmt.type === 'text') return { type: 'text' };
  if (fmt.type === 'json_object') return { type: 'json_object' };
  if (fmt.type === 'json_schema') {
    const schemaCfg = fmt as {
      type: 'json_schema';
      name: string;
      description?: string;
      schema?: Record<string, unknown>;
      strict?: boolean | null;
    };
    return {
      type: 'json_schema',
      json_schema: {
        name: schemaCfg.name,
        description: schemaCfg.description,
        schema: schemaCfg.schema,
        strict: schemaCfg.strict ?? null,
      },
    };
  }
  return undefined;
}

function mapTools(
  tools: Tool[] | null,
  policy: 'strict' | 'lenient'
): ChatCompletionTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  const out: ChatCompletionTool[] = [];
  for (const tool of tools) {
    if (tool.type === 'function') {
      const fn = tool as Extract<Tool, { type: 'function' }>;
      // Omit `strict` entirely when unset rather than passing `null`.
      // OpenAI tolerates `strict: null` but other OpenAI-compat
      // upstreams (Groq, Gemini's compat shim) reject it with a 400
      // because their JSON-schema validator treats the field as
      // non-nullable.
      const fnDef: {
        name: string;
        description?: string;
        parameters: Record<string, unknown>;
        strict?: boolean;
      } = {
        name: fn.name,
        description: fn.description ?? undefined,
        parameters: fn.parameters as Record<string, unknown>,
      };
      if (fn.strict != null) fnDef.strict = fn.strict;
      out.push({ type: 'function', function: fnDef });
      continue;
    }
    // Server-side / native Responses-API tools (file_search, web_search,
    // computer_use_preview, mcp, image_generation, code_interpreter,
    // shell, apply_patch) have no Chat Completions equivalent. In
    // `'strict'` mode (per-provider OpenAI-compat dispatch) we surface a
    // 400 — the client is asking for a feature the upstream can't
    // fulfil through the Chat Completions pivot. In `'lenient'` mode
    // (gateway-side routing/audit conversion) we drop the tool: the
    // original Responses body still carries it intact, and the dispatch
    // path either (a) goes native via `provider.openAIResponse` so the
    // tool reaches upstream verbatim, or (b) routes to a non-native
    // provider whose own `dispatchOpenAIResponseViaOpenAICompat` re-runs
    // this converter in `'strict'` mode and surfaces the 400 there.
    if (policy === 'strict') {
      throw new CompletionError({
        message: `Responses-API tool type '${tool.type}' is not yet routable through VM-X's Chat Completions pivot. Use the OpenAI Responses endpoint directly, or send the request via the Anthropic format with the equivalent server tool.`,
        rate: false,
        retryable: false,
        statusCode: HttpStatus.BAD_REQUEST,
        failureReason: 'Unsupported Responses-API tool type',
        openAICompatibleError: {
          code: 'responses_unsupported_tool_type',
          param: `tools.${tool.type}`,
        },
      });
    }
    // 'lenient' — drop and continue.
  }
  return out;
}

function mapToolChoice(
  choice: ResponseCreateParams['tool_choice']
): ChatCompletionToolChoiceOption | undefined {
  if (!choice) return undefined;
  if (choice === 'auto' || choice === 'none' || choice === 'required') {
    return choice;
  }
  if (
    typeof choice === 'object' &&
    (choice as { type?: string }).type === 'function'
  ) {
    const c = choice as { type: 'function'; name: string };
    return { type: 'function', function: { name: c.name } };
  }
  return undefined;
}

// ----------------------------------------------------------------------------
// Response (non-streaming) conversion
// ----------------------------------------------------------------------------

export function chatCompletionToResponse(
  chat: ChatCompletion,
  responseId: string,
  createdAt: number,
  model: string,
  /**
   * Original Responses-API request — used to echo client-provided
   * fields back on the response (`metadata`, `instructions`,
   * `max_output_tokens`, `temperature`, `top_p`, `tools`,
   * `tool_choice`, `truncation`, `previous_response_id`, etc.)
   * instead of hardcoding them to null.
   */
  request?: ResponsesRequestDto | null
): Response {
  const choice = chat.choices[0];
  const output: ResponseOutputItem[] = [];

  // Surface reasoning content first when the upstream Anthropic
  // provider stowed thinking blocks under `message.reasoning`. Order
  // matters for round-tripping into a follow-up turn.
  const reasoning = (
    choice?.message as
      | { reasoning?: { thinking?: string; signature?: string } }
      | undefined
  )?.reasoning;
  if (reasoning?.thinking) {
    output.push({
      type: 'reasoning',
      id: `rs_${chat.id}`,
      summary: [{ type: 'summary_text', text: reasoning.thinking }],
    } as unknown as ResponseOutputItem);
  }

  if (choice?.message.content) {
    output.push({
      type: 'message',
      id: `msg_${chat.id}`,
      status: 'completed',
      role: 'assistant',
      content: [
        {
          type: 'output_text',
          text: choice.message.content,
          annotations: [],
          logprobs: [],
        },
      ],
    } as unknown as ResponseOutputItem);
  }

  if (choice?.message.tool_calls?.length) {
    for (const call of choice.message.tool_calls) {
      if (call.type === 'function') {
        output.push({
          type: 'function_call',
          id: `fc_${call.id}`,
          call_id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
          status: 'completed',
        } as unknown as ResponseOutputItem);
      }
    }
  }

  const status: Response['status'] = mapFinishReasonToStatus(
    choice?.finish_reason ?? 'stop'
  );

  const ptd = chat.usage?.prompt_tokens_details as
    | (Record<string, unknown> & {
        cached_tokens?: number;
        cache_creation_input_tokens?: number;
      })
    | undefined;
  const ctd = chat.usage?.completion_tokens_details as
    | (Record<string, unknown> & { reasoning_tokens?: number })
    | undefined;
  const usage = chat.usage
    ? {
        input_tokens: chat.usage.prompt_tokens,
        output_tokens: chat.usage.completion_tokens,
        total_tokens: chat.usage.total_tokens,
        input_tokens_details: {
          cached_tokens: ptd?.cached_tokens ?? 0,
          // Cache-creation isn't part of the Responses-API SDK spec,
          // but we surface it via extension so audit / dashboards see
          // the breakdown when a native Anthropic provider is used.
          ...(ptd?.cache_creation_input_tokens != null
            ? { cache_creation_input_tokens: ptd.cache_creation_input_tokens }
            : {}),
        },
        output_tokens_details: {
          reasoning_tokens: ctd?.reasoning_tokens ?? 0,
        },
      }
    : undefined;

  return {
    id: responseId,
    object: 'response',
    created_at: createdAt,
    status,
    error: null,
    incomplete_details: null,
    instructions: request?.instructions ?? null,
    max_output_tokens: request?.max_output_tokens ?? null,
    model,
    output,
    parallel_tool_calls: request?.parallel_tool_calls ?? true,
    previous_response_id: request?.previous_response_id ?? null,
    reasoning: request?.reasoning ?? null,
    store: request?.store ?? false,
    temperature: request?.temperature ?? null,
    text: request?.text ?? { format: { type: 'text' } },
    tool_choice: request?.tool_choice ?? 'auto',
    tools: request?.tools ?? [],
    top_p: request?.top_p ?? null,
    truncation: request?.truncation ?? 'disabled',
    usage,
    user: null,
    metadata: request?.metadata ?? null,
  } as unknown as Response;
}

function mapFinishReasonToStatus(
  reason: ChatCompletion.Choice['finish_reason']
): Response['status'] {
  switch (reason) {
    case 'stop':
    case 'tool_calls':
    case 'function_call':
      return 'completed';
    case 'length':
      return 'incomplete';
    case 'content_filter':
      return 'incomplete';
    default:
      return 'completed';
  }
}

// ----------------------------------------------------------------------------
// Streaming conversion
// ----------------------------------------------------------------------------

/**
 * Convert a Chat Completions chunk stream into Response API stream events.
 *
 * Emits the events that multi-turn agent loops switch on:
 *   - response.created
 *   - response.in_progress
 *   - response.output_item.added (message + function_call)
 *   - response.content_part.added / .done (text)
 *   - response.output_text.delta / .done
 *   - response.function_call_arguments.delta / .done
 *   - response.output_item.done
 *   - response.completed / .failed
 *
 * Reasoning summary deltas: chat.completions has no standard reasoning stream;
 * we surface OpenAI's `delta.reasoning` extension when present as
 * response.reasoning_summary_text.delta events.
 */
export async function* chatCompletionStreamToResponseStream(
  source: AsyncIterable<ChatCompletionChunk>,
  responseId: string,
  createdAt: number,
  model: string
): AsyncIterable<ResponseStreamEvent> {
  // Initial events
  const initialResponse = makeStreamingShellResponse(
    responseId,
    createdAt,
    model
  );
  let sequence = 0;

  yield {
    type: 'response.created',
    response: initialResponse,
    sequence_number: sequence++,
  } as unknown as ResponseStreamEvent;
  yield {
    type: 'response.in_progress',
    response: initialResponse,
    sequence_number: sequence++,
  } as unknown as ResponseStreamEvent;

  let outputIndex = 0;
  let messageStarted = false;
  let messageItemId = '';
  let textPartStarted = false;
  let accumulatedText = '';
  let accumulatedReasoning = '';
  let reasoningStarted = false;

  // Per tool-call delta state, keyed by chat-completion tool_call index.
  const toolCalls = new Map<
    number,
    {
      itemId: string;
      callId: string;
      name: string;
      argumentsAccum: string;
      outputIndex: number;
      addedEmitted: boolean;
    }
  >();

  let usage: ChatCompletionChunk['usage'] | undefined;
  let finishReason: ChatCompletion.Choice['finish_reason'] | null = null;

  try {
    for await (const chunk of source) {
      if (chunk.usage) {
        usage = chunk.usage;
      }
      const choice = chunk.choices?.[0];
      if (!choice) continue;

      const delta = choice.delta as ChatCompletionChunk.Choice['delta'] & {
        reasoning?: string;
      };

      // Reasoning-summary delta passthrough (OpenAI extension).
      if (delta.reasoning) {
        if (!reasoningStarted) {
          reasoningStarted = true;
          yield {
            type: 'response.output_item.added',
            output_index: outputIndex,
            item: {
              type: 'reasoning',
              id: `rs_${responseId}_${outputIndex}`,
              summary: [],
            },
            sequence_number: sequence++,
          } as unknown as ResponseStreamEvent;
        }
        accumulatedReasoning += delta.reasoning;
        yield {
          type: 'response.reasoning_summary_text.delta',
          item_id: `rs_${responseId}_${outputIndex}`,
          output_index: outputIndex,
          summary_index: 0,
          delta: delta.reasoning,
          sequence_number: sequence++,
        } as unknown as ResponseStreamEvent;
      }

      // Text content delta
      if (typeof delta.content === 'string' && delta.content.length > 0) {
        if (reasoningStarted && !messageStarted) {
          // Close out reasoning section before opening message.
          yield {
            type: 'response.reasoning_summary_text.done',
            item_id: `rs_${responseId}_${outputIndex}`,
            output_index: outputIndex,
            summary_index: 0,
            text: accumulatedReasoning,
            sequence_number: sequence++,
          } as unknown as ResponseStreamEvent;
          yield {
            type: 'response.output_item.done',
            output_index: outputIndex,
            item: {
              type: 'reasoning',
              id: `rs_${responseId}_${outputIndex}`,
              summary: [
                {
                  type: 'summary_text',
                  text: accumulatedReasoning,
                },
              ],
            },
            sequence_number: sequence++,
          } as unknown as ResponseStreamEvent;
          outputIndex++;
        }

        if (!messageStarted) {
          messageStarted = true;
          messageItemId = `msg_${responseId}_${outputIndex}`;
          yield {
            type: 'response.output_item.added',
            output_index: outputIndex,
            item: {
              type: 'message',
              id: messageItemId,
              status: 'in_progress',
              role: 'assistant',
              content: [],
            },
            sequence_number: sequence++,
          } as unknown as ResponseStreamEvent;
        }

        if (!textPartStarted) {
          textPartStarted = true;
          yield {
            type: 'response.content_part.added',
            item_id: messageItemId,
            output_index: outputIndex,
            content_index: 0,
            part: {
              type: 'output_text',
              text: '',
              annotations: [],
              logprobs: [],
            },
            sequence_number: sequence++,
          } as unknown as ResponseStreamEvent;
        }

        accumulatedText += delta.content;
        yield {
          type: 'response.output_text.delta',
          item_id: messageItemId,
          output_index: outputIndex,
          content_index: 0,
          delta: delta.content,
          sequence_number: sequence++,
          logprobs: [],
        } as unknown as ResponseStreamEvent;
      }

      // Tool calls
      if (delta.tool_calls && delta.tool_calls.length > 0) {
        // Close any in-flight message first.
        if (messageStarted) {
          if (textPartStarted) {
            yield {
              type: 'response.output_text.done',
              item_id: messageItemId,
              output_index: outputIndex,
              content_index: 0,
              text: accumulatedText,
              sequence_number: sequence++,
              logprobs: [],
            } as unknown as ResponseStreamEvent;
            yield {
              type: 'response.content_part.done',
              item_id: messageItemId,
              output_index: outputIndex,
              content_index: 0,
              part: {
                type: 'output_text',
                text: accumulatedText,
                annotations: [],
                logprobs: [],
              },
              sequence_number: sequence++,
            } as unknown as ResponseStreamEvent;
          }
          yield {
            type: 'response.output_item.done',
            output_index: outputIndex,
            item: {
              type: 'message',
              id: messageItemId,
              status: 'completed',
              role: 'assistant',
              content: [
                {
                  type: 'output_text',
                  text: accumulatedText,
                  annotations: [],
                  logprobs: [],
                },
              ],
            },
            sequence_number: sequence++,
          } as unknown as ResponseStreamEvent;
          messageStarted = false;
          textPartStarted = false;
          outputIndex++;
        }

        for (const tcDelta of delta.tool_calls) {
          const idx = tcDelta.index;
          let state = toolCalls.get(idx);
          if (!state) {
            state = {
              itemId: `fc_${responseId}_${idx}`,
              callId: tcDelta.id ?? `call_${idx}`,
              name: tcDelta.function?.name ?? '',
              argumentsAccum: '',
              outputIndex: outputIndex++,
              addedEmitted: false,
            };
            toolCalls.set(idx, state);
          } else {
            // Capture id/name when they appear in later chunks.
            if (tcDelta.id) state.callId = tcDelta.id;
            if (tcDelta.function?.name) state.name = tcDelta.function.name;
          }

          if (!state.addedEmitted && state.name) {
            state.addedEmitted = true;
            yield {
              type: 'response.output_item.added',
              output_index: state.outputIndex,
              item: {
                type: 'function_call',
                id: state.itemId,
                call_id: state.callId,
                name: state.name,
                arguments: '',
                status: 'in_progress',
              },
              sequence_number: sequence++,
            } as unknown as ResponseStreamEvent;
          }

          const argsChunk = tcDelta.function?.arguments;
          if (argsChunk) {
            state.argumentsAccum += argsChunk;
            yield {
              type: 'response.function_call_arguments.delta',
              item_id: state.itemId,
              output_index: state.outputIndex,
              delta: argsChunk,
              sequence_number: sequence++,
            } as unknown as ResponseStreamEvent;
          }
        }
      }

      if (choice.finish_reason) {
        finishReason = choice.finish_reason;
      }
    }

    // Close any remaining open items.
    if (messageStarted) {
      if (textPartStarted) {
        yield {
          type: 'response.output_text.done',
          item_id: messageItemId,
          output_index: outputIndex,
          content_index: 0,
          text: accumulatedText,
          sequence_number: sequence++,
          logprobs: [],
        } as unknown as ResponseStreamEvent;
        yield {
          type: 'response.content_part.done',
          item_id: messageItemId,
          output_index: outputIndex,
          content_index: 0,
          part: {
            type: 'output_text',
            text: accumulatedText,
            annotations: [],
            logprobs: [],
          },
          sequence_number: sequence++,
        } as unknown as ResponseStreamEvent;
      }
      yield {
        type: 'response.output_item.done',
        output_index: outputIndex,
        item: {
          type: 'message',
          id: messageItemId,
          status: 'completed',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: accumulatedText,
              annotations: [],
              logprobs: [],
            },
          ],
        },
        sequence_number: sequence++,
      } as unknown as ResponseStreamEvent;
    }

    // Close any in-flight tool calls.
    for (const state of toolCalls.values()) {
      yield {
        type: 'response.function_call_arguments.done',
        item_id: state.itemId,
        output_index: state.outputIndex,
        arguments: state.argumentsAccum,
        sequence_number: sequence++,
      } as unknown as ResponseStreamEvent;
      yield {
        type: 'response.output_item.done',
        output_index: state.outputIndex,
        item: {
          type: 'function_call',
          id: state.itemId,
          call_id: state.callId,
          name: state.name,
          arguments: state.argumentsAccum,
          status: 'completed',
        },
        sequence_number: sequence++,
      } as unknown as ResponseStreamEvent;
    }

    // Build the final response
    const finalOutput: ResponseOutputItem[] = [];
    if (accumulatedText) {
      finalOutput.push({
        type: 'message',
        id: messageItemId,
        status: 'completed',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: accumulatedText,
            annotations: [],
            logprobs: [],
          },
        ],
      } as unknown as ResponseOutputItem);
    }
    for (const state of toolCalls.values()) {
      finalOutput.push({
        type: 'function_call',
        id: state.itemId,
        call_id: state.callId,
        name: state.name,
        arguments: state.argumentsAccum,
        status: 'completed',
      } as unknown as ResponseOutputItem);
    }

    const completedResponse = {
      ...initialResponse,
      status: mapFinishReasonToStatus(finishReason ?? 'stop'),
      output: finalOutput,
      usage: usage
        ? {
            input_tokens: usage.prompt_tokens,
            output_tokens: usage.completion_tokens,
            total_tokens: usage.total_tokens,
            input_tokens_details: {
              cached_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
            },
            output_tokens_details: {
              reasoning_tokens:
                usage.completion_tokens_details?.reasoning_tokens ?? 0,
            },
          }
        : undefined,
    } as unknown as Response;

    yield {
      type: 'response.completed',
      response: completedResponse,
      sequence_number: sequence++,
    } as unknown as ResponseStreamEvent;
  } catch (err) {
    yield {
      type: 'response.failed',
      response: {
        ...initialResponse,
        status: 'failed',
        error: {
          code: 'server_error',
          message: err instanceof Error ? err.message : String(err),
        },
      } as unknown as Response,
      sequence_number: sequence++,
    } as unknown as ResponseStreamEvent;
    throw err;
  }
}

function makeStreamingShellResponse(
  id: string,
  createdAt: number,
  model: string
): Response {
  return {
    id,
    object: 'response',
    created_at: createdAt,
    status: 'in_progress',
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: null,
    model,
    output: [],
    parallel_tool_calls: true,
    previous_response_id: null,
    reasoning: null,
    store: false,
    temperature: null,
    text: { format: { type: 'text' } },
    tool_choice: 'auto',
    tools: [],
    top_p: null,
    truncation: 'disabled',
    usage: undefined,
    user: null,
    metadata: null,
  } as unknown as Response;
}
