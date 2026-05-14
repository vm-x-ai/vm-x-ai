import { HttpStatus } from '@nestjs/common';
import type { Tool as SdkTool } from '@anthropic-ai/sdk/resources/messages';
import { CompletionError } from '../../gateway/completion.types';
import type {
  AnthropicMessagesRequest,
  AnthropicTextBlockParam,
  AnthropicTool,
} from '../../gateway/anthropic/anthropic.types';
import {
  type AnthropicPassthrough,
  type WithPassthrough,
} from '../passthrough.helpers';

/**
 * Shared Anthropic-side utilities used by every provider that speaks
 * Anthropic on the wire (`anthropic/*` for the native API,
 * `aws-bedrock-invoke/*` for InvokeModel, plus Responses-flavoured
 * paths that pivot through Anthropic). Pure functions only — provider
 * classes handle transport, this file handles cross-format fidelity:
 *
 *   - Passthrough envelope application (`applyPassthrough`)
 *   - Structured-output translation (`applyStructuredOutputFromSchema`)
 *   - Bedrock-Invoke wire-body adaptation
 *     (`canonicalAnthropicToBedrockInvoke`, `BedrockInvokeWireBody`)
 *   - Tool-input schema coercion (`coerceInputSchema`)
 *   - Model-feature gates (`assertClaudeModel`, `modelSupportsOutputConfig`)
 *
 * The Chat-Completions ↔ Anthropic converters
 * (`openAIRequestToAnthropic`, `anthropicResponseToChatCompletion`,
 * `anthropicStreamToChatCompletionChunks`) live in
 * `../anthropic/openai-chat-completion.provider.ts` next to the
 * provider class that owns them — Bedrock-Invoke imports them from
 * there.
 */

/**
 * Sentinel tool name used when translating OpenAI's structured-output
 * flag into Anthropic's tool-based pattern (the fallback path for
 * models that don't support `output_config.format` natively). The
 * request side adds a synthetic tool with this name and forces the
 * model to call it; the response side recognises the name and unwraps
 * the tool input into the caller's content.
 */
export const STRUCTURED_OUTPUT_TOOL_NAME = '__vmx_structured_output__';

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

/**
 * Coerce an unknown JSON-Schema-ish value into Anthropic's
 * `Tool.input_schema` (`{ type: 'object', ... }`). When the input is
 * already an object-typed schema we pass through verbatim; otherwise
 * we wrap it so the upstream sees a valid schema. Exported so the
 * Chat-Completion converter (in `openai-chat-completion.provider.ts`)
 * can use the same logic the structured-output helper here does.
 */
export function coerceInputSchema(raw: unknown): SdkTool['input_schema'] {
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

/**
 * Apply OpenAI's structured-output semantics (`response_format` /
 * `text.format = json_schema`) to the Anthropic body.
 *
 * On Claude 4.5+ this uses Anthropic's native `output_config.format`
 * (no beta header required, the model emits the JSON directly as text
 * content). On older models (Claude 3.x / 4.0 / 4.1) we fall back to
 * the synthetic-tool pattern: append `__vmx_structured_output__` whose
 * `input_schema` is the supplied schema and force the model to call
 * it; the response side unwraps the tool input back into
 * `message.content`. The synthetic tool gives the same strict-JSON
 * guarantee without needing a specific server-side feature.
 *
 * Used by both the Chat (`response_format: json_schema`) and Resp
 * (`text.format: json_schema`) converters.
 */
export function applyStructuredOutputFromSchema(
  body: AnthropicMessagesRequest,
  schema: Record<string, unknown>,
  name?: string,
  description?: string
): void {
  if (modelSupportsOutputConfig(body.model)) {
    // `name` / `description` are OpenAI-side annotations — Anthropic's
    // `JSONOutputFormat` carries only `schema` + `type`.
    void name;
    void description;
    body.output_config = {
      ...(body.output_config ?? {}),
      format: { type: 'json_schema', schema },
    };
    return;
  }
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

/**
 * Whether the given Claude model supports Anthropic's native
 * `output_config.format` (JSON-schema structured outputs). All Claude
 * 4.5+ models do; older 3.x / 4.0 / 4.1 models don't. Matches both
 * native Claude IDs (`claude-haiku-4-5`) and Bedrock-prefixed forms
 * (`us.anthropic.claude-haiku-4-5-20251001-v1:0`).
 */
export function modelSupportsOutputConfig(model: string): boolean {
  // Claude 4.5+ — opus-4-5/6/7, sonnet-4-5/6, haiku-4-5, and any
  // further-out version on the same lineage (regex stays open on the
  // minor so newer 4.x releases work without a code update).
  if (/claude-(?:opus|sonnet|haiku)-4-(?:[5-9]|\d{2,})\b/i.test(model)) {
    return true;
  }
  if (/claude-mythos-preview/i.test(model)) return true;
  return false;
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
  // Anthropic-only knobs the canonical converter now captures.
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
    // Bedrock-Invoke's Anthropic body expects `anthropic_beta`, not
    // the `betas` field name the canonical Anthropic-API shape uses.
    // Strip `betas` so the spread below doesn't leak it, then re-emit
    // under the correct key.
    betas,
    // Bedrock-Invoke rejects these Anthropic-native fields with 400.
    // The InvokeModel API doesn't proxy them through to Anthropic the
    // way the direct API does. Strip silently — callers that need them
    // should target the AnthropicProvider directly.
    mcp_servers: _mcp_servers,
    container: _container,
    context_management: _context_management,
    inference_geo: _inference_geo,
    ...rest
  } = canonical as AnthropicMessagesRequest & {
    vmx?: unknown;
    __vmx_passthrough?: unknown;
  };
  void _model;
  void _stream;
  void _vmx;
  void _envelope;
  void _mcp_servers;
  void _container;
  void _context_management;
  void _inference_geo;
  return {
    ...rest,
    anthropic_version: anthropicVersion,
    ...(betas && betas.length > 0 ? { anthropic_beta: betas } : {}),
  } as BedrockInvokeWireBody;
}

/**
 * Validate that a request is targeting a Claude model. Used by
 * providers that only speak the Anthropic Messages wire format —
 * native `AnthropicProvider` (the model ID *is* the Claude name,
 * e.g. `claude-haiku-4-5`) and `AWSBedrockInvokeProvider` (Bedrock
 * cross-region IDs like `us.anthropic.claude-haiku-4-5-20251001-v1:0`,
 * `eu.anthropic.claude-…`, plain `anthropic.claude-…`).
 *
 * Both wire formats always carry `claude` somewhere in the model id.
 * Earlier versions of this gate accepted anything matching
 * `/anthropic/i` even without `claude`, which let a malformed config
 * targeting a hypothetical non-Claude Anthropic model slip through —
 * we require `claude` in the id now so non-Claude families (Titan,
 * Llama, Mistral, Nova, DeepSeek, …) reliably hit a 400 here instead
 * of confusing the upstream with an Anthropic-shape payload.
 */
export function assertClaudeModel(model: string): void {
  if (!/claude/i.test(model)) {
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

/** Re-export so providers can import everything from the adapter. */
export type { WithPassthrough };
