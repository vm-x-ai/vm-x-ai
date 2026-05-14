'use client';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';

/**
 * "Pretty" rendering for the audit drawer's request/response payloads.
 *
 * Recognises the three shapes VM-X stores today (OpenAI Chat
 * Completions, Anthropic Messages, OpenAI Responses) and renders the
 * messages / output as readable conversation turns. Anything we don't
 * recognise — non-completion endpoints, unusual provider shapes —
 * falls back to a `<pre>` JSON dump so debugging remains possible.
 *
 * Goal: a developer scanning an audit row can see the user prompt and
 * assistant reply at a glance without expanding the raw JSON tree.
 */

export type PrettyMessagesProps = {
  payload: unknown;
  /** Whether this payload is a request (input messages) or a response. */
  kind: 'request' | 'response';
};

export default function PrettyMessages({ payload, kind }: PrettyMessagesProps) {
  if (payload == null) {
    return (
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ fontStyle: 'italic' }}
      >
        (empty)
      </Typography>
    );
  }

  // The audit row stores the response as `responseData: Json[]` —
  // either a single non-streaming object or every chunk of the stream.
  // Normalise to one logical object for the pretty path.
  const target = Array.isArray(payload)
    ? coalesceResponseArray(payload)
    : payload;

  const turns = extractTurns(target, kind);
  if (turns) {
    return (
      <Stack spacing={1.5}>
        {turns.map((t, i) => (
          <Turn key={i} turn={t} />
        ))}
      </Stack>
    );
  }

  return <RawJson value={payload} />;
}

// ─── Shape detection ─────────────────────────────────────────────────────

type ToolCallDescriptor = {
  name: string;
  arguments: string;
  /** True when `arguments` is a non-empty string that fails JSON.parse. */
  invalid?: boolean;
};

type RoleTurn = {
  role: string;
  content: string;
  toolCalls?: ToolCallDescriptor[];
  toolResults?: Array<{ id?: string; content: string }>;
  meta?: Record<string, string | number | undefined>;
};

function extractTurns(
  value: unknown,
  kind: 'request' | 'response'
): RoleTurn[] | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;

  if (kind === 'request') {
    // Anthropic Messages and OpenAI Chat Completions both have a
    // top-level `messages` array. To keep Anthropic's `system` field
    // (which lives at the top level rather than as a `system`-role
    // message), check for it FIRST and prepend it as a system turn —
    // otherwise the previous OpenAI-only branch would silently drop
    // it before the Anthropic branch could see it.
    if (Array.isArray(obj.messages)) {
      const turns: RoleTurn[] = [];
      // Anthropic's `system` accepts both a plain string and an array
      // of text blocks (`{ type: 'text', text: '...' }`); run it
      // through `stringifyContent` so both forms render. Plain string
      // input passes through unchanged.
      if (obj.system != null) {
        const systemText = stringifyContent(obj.system);
        if (systemText) {
          turns.push({ role: 'system', content: systemText });
        }
      }
      for (const m of obj.messages as unknown[]) {
        const t = toRoleTurn(m);
        if (t) turns.push(t);
      }
      return turns.length ? turns : null;
    }
    // OpenAI Responses API: { input: string | array, instructions? }
    if (typeof obj.input === 'string' || Array.isArray(obj.input)) {
      const turns: RoleTurn[] = [];
      if (typeof obj.instructions === 'string' && obj.instructions) {
        turns.push({ role: 'system', content: obj.instructions });
      }
      if (typeof obj.input === 'string') {
        turns.push({ role: 'user', content: obj.input });
      } else {
        for (const item of obj.input as unknown[]) {
          const t = toRoleTurn(item);
          if (t) turns.push(t);
        }
      }
      return turns.length ? turns : null;
    }
    return null;
  }

  // Response side: chat completions, responses-api, anthropic.
  // Chat Completions: { choices: [{message: {role, content, tool_calls}}], usage }
  if (Array.isArray(obj.choices)) {
    const choice = (obj.choices as unknown[])[0] as
      | Record<string, unknown>
      | undefined;
    const message = choice?.message as Record<string, unknown> | undefined;
    if (message) {
      const turn = toRoleTurn(message);
      if (turn) {
        const finishReason =
          typeof choice?.finish_reason === 'string'
            ? choice.finish_reason
            : undefined;
        if (finishReason) {
          turn.meta = { ...(turn.meta ?? {}), finishReason };
        }
        return [turn];
      }
    }
  }
  // OpenAI Responses API: { output: [{type: 'message', content: [{text}]}], output_text? }
  if (Array.isArray(obj.output)) {
    const turns: RoleTurn[] = [];
    for (const item of obj.output as unknown[]) {
      const t = toRoleTurn(item);
      if (t) turns.push(t);
    }
    if (turns.length) return turns;
  }
  if (typeof obj.output_text === 'string') {
    return [{ role: 'assistant', content: obj.output_text }];
  }
  // Anthropic Messages response: { role: 'assistant', content: [{type: 'text', text}] }
  if (obj.role === 'assistant' && Array.isArray(obj.content)) {
    const turns: RoleTurn[] = [];
    // Anthropic's `thinking` blocks live inside the assistant
    // message's `content[]`. Lift them into a sibling reasoning turn
    // so the audit drawer surfaces the model's thinking alongside the
    // reply rather than dropping it on the floor (walkContent has no
    // text slot for them).
    const reasoning = extractThinkingFromContent(obj.content as unknown[]);
    if (reasoning) {
      turns.push({ role: 'reasoning', content: reasoning });
    }
    const t = toRoleTurn(obj);
    if (t) turns.push(t);
    return turns.length ? turns : null;
  }
  return null;
}

function extractThinkingFromContent(content: unknown[]): string | null {
  const out: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const p = part as Record<string, unknown>;
    if (p.type === 'thinking' && typeof p.thinking === 'string') {
      out.push(p.thinking);
    }
  }
  return out.length > 0 ? out.join('\n') : null;
}

function toRoleTurn(item: unknown): RoleTurn | null {
  if (!item || typeof item !== 'object') return null;
  const m = item as Record<string, unknown>;

  // Responses-API output items: `function_call` (tool invocation) and
  // `function_call_output` (the synthetic result the next turn sends
  // back) have no `role`. Synthesise an assistant / tool turn so the
  // pretty view still surfaces them with full args/result text.
  if (m.type === 'function_call') {
    return {
      role: 'assistant',
      content: '',
      toolCalls: [extractToolCall(m)],
    };
  }
  if (m.type === 'function_call_output') {
    const output =
      typeof m.output === 'string'
        ? m.output
        : JSON.stringify(m.output ?? '', null, 2);
    return { role: 'tool', content: output };
  }

  // OpenAI Responses-API `reasoning` items carry the model's
  // (optionally summarised) thinking. Render as a `reasoning` turn so
  // the audit drawer surfaces it alongside the assistant reply
  // instead of dropping it on the floor.
  if (m.type === 'reasoning') {
    const summary = Array.isArray(m.summary)
      ? (m.summary as Array<Record<string, unknown>>)
          .map((s) => (typeof s.text === 'string' ? s.text : ''))
          .filter(Boolean)
          .join('\n')
      : '';
    if (!summary) return null;
    return { role: 'reasoning', content: summary };
  }

  // Anthropic Messages `thinking` content blocks (non-Responses
  // path) — same treatment as the Responses `reasoning` item above.
  if (m.type === 'thinking' && typeof m.thinking === 'string') {
    if (!m.thinking) return null;
    return { role: 'reasoning', content: m.thinking };
  }

  const role = typeof m.role === 'string' ? m.role : 'message';

  // Walk content blocks/parts and split structured items
  // (`tool_use` / `tool_result`) out of the text stream so the
  // arguments/result render as their own structured rows. Plain
  // strings and OpenAI Chat Completions text-only content fall
  // through as a single text body.
  const {
    text: content,
    toolCalls: contentToolCalls,
    toolResults,
  } = walkContent(m.content);

  // OpenAI Chat Completions surfaces tool calls at the message level.
  const messageToolCalls = Array.isArray(m.tool_calls)
    ? (m.tool_calls as unknown[]).map(extractToolCall)
    : [];

  const toolCalls = [...messageToolCalls, ...contentToolCalls];

  // A turn is empty if there's no text AND no structured tool data —
  // skip it so the pretty view doesn't show empty cards.
  if (!content && toolCalls.length === 0 && toolResults.length === 0) {
    return null;
  }
  return {
    role,
    content,
    toolCalls: toolCalls.length ? toolCalls : undefined,
    toolResults: toolResults.length ? toolResults : undefined,
  };
}

/**
 * Extract a `{name, arguments}` tool-call descriptor from any of the
 * three shapes we see:
 * - OpenAI Chat Completions: `{ function: { name, arguments } }`
 * - OpenAI Responses API:    `{ type: 'function_call', name, arguments }`
 * - Anthropic content block:  `{ type: 'tool_use', name, input }`
 */
function extractToolCall(value: unknown): ToolCallDescriptor {
  const v = value as Record<string, unknown> | null | undefined;
  if (!v) return { name: '?', arguments: '' };

  const fn = v.function as Record<string, unknown> | undefined;
  const name =
    (typeof v.name === 'string' && v.name) ||
    (typeof fn?.name === 'string' && fn.name) ||
    '?';

  // Prefer a NON-EMPTY string over an empty one — chunks during a
  // streaming tool call carry partial `arguments` that may begin
  // with `''`, then accumulate. If we picked the empty value first
  // we'd drop the populated `fn.arguments` / `v.input` fallbacks
  // that come from a different shape (Anthropic `tool_use.input`).
  const isUsefulString = (x: unknown): x is string =>
    typeof x === 'string' && x.length > 0;
  const rawArgs = isUsefulString(v.arguments)
    ? v.arguments
    : typeof v.arguments === 'object' && v.arguments != null
    ? v.arguments
    : isUsefulString(fn?.arguments)
    ? fn.arguments
    : typeof fn?.arguments === 'object' && fn?.arguments != null
    ? fn.arguments
    : v.input;

  let args: string;
  let invalid = false;
  if (typeof rawArgs === 'string') {
    args = rawArgs;
    // OpenAI tool-call `arguments` is always a JSON-encoded string.
    // If parsing fails the model produced malformed JSON and the
    // tool runner cannot dispatch it — flag visually so debugging
    // an audit row doesn't require an external linter.
    if (args.length > 0) {
      try {
        JSON.parse(args);
      } catch {
        invalid = true;
      }
    }
  } else if (rawArgs == null) {
    args = '';
  } else {
    args = JSON.stringify(rawArgs, null, 2);
  }

  return invalid
    ? { name, arguments: args, invalid }
    : { name, arguments: args };
}

/**
 * Walk an OpenAI / Anthropic / Responses content array and split it
 * into a text body, a list of tool-call blocks, and a list of
 * tool-result blocks. The previous implementation collapsed
 * everything into a single string with `[tool ${name}]` placeholders,
 * which dropped tool arguments and result text.
 */
function walkContent(value: unknown): {
  text: string;
  toolCalls: ToolCallDescriptor[];
  toolResults: Array<{ id?: string; content: string }>;
} {
  const toolCalls: ToolCallDescriptor[] = [];
  const toolResults: Array<{ id?: string; content: string }> = [];

  if (value == null) return { text: '', toolCalls, toolResults };
  if (typeof value === 'string') return { text: value, toolCalls, toolResults };

  if (Array.isArray(value)) {
    const textParts: string[] = [];
    for (const part of value as unknown[]) {
      if (typeof part === 'string') {
        textParts.push(part);
        continue;
      }
      if (!part || typeof part !== 'object') continue;
      const p = part as Record<string, unknown>;

      if (typeof p.text === 'string') {
        textParts.push(p.text);
        continue;
      }
      if (
        p.type === 'image' ||
        p.type === 'input_image' ||
        p.type === 'image_url'
      ) {
        textParts.push('[image]');
        continue;
      }
      if (p.type === 'tool_use' || p.type === 'function_call') {
        toolCalls.push(extractToolCall(p));
        continue;
      }
      if (p.type === 'tool_result' || p.type === 'function_call_output') {
        const resultContent =
          typeof p.content === 'string'
            ? p.content
            : Array.isArray(p.content)
            ? walkContent(p.content).text
            : typeof p.output === 'string'
            ? p.output
            : JSON.stringify(p.content ?? p.output ?? '', null, 2);
        const id =
          typeof p.tool_use_id === 'string'
            ? p.tool_use_id
            : typeof p.id === 'string'
            ? p.id
            : undefined;
        toolResults.push({ id, content: resultContent });
        continue;
      }
    }
    // Join with `\n` rather than `''` so adjacent text blocks
    // (e.g. multi-paragraph Anthropic responses split into separate
    // `{type:'text'}` entries) don't visually run together.
    return { text: textParts.join('\n'), toolCalls, toolResults };
  }

  return {
    text: JSON.stringify(value),
    toolCalls,
    toolResults,
  };
}

/**
 * Public adapter retained for legacy callers expecting a single
 * string. Loses tool-call info; prefer `walkContent` in new code.
 */
function stringifyContent(value: unknown): string {
  return walkContent(value).text;
}

// Multi-chunk responses (streaming) get coalesced — concatenate every
// `delta.content` into a single non-streaming-shaped object so the
// pretty path renders one assistant turn.
function coalesceResponseArray(arr: unknown[]): unknown {
  if (arr.length === 0) return null;
  const first = arr[0];
  if (!first || typeof first !== 'object')
    return arr.length === 1 ? first : arr;

  // OpenAI Responses-API streaming events: every chunk has
  // `type: 'response.*'`. Coalesce by either picking the final
  // `response.completed` event (which carries the fully assembled
  // `response.output[]` + `usage`) or, as a fallback, accumulating
  // `response.output_text.delta` / `response.reasoning_summary_text.delta`
  // events into a synthetic `output[]` shape `extractTurns` already
  // understands.
  const firstType =
    typeof (first as Record<string, unknown>).type === 'string'
      ? ((first as Record<string, unknown>).type as string)
      : null;
  if (firstType && firstType.startsWith('response.')) {
    return coalesceResponsesStream(arr as Array<Record<string, unknown>>);
  }

  // OpenAI ChatCompletionChunk[] -> ChatCompletion-shape
  const obj = first as Record<string, unknown>;
  if (Array.isArray(obj.choices)) {
    let textBuf = '';
    let role: string | undefined;
    const toolBuf = new Map<number, { name: string; arguments: string }>();
    let finishReason: string | undefined;
    for (const chunk of arr as Array<Record<string, unknown>>) {
      const choice = (chunk.choices as Array<Record<string, unknown>>)?.[0];
      const delta = choice?.delta as Record<string, unknown> | undefined;
      const message = choice?.message as Record<string, unknown> | undefined;
      if (typeof delta?.content === 'string') textBuf += delta.content;
      else if (typeof message?.content === 'string') textBuf += message.content;
      if (typeof delta?.role === 'string') role = delta.role;
      else if (typeof message?.role === 'string') role = message.role;
      if (Array.isArray(delta?.tool_calls)) {
        for (const tc of delta.tool_calls as unknown[]) {
          const t = tc as Record<string, unknown>;
          const idx = typeof t.index === 'number' ? (t.index as number) : 0;
          const fn = (t.function as Record<string, unknown>) ?? {};
          const acc = toolBuf.get(idx) ?? { name: '', arguments: '' };
          if (typeof fn.name === 'string') acc.name = fn.name;
          if (typeof fn.arguments === 'string') acc.arguments += fn.arguments;
          toolBuf.set(idx, acc);
        }
      }
      if (typeof choice?.finish_reason === 'string') {
        finishReason = choice.finish_reason as string;
      }
    }
    return {
      choices: [
        {
          message: {
            role: role ?? 'assistant',
            content: textBuf,
            tool_calls:
              toolBuf.size > 0
                ? Array.from(toolBuf.values()).map((t) => ({
                    function: t,
                  }))
                : undefined,
          },
          finish_reason: finishReason,
        },
      ],
    };
  }
  // Anthropic Messages streaming events: every chunk has
  // `type: 'message_start' | 'content_block_*' | 'message_*'`.
  // Coalesce text + thinking + tool_use deltas into a single
  // Anthropic-shape response object so the pretty path renders one
  // assistant turn.
  if (typeof obj.type === 'string' && isAnthropicStreamEvent(obj.type)) {
    return coalesceAnthropicStream(arr as Array<Record<string, unknown>>);
  }
  // Anthropic + Responses-API non-streaming responses are persisted
  // as a single-element array (`responseData: [response]`). Unwrap so
  // the downstream `extractTurns` sees the actual response object
  // rather than its enclosing array.
  if (arr.length === 1) return first;
  return arr;
}

/**
 * Coalesce an OpenAI Responses-API SSE event stream into a single
 * non-streaming `Response`-shape object so the pretty path renders
 * the assembled assistant turn instead of a raw event dump.
 *
 * Preference order:
 *   1. The terminal `response.completed` event carries the fully
 *      assembled response (`output[]` + `usage`). Use it verbatim.
 *   2. Fallback — accumulate `response.output_text.delta` and
 *      `response.reasoning_summary_text.delta` events into a synthetic
 *      `{ output: [{ type: 'message', content: [{type:'output_text',text}] }] }`.
 */
function coalesceResponsesStream(arr: Array<Record<string, unknown>>): unknown {
  for (const event of arr) {
    if (event.type === 'response.completed' && event.response) {
      return event.response;
    }
  }
  let textBuf = '';
  let reasoningBuf = '';
  for (const event of arr) {
    if (
      event.type === 'response.output_text.delta' &&
      typeof event.delta === 'string'
    ) {
      textBuf += event.delta;
    } else if (
      event.type === 'response.reasoning_summary_text.delta' &&
      typeof event.delta === 'string'
    ) {
      reasoningBuf += event.delta;
    }
  }
  const output: Array<Record<string, unknown>> = [];
  if (reasoningBuf) {
    output.push({
      type: 'reasoning',
      summary: [{ type: 'summary_text', text: reasoningBuf }],
    });
  }
  if (textBuf) {
    output.push({
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: textBuf }],
    });
  }
  return output.length > 0 ? { output } : arr;
}

function isAnthropicStreamEvent(type: string): boolean {
  return (
    type === 'message_start' ||
    type === 'message_delta' ||
    type === 'message_stop' ||
    type === 'content_block_start' ||
    type === 'content_block_delta' ||
    type === 'content_block_stop' ||
    type === 'ping'
  );
}

/**
 * Coalesce an Anthropic Messages SSE event stream into a single
 * non-streaming `Message`-shape object. Walks `content_block_start`
 * + `content_block_delta` pairs per index and assembles a
 * `content[]` array of `text` / `thinking` / `tool_use` blocks.
 *
 * The fully-assembled message lets the pretty path reuse the same
 * code that renders non-streaming Anthropic responses — no
 * Anthropic-specific branch needed downstream.
 */
function coalesceAnthropicStream(arr: Array<Record<string, unknown>>): unknown {
  const blocks = new Map<number, Record<string, unknown>>();
  // Tool-use arguments stream as `input_json_delta.partial_json`
  // fragments that we concatenate per block index until done.
  const toolBuffers = new Map<number, string>();
  let role: string | undefined;
  let model: string | undefined;
  let stopReason: string | undefined;
  let usage: Record<string, unknown> | undefined;

  for (const event of arr) {
    const t = event.type;
    if (t === 'message_start' && event.message) {
      const m = event.message as Record<string, unknown>;
      if (typeof m.role === 'string') role = m.role;
      if (typeof m.model === 'string') model = m.model;
      if (m.usage && typeof m.usage === 'object') {
        usage = m.usage as Record<string, unknown>;
      }
    } else if (t === 'content_block_start' && typeof event.index === 'number') {
      const block = event.content_block as Record<string, unknown> | undefined;
      if (block) {
        blocks.set(event.index as number, { ...block });
      }
    } else if (t === 'content_block_delta' && typeof event.index === 'number') {
      const idx = event.index as number;
      const block = blocks.get(idx) ?? {};
      const delta = event.delta as Record<string, unknown> | undefined;
      if (delta) {
        if (delta.type === 'text_delta' && typeof delta.text === 'string') {
          block.type = 'text';
          block.text = String(block.text ?? '') + delta.text;
        } else if (
          delta.type === 'thinking_delta' &&
          typeof delta.thinking === 'string'
        ) {
          block.type = 'thinking';
          block.thinking = String(block.thinking ?? '') + delta.thinking;
        } else if (
          delta.type === 'input_json_delta' &&
          typeof delta.partial_json === 'string'
        ) {
          toolBuffers.set(
            idx,
            (toolBuffers.get(idx) ?? '') + delta.partial_json
          );
        } else if (
          delta.type === 'signature_delta' &&
          typeof delta.signature === 'string'
        ) {
          block.signature = delta.signature;
        }
      }
      blocks.set(idx, block);
    } else if (t === 'message_delta' && event.delta) {
      const d = event.delta as Record<string, unknown>;
      if (typeof d.stop_reason === 'string') stopReason = d.stop_reason;
      if (event.usage && typeof event.usage === 'object') {
        usage = {
          ...(usage ?? {}),
          ...(event.usage as Record<string, unknown>),
        };
      }
    }
  }

  // Finalise tool-use blocks — parse the buffered partial_json into
  // `input` (or leave it as a string if parsing fails so the user
  // still sees the raw bytes).
  for (const [idx, partial] of toolBuffers) {
    const block = blocks.get(idx);
    if (!block) continue;
    if (block.type === 'tool_use') {
      try {
        block.input = JSON.parse(partial);
      } catch {
        block.input = partial;
      }
    }
    blocks.set(idx, block);
  }

  const content = Array.from(blocks.entries())
    .sort(([a], [b]) => a - b)
    .map(([, v]) => v);
  if (content.length === 0) return arr;
  return {
    role: role ?? 'assistant',
    model,
    content,
    stop_reason: stopReason,
    usage,
  };
}

// ─── Visual pieces ───────────────────────────────────────────────────────

const ROLE_COLORS: Record<
  string,
  'default' | 'primary' | 'success' | 'warning' | 'info'
> = {
  system: 'default',
  user: 'primary',
  assistant: 'success',
  reasoning: 'info',
  tool: 'warning',
  message: 'info',
};

function Turn({ turn }: { turn: RoleTurn }) {
  return (
    <Box
      sx={{
        border: '1px solid var(--mui-palette-divider)',
        borderRadius: 1,
        p: 1.25,
        backgroundColor: 'var(--mui-palette-background-paper)',
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{ mb: 0.75, alignItems: 'center' }}
      >
        <Chip
          label={turn.role}
          size="small"
          color={ROLE_COLORS[turn.role] ?? 'default'}
          variant="outlined"
        />
        {turn.meta &&
          Object.entries(turn.meta).map(
            ([k, v]) =>
              v != null && (
                <Chip
                  key={k}
                  label={`${k}: ${v}`}
                  size="small"
                  variant="outlined"
                />
              )
          )}
      </Stack>
      {turn.content && (
        <Typography
          variant="body2"
          component="pre"
          sx={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            margin: 0,
            fontFamily: 'inherit',
          }}
        >
          {turn.content}
        </Typography>
      )}
      {turn.toolCalls?.map((tc, i) => (
        <CodeBlock
          key={`call-${i}`}
          caption={`tool call · ${tc.name}`}
          body={tc.arguments}
          invalid={tc.invalid}
          invalidReason={
            tc.invalid
              ? 'Tool arguments are not valid JSON — the runtime cannot dispatch this call.'
              : undefined
          }
        />
      ))}
      {turn.toolResults?.map((tr, i) => (
        <CodeBlock
          key={`result-${i}`}
          caption={`tool result${tr.id ? ` · ${tr.id}` : ''}`}
          body={tr.content}
        />
      ))}
    </Box>
  );
}

function CodeBlock({
  caption,
  body,
  invalid,
  invalidReason,
}: {
  caption: string;
  body: string;
  invalid?: boolean;
  invalidReason?: string;
}) {
  return (
    <Box
      sx={{
        mt: 1,
        p: 1,
        borderRadius: 1,
        backgroundColor: 'var(--mui-palette-action-hover)',
        fontFamily: 'monospace',
        fontSize: '0.8125rem',
        border: invalid ? '1px solid' : 'none',
        borderColor: invalid ? 'error.main' : 'transparent',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          {caption}
        </Typography>
        {invalid && (
          <Tooltip title={invalidReason ?? 'Invalid JSON'} arrow>
            <WarningAmberIcon
              fontSize="inherit"
              color="error"
              sx={{ fontSize: '1rem' }}
              aria-label="invalid JSON"
            />
          </Tooltip>
        )}
      </Box>
      <Box
        component="pre"
        sx={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
      >
        {body}
      </Box>
    </Box>
  );
}

function RawJson({ value }: { value: unknown }) {
  return (
    <Box
      component="pre"
      sx={{
        margin: 0,
        p: 1,
        fontFamily: 'monospace',
        fontSize: '0.8125rem',
        backgroundColor: 'var(--mui-palette-action-hover)',
        borderRadius: 1,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {JSON.stringify(value, null, 2)}
    </Box>
  );
}
