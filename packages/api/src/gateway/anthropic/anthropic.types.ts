/**
 * Canonical Anthropic Messages API types — re-exported from
 * `@anthropic-ai/sdk` so the gateway always validates and converts
 * against the upstream's authoritative shapes (no drift from
 * hand-rolled mirrors).
 *
 * The aliases below preserve the historical names the rest of the
 * codebase imports (`AnthropicMessagesRequest`, `AnthropicTextBlock`,
 * etc.). Two adjustments to keep the gateway permissive at the edge:
 *
 *  - `AnthropicMessagesRequest.model` is widened to `string` (the
 *    SDK's literal-union `Model` type would reject any model the SDK
 *    bundle hasn't explicitly enumerated, but VM-X must accept
 *    custom Bedrock model IDs, region-prefixed IDs, etc.)
 *  - `AnthropicMessagesResponse.stop_reason` keeps the SDK's full
 *    union (`pause_turn`, `refusal` included). The historical
 *    `AnthropicStopReason` alias was a strict subset; widening it
 *    surfaces the missing variants in the response converter.
 */

import type {
  CacheControlEphemeral,
  CacheCreation,
  ContentBlock,
  ContentBlockParam,
  Message,
  MessageCreateParamsBase,
  MessageParam,
  Metadata,
  RefusalStopDetails,
  ServerToolUsage,
  StopReason,
  TextBlockParam,
  ThinkingConfigParam,
  Tool as SdkTool,
  ToolChoice,
  ToolUnion,
  Usage,
} from '@anthropic-ai/sdk/resources/messages';

// ─── Block-level types (request side) ──────────────────────────────────────

export type AnthropicContentBlockParam = ContentBlockParam;
export type AnthropicContentBlock = ContentBlock;

// Back-compat aliases. These now resolve to the SDK's full union
// shape, so call sites that narrow on `block.type === 'text'` etc.
// keep working but new variants (`thinking`, `server_tool_use`,
// `web_search_tool_result`, …) are visible to the type system.
export type AnthropicTextBlock = Extract<ContentBlock, { type: 'text' }>;
export type AnthropicTextBlockParam = TextBlockParam;
export type AnthropicImageBlock = Extract<ContentBlockParam, { type: 'image' }>;
export type AnthropicToolUseBlock = Extract<ContentBlock, { type: 'tool_use' }>;
export type AnthropicToolResultBlock = Extract<
  ContentBlockParam,
  { type: 'tool_result' }
>;
export type AnthropicThinkingBlock = Extract<
  ContentBlock,
  { type: 'thinking' }
>;

// ─── Message-level ─────────────────────────────────────────────────────────

export type AnthropicMessage = MessageParam;

// ─── Tool definitions (request side) ───────────────────────────────────────

export type AnthropicTool = SdkTool;
export type AnthropicToolUnion = ToolUnion;
export type AnthropicToolChoice = ToolChoice;

// ─── Top-level request ─────────────────────────────────────────────────────

/**
 * Client-facing Anthropic Messages request shape.
 *
 * Identical to the SDK's `MessageCreateParamsBase` except `model` is
 * widened so VM-X can accept custom / regional / Bedrock model IDs
 * the SDK literal-union doesn't enumerate.
 */
export type AnthropicMessagesRequest = Omit<
  MessageCreateParamsBase,
  'model'
> & {
  model: string;
  /**
   * Beta feature opt-ins — mirrors the `anthropic-beta` HTTP header
   * (interleaved-thinking-2025-05-14, compact-2026-01-12,
   * files-api-2025-04-14, search-results-2025-06-09, etc.). Forwarded
   * verbatim by native-Anthropic / Bedrock-Invoke; ignored by
   * OpenAI-compat providers.
   */
  betas?: string[];
  /**
   * URL-based MCP servers. Forwarded verbatim by native-Anthropic /
   * Bedrock-Invoke (Anthropic API gates this behind the
   * mcp-client-2025-11-20 beta).
   */
  mcp_servers?: Array<{
    type: 'url';
    url: string;
    name: string;
    authorization_token?: string;
  }>;
  /**
   * Server-side context management — compaction / clear_tool_uses /
   * clear_thinking edits.
   */
  context_management?: {
    edits?: Array<{ type: string; [k: string]: unknown }>;
  };
  /**
   * Inference geography — `'us'` pins all calls to US data centres;
   * `'global'` (default) routes anywhere available.
   */
  inference_geo?: 'us' | 'global';
};

// Re-exports for the new top-level features so converters can pull
// them from one place rather than reaching into the SDK directly.
export type AnthropicCacheControl = CacheControlEphemeral;
export type AnthropicThinkingConfig = ThinkingConfigParam;
export type AnthropicMetadata = Metadata;

// ─── Response side ─────────────────────────────────────────────────────────

export type AnthropicStopReason = StopReason;
export type AnthropicRefusalStopDetails = RefusalStopDetails;

export type AnthropicUsage = Usage;
export type AnthropicCacheCreation = CacheCreation;
export type AnthropicServerToolUsage = ServerToolUsage;

/**
 * Client-facing Anthropic Messages response shape.
 *
 * Mirrors the SDK's `Message` type so the response converter has
 * access to the full surface — `stop_reason` includes `pause_turn`
 * and `refusal`, `usage` includes `cache_creation` breakdown +
 * `server_tool_use` counts, content can include `thinking` /
 * server-tool-result blocks etc.
 */
export type AnthropicMessagesResponse = Message;
