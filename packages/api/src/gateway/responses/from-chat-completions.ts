import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionContentPart,
  ChatCompletionContentPartImage,
  ChatCompletionContentPartText,
  ChatCompletionCreateParams,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
  ChatCompletionToolChoiceOption,
  ChatCompletionToolMessageParam,
  ChatCompletionUserMessageParam,
} from 'openai/resources/index.js';
import type {
  ResponseCreateParams,
  ResponseInputContent,
  ResponseInputItem,
  ResponseTextConfig,
  Tool as ResponsesTool,
} from 'openai/resources/responses/responses.js';

/**
 * Convert a Chat Completions request body into a Responses request body.
 *
 * Used by the `/chat/completions` controller to normalize inbound traffic
 * to the gateway's canonical Responses shape before routing/gating/audit.
 * The original Chat Completions body is threaded through as
 * `originalGatewayRequest` so the dispatch path can still emit the
 * client's expected wire shape on the way out.
 *
 * Mapping summary:
 *   model              → model
 *   messages[system].content → instructions (concatenated when multiple)
 *   messages[user]     → input[].message(role:user, content:input_*)
 *   messages[assistant] (text + tool_calls)
 *                      → input[].message(role:assistant, content:output_text)
 *                      + input[].function_call (one per tool_call)
 *   messages[tool]     → input[].function_call_output (call_id, output)
 *   tools[].function   → tools[] (type:'function', flat shape)
 *   tool_choice        → tool_choice
 *   response_format    → text.format
 *   temperature/top_p  → temperature/top_p
 *   max_completion_tokens / max_tokens → max_output_tokens
 *   stream             → stream
 *   parallel_tool_calls → parallel_tool_calls
 *   metadata           → metadata
 *   service_tier       → service_tier
 *   reasoning_effort   → reasoning.effort
 *   prompt_cache_key   → prompt_cache_key
 *   __vmx_passthrough  → __vmx_passthrough (verbatim)
 *   vmx                → vmx (verbatim)
 *
 * Drops on the floor (no Responses equivalent):
 *   stop               (Responses has no stop sequences)
 *   logprobs / logit_bias / n / seed / top_logprobs / web_search_options /
 *   audio / modalities / prediction (Chat-Completions-only or model-specific).
 *   These survive only if the dispatch path is Chat-Completions-native.
 */
export function chatCompletionsToResponsesRequest(
  payload: ChatCompletionCreateParams
): ResponseCreateParams {
  const messages = payload.messages ?? [];

  // Pull every system message into a single `instructions` string.
  // Anthropic's `system` array, OpenAI Responses' `instructions`, and
  // the chat-completions `system` role are all morally equivalent
  // top-of-conversation primers; concatenate when callers send several.
  const systemTexts: string[] = [];
  const nonSystemMessages: ChatCompletionMessageParam[] = [];
  for (const msg of messages) {
    if (msg.role === 'system' || msg.role === 'developer') {
      const text = stringifyMessageContent(msg.content);
      if (text) systemTexts.push(text);
      continue;
    }
    nonSystemMessages.push(msg);
  }

  const input: ResponseInputItem[] = [];
  for (const msg of nonSystemMessages) {
    appendChatMessage(input, msg);
  }

  const out: ResponseCreateParams = {
    model: payload.model,
    input,
  } as ResponseCreateParams;

  if (systemTexts.length > 0) {
    out.instructions = systemTexts.join('\n\n');
  }

  if (typeof payload.temperature === 'number') {
    out.temperature = payload.temperature;
  }
  if (typeof payload.top_p === 'number') {
    out.top_p = payload.top_p;
  }
  // OpenAI deprecated `max_tokens` in favor of `max_completion_tokens`;
  // accept either on the way in and emit `max_output_tokens` on the way out.
  const maxTokens =
    (payload as { max_completion_tokens?: number | null })
      .max_completion_tokens ??
    (payload as { max_tokens?: number | null }).max_tokens ??
    null;
  if (typeof maxTokens === 'number') {
    out.max_output_tokens = maxTokens;
  }
  if (payload.stream) {
    (out as ResponseCreateParams & { stream?: boolean }).stream = true;
  }
  if (payload.parallel_tool_calls === false) {
    out.parallel_tool_calls = false;
  }
  if (payload.metadata) {
    out.metadata = payload.metadata;
  }
  const serviceTier = (payload as { service_tier?: string }).service_tier;
  if (serviceTier) {
    (
      out as ResponseCreateParams & {
        service_tier?: ResponseCreateParams['service_tier'];
      }
    ).service_tier = serviceTier as ResponseCreateParams['service_tier'];
  }
  if ((payload as { prompt_cache_key?: string }).prompt_cache_key) {
    (
      out as ResponseCreateParams & { prompt_cache_key?: string }
    ).prompt_cache_key = (
      payload as { prompt_cache_key?: string }
    ).prompt_cache_key;
  }

  // Chat-Completions `reasoning_effort` is the same enum
  // (`'low' | 'medium' | 'high'`) as `responses.reasoning.effort`.
  const reasoningEffort = (
    payload as ChatCompletionCreateParams & { reasoning_effort?: string }
  ).reasoning_effort;
  if (reasoningEffort) {
    out.reasoning = {
      effort: reasoningEffort as 'low' | 'medium' | 'high',
    } as ResponseCreateParams['reasoning'];
  }

  const tools = mapTools(payload.tools);
  if (tools && tools.length > 0) {
    out.tools = tools;
  }
  const toolChoice = mapToolChoice(payload.tool_choice);
  if (toolChoice !== undefined) {
    out.tool_choice = toolChoice;
  }

  const textFormat = mapResponseFormatToText(payload.response_format);
  if (textFormat) {
    out.text = textFormat;
  }

  // Carry vmx + __vmx_passthrough envelopes verbatim. CompletionService
  // reads `vmx` for correlationId/metadata/secondaryModelIndex/
  // resourceConfigOverrides; `__vmx_passthrough` carries cross-format
  // fields that providers re-apply at dispatch time.
  const vmx = (payload as ChatCompletionCreateParams & { vmx?: unknown }).vmx;
  if (vmx !== undefined) {
    (out as ResponseCreateParams & { vmx?: unknown }).vmx = vmx;
  }
  const passthrough = (
    payload as ChatCompletionCreateParams & { __vmx_passthrough?: unknown }
  ).__vmx_passthrough;
  if (passthrough !== undefined) {
    (
      out as ResponseCreateParams & { __vmx_passthrough?: unknown }
    ).__vmx_passthrough = passthrough;
  }

  return out;
}

function appendChatMessage(
  input: ResponseInputItem[],
  msg: ChatCompletionMessageParam
): void {
  if (msg.role === 'user') {
    const userMsg = msg as ChatCompletionUserMessageParam;
    input.push({
      type: 'message',
      role: 'user',
      content: mapUserContent(userMsg.content),
    } as ResponseInputItem);
    return;
  }

  if (msg.role === 'assistant') {
    const asst = msg as ChatCompletionAssistantMessageParam;
    // Cast through unknown — chat-completions assistant content can
    // be `string | (ChatCompletionContentPartText | ChatCompletionContentPartRefusal)[]`
    // which is a subset of the `ChatCompletionContentPart[]` shape
    // `stringifyMessageContent` accepts, but TS won't narrow the
    // refusal/text union for us.
    const text = stringifyMessageContent(
      asst.content as unknown as
        | string
        | ChatCompletionContentPart[]
        | null
        | undefined
    );
    // Emit the assistant text as a `message` item only when there's
    // something to say. Tool-only assistant turns (no text, just
    // tool_calls) skip the empty message and emit only function_call
    // items so the input[] sequence reads cleanly.
    if (text) {
      input.push({
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text,
          } as unknown as ResponseInputContent,
        ],
      } as ResponseInputItem);
    }
    for (const call of asst.tool_calls ?? []) {
      const fnCall = call as ChatCompletionMessageToolCall;
      // Only function-type tool calls have a Responses equivalent;
      // Anthropic-shape custom tools come through a different code path.
      if (fnCall.type === 'function') {
        input.push({
          type: 'function_call',
          call_id: fnCall.id,
          name: fnCall.function.name,
          arguments: fnCall.function.arguments,
        } as ResponseInputItem);
      }
    }
    return;
  }

  if (msg.role === 'tool') {
    const tool = msg as ChatCompletionToolMessageParam;
    input.push({
      type: 'function_call_output',
      call_id: tool.tool_call_id,
      output: stringifyMessageContent(tool.content),
    } as ResponseInputItem);
    return;
  }

  // function role is the deprecated single-function-call form; map it
  // best-effort onto a function_call_output with no call_id (clients on
  // the legacy shape don't address by id).
  if (msg.role === 'function') {
    input.push({
      type: 'function_call_output',
      call_id: '',
      output: stringifyMessageContent(
        (msg as { content?: unknown }).content as never
      ),
    } as ResponseInputItem);
  }
}

function mapUserContent(
  content: ChatCompletionUserMessageParam['content']
): string | ResponseInputContent[] {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  const parts: ResponseInputContent[] = [];
  for (const part of content as ChatCompletionContentPart[]) {
    if (part.type === 'text') {
      const t = part as ChatCompletionContentPartText;
      parts.push({ type: 'input_text', text: t.text } as ResponseInputContent);
      continue;
    }
    if (part.type === 'image_url') {
      const img = part as ChatCompletionContentPartImage;
      const detail = img.image_url?.detail;
      parts.push({
        type: 'input_image',
        image_url: img.image_url?.url,
        ...(detail ? { detail } : {}),
      } as ResponseInputContent);
      continue;
    }
    if (part.type === 'input_audio') {
      // No native Responses equivalent today — skip rather than 400.
      // The dispatcher reads `originalGatewayRequest.body` for
      // chat-completions-native callers, so audio still reaches the
      // upstream when it's the only path that can carry it.
      continue;
    }
    if (part.type === 'file') {
      // Same reasoning: keep dispatch native-fallback friendly.
      continue;
    }
  }
  return parts;
}

function stringifyMessageContent(
  content: string | ChatCompletionContentPart[] | null | undefined
): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((p) => p.type === 'text')
    .map((p) => (p as ChatCompletionContentPartText).text)
    .join('\n');
}

function mapTools(
  tools: ChatCompletionTool[] | null | undefined
): ResponsesTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  const out: ResponsesTool[] = [];
  for (const tool of tools) {
    if (tool.type !== 'function') continue;
    const fn = tool.function;
    const def: ResponsesTool & {
      name: string;
      description?: string;
      parameters: Record<string, unknown>;
      strict?: boolean | null;
    } = {
      type: 'function',
      name: fn.name,
      description: fn.description,
      parameters: (fn.parameters ?? {}) as Record<string, unknown>,
      strict: null,
    };
    if (fn.strict != null) def.strict = fn.strict;
    out.push(def);
  }
  return out;
}

function mapToolChoice(
  choice: ChatCompletionToolChoiceOption | null | undefined
): ResponseCreateParams['tool_choice'] | undefined {
  if (choice == null) return undefined;
  if (choice === 'auto' || choice === 'none' || choice === 'required') {
    return choice;
  }
  if (typeof choice === 'object' && choice.type === 'function') {
    return {
      type: 'function',
      name: choice.function.name,
    } as ResponseCreateParams['tool_choice'];
  }
  return undefined;
}

function mapResponseFormatToText(
  fmt: ChatCompletionCreateParams['response_format'] | undefined
): ResponseTextConfig | undefined {
  if (!fmt) return undefined;
  if (fmt.type === 'text') {
    return { format: { type: 'text' } } as ResponseTextConfig;
  }
  if (fmt.type === 'json_object') {
    return { format: { type: 'json_object' } } as ResponseTextConfig;
  }
  if (fmt.type === 'json_schema') {
    const schema = fmt.json_schema;
    return {
      format: {
        type: 'json_schema',
        name: schema.name,
        description: schema.description,
        schema: schema.schema,
        strict: schema.strict ?? null,
      },
    } as ResponseTextConfig;
  }
  return undefined;
}
