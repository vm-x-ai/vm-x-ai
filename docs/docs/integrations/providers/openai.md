---
sidebar_position: 2
---

# OpenAI

VM-X uses the official `openai` SDK to talk to `api.openai.com`. The
OpenAI provider implements **all three** gateway surfaces — Chat
Completions, Responses, and Anthropic Messages — via three sibling
cells in the `openai/` provider folder.

## Connection config

| Field    | Required | Description                                                                                                                          |
| -------- | :------: | ------------------------------------------------------------------------------------------------------------------------------------ |
| `apiKey` |   yes    | Standard OpenAI API key. Create one at [platform.openai.com → API keys](https://platform.openai.com/settings/organization/api-keys). |

```jsonc
{
  "provider": "openai",
  "config": { "apiKey": "sk-..." }
}
```

`baseURL` is **not** a user-facing config field. The provider's
internal helper accepts a `baseURL` override so the OpenAI-compat
subclasses (Groq, Perplexity, Gemini-OpenAI-shape) can reuse the same
SDK plumbing, but the OpenAI provider itself always targets
`api.openai.com`.

## Surface support matrix

| Surface            | Path                                                                                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat Completions   | **Verbatim.** Forwarded to `client.chat.completions.create()` after envelope strip. Canonical native cell — sibling subclasses (Groq, Perplexity) reuse it. |
| Responses          | **Verbatim.** Forwarded to `client.responses.create()` after envelope strip. Native `Response` / `ResponseStreamEvent` shape on the way back.               |
| Anthropic Messages | Direct converter to OpenAI Responses (not Chat Completions — Responses' richer event vocabulary preserves `thinking` / hosted tools / structured output).   |

## Capabilities

| Capability                           | Status                                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Streaming                            | yes                                                                                                                 |
| Function / tool calling              | yes                                                                                                                 |
| Structured outputs (`json_schema`)   | yes                                                                                                                 |
| Vision (`image_url` / `input_image`) | yes                                                                                                                 |
| Reasoning models (o-series, gpt-5)   | yes — `reasoning.effort` + `reasoning.summary` flow through; `reasoning_tokens` audited via `output_tokens_details` |
| Web search                           | yes — see [Web search](#web-search) for the per-surface tool name and the search-class model guard                  |
| Predicted outputs                    | yes (Chat Completions only — Responses has no `prediction` field)                                                   |
| Audio I/O                            | yes (Chat Completions only — Responses has no `audio` / `modalities` fields)                                        |

## Models

VM-X doesn't restrict the model list — pass any model id OpenAI
accepts (`gpt-4.1`, `gpt-5`, `gpt-4o`, `gpt-4o-mini`, `o3-mini`,
`o4-mini`, `gpt-5-search-api`, …). The model is forwarded to the SDK
verbatim. The default for new connections is `gpt-4.1`.

### Reasoning models

For `o3`, `o4-mini`, `gpt-5`, and similar reasoning-capable models on
the Responses surface, pass `reasoning.effort` and (optionally)
`reasoning.summary: 'auto'` to surface user-visible reasoning text in
the stream. On Chat Completions, use the top-level `reasoning_effort`
field. The gateway preserves both shapes verbatim.

### Search-class models — BFF block

`gpt-5-search-api`, `gpt-4o-search-preview`, and
`gpt-4o-mini-search-preview` are **Chat-Completions-only** — they
have web search baked into the model and OpenAI does not expose them
on the Responses API. The VM-X playground BFF blocks them up-front on
the Responses and Anthropic Messages surfaces with HTTP `400` and
error code `model_endpoint_mismatch`:

```jsonc
{
  "error": {
    "message": "`gpt-5-search-api` is a Chat-Completions-only search model and cannot be used on the Responses endpoint. Switch the playground to **Chat Completions** or pick a different model.",
    "code": "model_endpoint_mismatch"
  }
}
```

The check matches by exact id (see
`packages/ui/src/app/api/_lib/openai-model-quirks.ts`), so a loose
substring like `*-search-*` on a future non-OpenAI model won't be
false-positively rejected.

The gateway itself does **not** block these models — wire-format
fidelity is preserved end to end. The guard lives in the BFF because
"this model is wrong for the surface the user picked in the
playground UI" is a UX concern, not a gateway concern.

## Web search

The tool name differs per surface:

| Surface            | Tool                                                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Chat Completions   | Built into search-class models (`gpt-5-search-api`, etc.) — no tool needed                                                              |
| Responses          | `tools: [{ type: "web_search" }]` — the GA name (not `web_search_preview`)                                                              |
| Anthropic Messages | `tools: [{ type: "web_search_20250305", name: "web_search" }]` — the gateway converts to OpenAI Responses' `web_search` before dispatch |

On the Responses surface, output text carries `url_citation`
annotations; on streaming, `response.output_text.annotation.added`
events emit them as they arrive.

## `providerArgs` — common OpenAI-native fields

Use `vmx.providerArgs` to send extra OpenAI fields without forking
the wire-shape contract. The orchestrator merges these onto the
outgoing body before dispatch (after stripping the `vmx` envelope):

```jsonc
{
  "vmx": {
    "providerArgs": {
      "service_tier": "scale",
      "safety_identifier": "user-7e9...",
      "prompt_cache_key": "checkout-flow-v3",
      "logit_bias": { "1234": -100 }
    }
  }
}
```

Same envelope works on all three surfaces — fields land on the
post-conversion wire body, so on Anthropic Messages they must be
named for the **OpenAI Responses** shape that goes on the wire (e.g.
`safety_identifier`, not Anthropic's `metadata.user_id`).

## Notes

- **`vmx` envelope strip:** OpenAI rejects unknown top-level fields
  with a 400. The gateway strips both `vmx` (correlationId / metadata
  / providerArgs / events) and `__vmx_passthrough` (cross-format
  carrier) before send, on every surface.
- **Per-model `maxRetries`** is forwarded to the OpenAI SDK as
  per-call `maxRetries`, so transient 5xx / throttling errors retry
  inside the SDK before the gateway falls through to the next
  fallback model. See [AI Resources](../../features/ai-resources/index.md#per-model-tuning-retries-and-timeout).
- **Rate-limit headers** (`x-ratelimit-*`) are parsed and surfaced as
  retry-after on `429` `CompletionError`s.
- **Streaming usage shape differs per surface:** Chat Completions
  needs `stream_options.include_usage: true` (the gateway force-merges
  it) and emits usage on a trailing chunk; Responses emits usage on
  the terminal `response.completed` event — sending
  `stream_options.include_usage` on a Responses request would be a
  strict 400 from OpenAI on unknown fields.
- **Anthropic Messages → Responses conversion** is a direct converter
  (no internal pivot through Chat Completions). `thinking` blocks map
  to `reasoning` items, `tool_use` round-trips through `function_call`,
  `metadata.user_id` maps to `safety_identifier`, and
  `tool_choice.disable_parallel_tool_use` maps to top-level
  `parallel_tool_calls: false`.
