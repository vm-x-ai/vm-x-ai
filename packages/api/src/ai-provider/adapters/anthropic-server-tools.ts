import { HttpStatus } from '@nestjs/common';
import type {
  ContentBlockParam as AnthropicContentBlockParam,
  ToolUnion as AnthropicToolUnion,
} from '@anthropic-ai/sdk/resources/messages';
import { CompletionError } from '../../gateway/completion.types';

/**
 * Per-target dispatch + lift-as-text helpers for Anthropic server
 * tools when the request is routed to a non-Anthropic-native provider.
 *
 *   classifyAnthropicServerTool(toolType) → family discriminator
 *     used by each converter to pick its provider-specific branch.
 *
 *   liftAnthropicServerToolBlockToText(block) → plain TextBlockParam
 *     for multi-turn history blocks that don't survive the cross-
 *     provider hop verbatim. Lifting (vs dropping) preserves the
 *     model's prior search / execution context as readable text.
 *
 *   raiseUnsupportedServerTool(types, target) → throws a CompletionError
 *     with a per-target code (`anthropic_server_tool_unsupported_on_<target>`).
 *     Customers can branch on the code without parsing the message.
 */

export type AnthropicServerToolFamily =
  | 'custom'
  | 'web_search'
  | 'web_fetch'
  | 'code_execution'
  | 'bash'
  | 'text_editor'
  | 'memory'
  | 'tool_search'
  | 'computer'
  | 'unknown';

/**
 * Classify a tool from `request.tools[]` by family. Custom function
 * tools (Anthropic `Tool`) always carry an `input_schema`; everything
 * else dispatches on the `type` discriminator. Versions inside a
 * family (e.g. `web_search_20250305` vs `web_search_20260209`) collapse
 * to the same family so converters don't have to chase Anthropic's
 * version-bump cadence.
 */
export function classifyAnthropicServerTool(
  tool: AnthropicToolUnion
): AnthropicServerToolFamily {
  if ('input_schema' in tool) return 'custom';
  const t = (tool as { type?: string }).type ?? '';
  if (t.startsWith('web_search')) return 'web_search';
  if (t.startsWith('web_fetch')) return 'web_fetch';
  if (t.startsWith('code_execution')) return 'code_execution';
  if (t.startsWith('bash')) return 'bash';
  if (t.startsWith('text_editor')) return 'text_editor';
  if (t.startsWith('memory')) return 'memory';
  if (t.startsWith('tool_search')) return 'tool_search';
  if (t.startsWith('computer')) return 'computer';
  return 'unknown';
}

export type AnthropicTargetProvider =
  | 'gemini'
  | 'bedrock_converse'
  | 'openai_responses';

/**
 * Raise a clean 400 listing every unsupported tool the caller sent.
 * Distinct per-target codes let dual-route fallbacks branch on the
 * cause without parsing the human-readable message.
 */
export function raiseUnsupportedServerTool(
  unsupportedTypes: readonly string[],
  target: AnthropicTargetProvider
): never {
  const list = unsupportedTypes.join(', ');
  const targetLabel =
    target === 'gemini'
      ? 'Gemini'
      : target === 'bedrock_converse'
      ? 'AWS Bedrock Converse'
      : 'OpenAI Responses';
  throw new CompletionError({
    message: `Anthropic server tool${
      unsupportedTypes.length > 1 ? 's' : ''
    } unsupported on ${targetLabel}: ${list}. Either remove the tool from the request or route to a provider that natively executes it (e.g. Anthropic native).`,
    rate: false,
    retryable: false,
    statusCode: HttpStatus.BAD_REQUEST,
    failureReason: `Anthropic server tool unsupported on ${targetLabel}`,
    openAICompatibleError: {
      code: `anthropic_server_tool_unsupported_on_${target}`,
      type: 'invalid_request_error',
    },
  });
}

// ─── History block lifting ─────────────────────────────────────────

/**
 * Server-tool block types that appear in `messages[].content` on
 * multi-turn requests. None of these have first-class equivalents on
 * Gemini, Converse, or OpenAI Responses — lifting them into plain
 * text preserves conversational continuity (the model sees the prior
 * tool invocation + result) at the cost of the structural type tag.
 */
export const SERVER_TOOL_HISTORY_BLOCK_TYPES = new Set<string>([
  'server_tool_use',
  'web_search_tool_result',
  'web_fetch_tool_result',
  'code_execution_tool_result',
  'bash_code_execution_tool_result',
  'text_editor_code_execution_tool_result',
  'tool_search_tool_result',
  'container_upload',
]);

export function isServerToolHistoryBlock(
  block: AnthropicContentBlockParam | { type?: string }
): boolean {
  const t = (block as { type?: string }).type;
  return typeof t === 'string' && SERVER_TOOL_HISTORY_BLOCK_TYPES.has(t);
}

/**
 * Render a single server-tool history block as plain text. Returns
 * `null` when the block carries no surface-able content (e.g. an
 * empty container_upload reference).
 */
export function liftAnthropicServerToolBlockToText(
  block: AnthropicContentBlockParam | Record<string, unknown>
): { type: 'text'; text: string } | null {
  const b = block as { type?: string; [k: string]: unknown };
  switch (b.type) {
    case 'server_tool_use': {
      const name = String(b.name ?? 'unknown');
      const input = safeJsonStringify(b.input);
      return {
        type: 'text',
        text: `[server_tool_use:${name}] ${input}`,
      };
    }
    case 'web_search_tool_result': {
      const content = b.content as
        | Array<{
            type?: string;
            title?: string;
            url?: string;
            page_age?: string | null;
          }>
        | { error_code?: string; type?: string }
        | undefined;
      if (Array.isArray(content)) {
        const lines = content
          .filter((r) => r.type === 'web_search_result')
          .map((r) => `- ${r.title ?? '(untitled)'} <${r.url ?? ''}>`);
        return {
          type: 'text',
          text: `[web_search_tool_result]\n${lines.join('\n')}`,
        };
      }
      if (content && typeof content === 'object' && 'error_code' in content) {
        return {
          type: 'text',
          text: `[web_search_tool_result:error] ${String(content.error_code)}`,
        };
      }
      return { type: 'text', text: '[web_search_tool_result]' };
    }
    case 'web_fetch_tool_result': {
      const c = b.content as
        | { type?: string; url?: string; error_code?: string }
        | undefined;
      if (c?.type === 'web_fetch_tool_result_error') {
        return {
          type: 'text',
          text: `[web_fetch_tool_result:error] ${String(c.error_code)}`,
        };
      }
      return {
        type: 'text',
        text: `[web_fetch_tool_result] ${String(c?.url ?? '')}`,
      };
    }
    case 'code_execution_tool_result':
    case 'bash_code_execution_tool_result':
    case 'text_editor_code_execution_tool_result': {
      const c = b.content as
        | {
            type?: string;
            stdout?: string;
            stderr?: string;
            return_code?: number;
            error_code?: string;
          }
        | undefined;
      const label = String(b.type);
      if (c?.type && c.type.endsWith('_error')) {
        return {
          type: 'text',
          text: `[${label}:error] ${String(c.error_code ?? 'unknown')}`,
        };
      }
      const parts: string[] = [`[${label}]`];
      if (typeof c?.return_code === 'number') {
        parts.push(`exit ${c.return_code}`);
      }
      if (c?.stdout) parts.push(`stdout:\n${c.stdout}`);
      if (c?.stderr) parts.push(`stderr:\n${c.stderr}`);
      return { type: 'text', text: parts.join('\n') };
    }
    case 'tool_search_tool_result': {
      const c = b.content as
        | {
            type?: string;
            tool_references?: Array<{ tool_name?: string }>;
            error_code?: string;
          }
        | undefined;
      if (c?.type === 'tool_search_tool_result_error') {
        return {
          type: 'text',
          text: `[tool_search_tool_result:error] ${String(c.error_code)}`,
        };
      }
      const names = (c?.tool_references ?? [])
        .map((r) => r.tool_name ?? '')
        .filter(Boolean);
      return {
        type: 'text',
        text: `[tool_search_tool_result] ${names.join(', ')}`,
      };
    }
    case 'container_upload': {
      const fileId = String(b.file_id ?? '');
      return {
        type: 'text',
        text: `[container_upload] file_id=${fileId}`,
      };
    }
    default:
      return null;
  }
}

function safeJsonStringify(input: unknown): string {
  try {
    return JSON.stringify(input ?? {});
  } catch {
    return '{}';
  }
}
