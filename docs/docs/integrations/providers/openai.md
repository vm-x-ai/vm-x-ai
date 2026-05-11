---
sidebar_position: 2
---

# OpenAI

VM-X uses the official `openai` SDK to talk to `api.openai.com`.

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

## Endpoint passthrough

OpenAI is the only provider that natively speaks both **Chat
Completions** and **Responses**, so two of the three VM-X endpoints
forward verbatim. Anthropic Messages takes a single direct hop
through the Responses converter (no internal pivot):

| Client request shape | What hits the wire                                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat Completions     | **Verbatim.** Body is forwarded to `client.chat.completions.create()` with the gateway envelopes (`vmx`, `__vmx_passthrough`) stripped.                    |
| Responses            | **Verbatim.** Body is forwarded to `client.responses.create()` after stripping envelopes. Native `Response` / `ResponseStreamEvent` shape on the way back. |
| Anthropic Messages   | Direct converter to OpenAI Responses (not Chat Completions — Responses' richer event vocabulary preserves `thinking` / hosted tools / structured output).  |

## Capabilities

| Capability                           | Status                                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Streaming                            | ✅                                                                                                                             |
| Function / tool calling              | ✅                                                                                                                             |
| Structured outputs (`json_schema`)   | ✅                                                                                                                             |
| Vision (`image_url` / `input_image`) | ✅                                                                                                                             |
| Reasoning models (o-series)          | ✅ — `reasoning_tokens` flow through audit/usage                                                                               |
| Web search                           | ✅ — search-class models (`gpt-4o-search-preview`, `gpt-4o-mini-search-preview`) emit `annotations` with `url_citation` blocks |
| Predicted outputs                    | ✅                                                                                                                             |
| Audio I/O                            | ✅                                                                                                                             |

## `providerArgs` — common OpenAI-native fields

```jsonc
{
  "vmx": {
    "providerArgs": {
      "service_tier": "scale",
      "user": "user-7e9...",
      "logit_bias": { "1234": -100 }
    }
  }
}
```

## Models

VM-X doesn't restrict the model list — pass any model id OpenAI
accepts (`gpt-4.1`, `gpt-4o`, `gpt-4o-mini`, `o3-mini`, `o4-mini`,
`gpt-4o-search-preview`, …). The model is forwarded to the SDK
verbatim. The default for new connections is `gpt-4.1`.

## Notes

- **Per-model `maxRetries`** is forwarded to the OpenAI SDK as
  per-call `maxRetries`, so transient 5xx / throttling errors retry
  inside the SDK before the gateway falls through to the next
  fallback model. See [AI Resources](../../features/ai-resources/index.md#per-model-tuning-retries-and-timeout).
- **Rate-limit headers** (`x-ratelimit-*`) are parsed and surfaced as
  retry-after on `429` `CompletionError`s.
- **`vmx` envelope strip:** OpenAI rejects unknown top-level fields
  with a 400. The gateway strips both `vmx` (correlationId / metadata
  / providerArgs) and `__vmx_passthrough` (cross-format carrier)
  before send, on every endpoint.
