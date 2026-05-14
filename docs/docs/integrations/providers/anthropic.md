---
sidebar_position: 3
---

# Anthropic

VM-X uses the official `@anthropic-ai/sdk` to talk to
`api.anthropic.com`. Native HTTP — no OpenAI-compat shim.

## Connection config

| Field    | Required | Description                                                                                                       |
| -------- | :------: | ----------------------------------------------------------------------------------------------------------------- |
| `apiKey` |   yes    | Anthropic API key. Create one at [console.anthropic.com → API keys](https://console.anthropic.com/settings/keys). |

```jsonc
{
  "provider": "anthropic",
  "config": { "apiKey": "sk-ant-..." }
}
```

The Anthropic SDK is constructed with `apiKey` only — there is no
`baseURL` override on this connection (the SDK targets
`api.anthropic.com`). A 10-minute client-level timeout is applied by
default so high-`max_tokens` non-streaming calls don't trip the SDK's
internal "streaming required for &gt;10 min" guard. Per-request
`vmx.timeoutMs` still wins via the per-call `timeout` option.

## Endpoint passthrough

Anthropic is **the** native target for the `/v1/messages` endpoint —
that cell is full input + output passthrough. The other two endpoints
each take a single direct hop into Anthropic Messages (no internal
ChatCompletion pivot):

| Client request shape | What hits the wire                                                                                                                                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anthropic Messages   | **Verbatim.** `cache_control`, extended `thinking` blocks (incl. `redacted_thinking`), server tools, `service_tier`, `top_k`, `mcp_servers`, `context_management`, `inference_geo`, refusal stop details all preserved.                                   |
| Chat Completions     | Direct Chat Completions ↔ Anthropic Messages converter (shared `adapters/anthropic-messages.adapter.ts`). Cache markers / thinking / top_k / server tools survive via the `__vmx_passthrough.anthropic` envelope so they're re-attached on the wire body. |
| Responses            | Direct Responses ↔ Anthropic converter — no ChatCompletion pivot. The Responses event vocabulary maps onto Anthropic SSE events one-to-one for streams.                                                                                                   |

The shared `adapters/anthropic-messages.adapter.ts` is also imported
by other providers that speak Anthropic on the wire (AWS Bedrock
Invoke) and by converter cells in non-Anthropic providers that accept
Anthropic Messages input (Gemini, Bedrock Converse, OpenAI
Responses-backed) — see the [providers index](./index.md) matrix.

The gateway's `vmx` envelope and `__vmx_passthrough` envelope are
stripped before send so Anthropic's strict validator doesn't 400
with `vmx: Extra inputs are not permitted`. The `betas[]` body field
(if present) is similarly lifted off the body and re-emitted as an
`anthropic-beta` HTTP header at dispatch time.

## Capabilities

| Capability                       |                                                             Status                                                             |
| -------------------------------- | :----------------------------------------------------------------------------------------------------------------------------: |
| Streaming                        |                                                               ✅                                                               |
| Function / tool calling          |                                                               ✅                                                               |
| `tool_choice: 'none'`            |                             ✅ — converted to Anthropic `{type:'none'}`; tools field is preserved                              |
| `parallel_tool_calls: false`     |   ✅ — re-emitted as `tool_choice.disable_parallel_tool_use: true` (defaults `tool_choice` to `auto` when caller omitted it)   |
| `n > 1` (Chat Completions only)  |                        ❌ — rejected with `anthropic_n_unsupported` (Anthropic only returns one choice)                        |
| Vision (`image` content blocks)  |                                                               ✅                                                               |
| Prompt caching (`cache_control`) |                       ✅ — billing model honours 1.25× / 2× cache-write multipliers (5m / 1h ephemeral)                        |
| Extended thinking                |                                  ✅ — including adaptive thinking and `display: 'summarized'`                                  |
| Reasoning tokens reported        |                              ✅ — surfaced as `reasoning_tokens` in usage on converted endpoints                               |
| Server tools                     |                    ✅ — full passthrough on `/anthropic/messages` (see [Server tools](#server-tools) below)                    |
| MCP servers (`mcp_servers`)      |                    ✅ — passthrough body field on `/anthropic/messages` (requires the matching beta header)                    |
| Service tiers                    |                                            ✅ — `auto` (default) / `standard_only`                                             |
| Citations                        | ✅ — verbatim on `/anthropic/messages`; surfaced via `citations_delta` / message annotations on Chat Completions and Responses |
| Beta opt-ins (`anthropic-beta`)  |                              ✅ — `betas[]` on the body lifts to the `anthropic-beta` HTTP header                              |

## `providerArgs` — common Anthropic-native fields

When using the Chat Completions / Responses endpoints, these are the
escape hatches for Anthropic-native knobs that the OpenAI shape can't
express:

```jsonc
{
  "vmx": {
    "providerArgs": {
      "top_k": 10,
      "thinking": { "type": "enabled", "budget_tokens": 5000 }
    }
  }
}
```

(When you're already on the `/anthropic/messages` endpoint, just put
those fields at the top level of the request body — that's what
Anthropic's SDK does natively.)

## Server tools

Anthropic's `MessageCreateParams.tools[]` is a discriminated union of
custom function tools plus a family of server-executed tools. On
`/anthropic/messages` the gateway passes every entry through verbatim
(pinned against `@anthropic-ai/sdk@0.95.1`):

| Family         | `type` discriminators                                                           |
| -------------- | ------------------------------------------------------------------------------- |
| Web search     | `web_search_20250305`, `web_search_20260209`                                    |
| Web fetch      | `web_fetch_20250910`, `web_fetch_20260209`, `web_fetch_20260309`                |
| Code execution | `code_execution_20250522`, `code_execution_20250825`, `code_execution_20260120` |
| Bash           | `bash_20250124`                                                                 |
| Text editor    | `text_editor_20250124`, `text_editor_20250429`, `text_editor_20250728`          |
| Memory         | `memory_20250818`                                                               |
| Tool search    | `tool_search_tool_bm25_20251119`, `tool_search_tool_regex_20251119`             |
| MCP            | configured via top-level `mcp_servers` (not a `tools[]` entry)                  |

When the **same** Anthropic Messages request is routed to a
non-Anthropic provider (Gemini, Bedrock Converse, OpenAI Responses-
backed), each server tool is either mapped onto a native equivalent
or rejected with a code-named 400 (`anthropic_server_tool_unsupported_on_<target>`).
See the per-provider pages — Anthropic itself never rejects on these.

Result blocks in multi-turn history (`server_tool_use`,
`web_search_tool_result`, `code_execution_tool_result`,
`bash_code_execution_tool_result`,
`text_editor_code_execution_tool_result`, `web_fetch_tool_result`,
`tool_search_tool_result`, `container_upload`) round-trip verbatim
on native Anthropic.

## Thinking blocks

Extended thinking is forwarded as-is:

- `thinking: { type: 'enabled', budget_tokens: N }` on the request
  body (or via `vmx.providerArgs.thinking` on the OpenAI-shape
  endpoints) enables the `thinking` content blocks on the response.
- Both `thinking` and `redacted_thinking` blocks (the latter is
  Anthropic's signed-server-side wrapper for moderated reasoning)
  pass through unchanged on `/anthropic/messages`.
- On cross-format conversions, the converter re-emits `thinking` /
  `redacted_thinking` blocks **before** the assistant's text + tool
  blocks, matching Anthropic's signed-thinking continuity rules.
- Reasoning tokens are surfaced as `reasoning_tokens` in the usage
  block on converted endpoints; on native `/anthropic/messages` they
  appear in Anthropic's own `usage` shape.

## Audit row fields specific to Anthropic

Audit rows for Anthropic completions populate:

- `cached_tokens` — prompt cache reads
- `cache_creation_input_tokens` — total cache writes
- `cache_creation_ephemeral5m_tokens` / `cache_creation_ephemeral1h_tokens` —
  per-TTL breakdown (when reported on the response)
- `server_tool_use_*_requests` — counts per server tool invocation
- `service_tier` — the tier Anthropic actually billed at

The cost service applies the published cache-write multipliers
(1.25× input rate for 5m ephemeral, 2× for 1h) and subtracts cache-
creation tokens from the base prompt billing so you don't pay twice.

## Models

Pass any Claude model id Anthropic exposes (`claude-haiku-4-5`,
`claude-sonnet-4-6`, `claude-opus-4-7`, …). The default for new
connections is `claude-haiku-4-5`.

## Notes

- **Beta opt-ins** are accepted as a `betas: ['…']` array on the body
  (the cross-format converters stow them via the `__vmx_passthrough`
  envelope so they survive Chat Completions / Responses input). Native
  Anthropic rejects `betas` as a body field, so the gateway lifts it
  off the body and emits `anthropic-beta: <comma-separated>` as an
  HTTP header at dispatch time. The Bedrock-Invoke variant of this
  fix uses `anthropic_beta` as a body field instead — see
  [aws-bedrock-invoke](./aws-bedrock-invoke.md).
- **Caller-forwarded headers** (T18): allow-listed headers on the
  client request (`anthropic-beta`, `anthropic-version`, …) are
  forwarded onto the Anthropic SDK call so opt-in headers always reach
  upstream regardless of which endpoint the body came in on.
- **Upstream headers surface on non-streaming responses** (T4):
  `request-id` and `anthropic-ratelimit-*` are mapped onto the audit
  row's `x-request-id` / `x-ratelimit-*` keys.
- **`tool_choice: {type:'none'}`** strips tools entirely on the
  cross-format paths — Anthropic's `{type:'none'}` semantics match
  OpenAI's "model must not call tools".
- **Reasoning ordering** (T16): when an OpenAI / Responses caller
  sends an assistant message that carries a reasoning extension,
  the converter re-emits the `thinking` (or `redacted_thinking`)
  blocks **before** the assistant text/tool blocks, matching
  Anthropic's signed-thinking continuity rules.
- **Streaming Anthropic→Responses** uses the direct converter; the
  Anthropic↔ChatCompletion stream converter is used by Gemini /
  Groq / Perplexity for their Anthropic-input cells (T17) — see
  the providers index matrix.
