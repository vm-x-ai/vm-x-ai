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

## Endpoint passthrough

Anthropic is **the** native target for the `/v1/messages` endpoint —
that cell is full input + output passthrough. The other two endpoints
each take a single direct hop into Anthropic Messages (no internal
ChatCompletion pivot):

| Client request shape | What hits the wire                                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anthropic Messages   | **Verbatim.** `cache_control`, extended `thinking`, server tools, `service_tier`, `top_k`, refusal stop details all preserved.                                                                          |
| Chat Completions     | Direct Chat Completions ↔ Anthropic Messages converter. Cache markers / thinking / top_k / server tools survive via the `__vmx_passthrough.anthropic` envelope so they're re-attached on the wire body. |
| Responses            | Direct Responses ↔ Anthropic converter (D5 — no ChatCompletion pivot). The Responses event vocabulary maps onto Anthropic SSE events one-to-one for streams.                                            |

The gateway's `vmx` envelope and `__vmx_passthrough` envelope are
stripped before send so Anthropic's strict validator doesn't 400
with `vmx: Extra inputs are not permitted`.

## Capabilities

| Capability                       |                                      Status                                       |
| -------------------------------- | :-------------------------------------------------------------------------------: |
| Streaming                        |                                        ✅                                         |
| Function / tool calling          |                                        ✅                                         |
| `tool_choice: 'none'`            |       ✅ — converted to Anthropic `{type:'none'}`; tools field is preserved       |
| Vision (`image` content blocks)  |                                        ✅                                         |
| Prompt caching (`cache_control`) | ✅ — billing model honours 1.25× / 2× cache-write multipliers (5m / 1h ephemeral) |
| Extended thinking                |           ✅ — including adaptive thinking and `display: 'summarized'`            |
| Reasoning tokens reported        |        ✅ — surfaced as `reasoning_tokens` in usage on converted endpoints        |
| Server tools                     | ✅ — `web_search_*`, `code_execution_*`, `bash_*`, `text_editor_*`, `computer_*`  |
| Service tiers                    |                      ✅ — `auto` (default) / `standard_only`                      |
| Citations                        |      ✅ on the `/anthropic/messages` endpoint (response forwarded verbatim)       |
| Beta opt-ins (`anthropic-beta`)  |     ✅ — `betas[]` on the body lifts to the `anthropic-beta` HTTP header (T9)     |

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
