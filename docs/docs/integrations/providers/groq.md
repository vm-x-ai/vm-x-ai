---
sidebar_position: 5
---

# Groq

VM-X talks to Groq through its OpenAI-compatible host at
`https://api.groq.com/openai/v1` using the official `openai` SDK with
a baseURL override. The Groq provider now implements **all three**
gateway surfaces — Chat Completions, Responses, and Anthropic
Messages — via three sibling cells in the `groq/` provider folder.

## Connection config

| Field    | Required | Description                                                                               |
| -------- | :------: | ----------------------------------------------------------------------------------------- |
| `apiKey` |   yes    | Groq API key. Create one at [console.groq.com → API keys](https://console.groq.com/keys). |

```jsonc
{
  "provider": "groq",
  "config": { "apiKey": "gsk_..." }
}
```

`baseURL` is not a user-facing field — the provider always targets
`https://api.groq.com/openai/v1`.

## Surface support matrix

| Surface            | Path                                                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat Completions   | **Verbatim.** Forwarded to `client.chat.completions.create()` after envelope strip — Groq is OpenAI-compatible on `/openai/v1/chat/completions`.                                                  |
| Responses          | **Verbatim** (native). Groq ships an OpenAI-compatible Responses endpoint at `/openai/v1/responses`; the body is passed through the SDK with no internal pivot.                                   |
| Anthropic Messages | Two-hop via the canonical Anthropic ↔ Responses converter: Anthropic Messages → Responses body → Groq → Responses output → Anthropic Messages. Conversion lives in the Anthropic provider folder. |

The Responses surface is new since the gateway rewrite — earlier
revisions of this page only listed Chat Completions. See the
[Responses API page](../../features/api/responses.md) for the request
and event shapes.

## Capabilities

| Capability                         | Status                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Streaming                          | yes — both Chat Completions (SSE) and Responses (typed event stream)                                    |
| Function / tool calling            | yes — best on `llama-3.3-70b-versatile` and the larger Llama / GPT-OSS variants                         |
| Structured outputs (`json_schema`) | yes on Groq's allow-listed models (e.g. `openai/gpt-oss-20b`); `llama-3.3-70b-versatile` rejects strict |
| Reasoning models                   | yes — `openai/gpt-oss-{20b,120b}`, Qwen3, DeepSeek-R1; honour `reasoning_effort` / `reasoning.effort`   |
| Service tier                       | yes — `service_tier: "auto" \| "on_demand" \| "flex" \| "performance"`                                  |
| Hosted tools (Responses)           | yes — `code_interpreter`, `browser_search`, `mcp` (gated to the GPT-OSS family)                         |

## Models

Pass any model id Groq exposes — for example
`llama-3.3-70b-versatile`, `llama-3.1-8b-instant`, `gemma2-9b-it`,
`openai/gpt-oss-20b`, `openai/gpt-oss-120b`. The default for new
connections is `openai/gpt-oss-20b`. Tool-call reliability is best on
the larger Llama and GPT-OSS models; `llama-3.1-8b-instant` is fast
but less consistent at function calling.

## `providerArgs` — Groq-native fields

Groq accepts a handful of top-level fields beyond OpenAI's schema.
The gateway forwards them verbatim (the SDK does not strip unknown
keys):

```jsonc
{
  "service_tier": "on_demand",
  "reasoning_effort": "medium", // Chat Completions
  "reasoning_format": "parsed", // Chat Completions
  "search_settings": {
    /* ... */
  },
  "compound_custom": {
    /* ... */
  }
}
```

On the Responses surface use the standard OpenAI shape
`reasoning: { effort: "low" | "medium" | "high" }` — Groq accepts it
on the GPT-OSS family.

## Notes

- Groq's compat endpoints **reject unknown top-level fields**, so the
  gateway strips both the `vmx` metrics envelope and the internal
  `__vmx_passthrough` wrapper before sending. See the
  [VM-X envelope reference](../../features/api/vmx-envelope.md).
- Groq's `/openai/v1/chat/completions` returns **400** for
  `logprobs`, `top_logprobs`, `logit_bias`, `messages[].name`, and
  `n > 1`. The gateway does not pre-strip these — the upstream
  validation error is surfaced as a `CompletionError` with the
  original request body attached in `providerRequestPayload`.
- Groq's `/openai/v1/responses` does not accept
  `previous_response_id`, `store`, `truncation`, `include`,
  `safety_identifier`, `prompt_cache_key`, or `prompt`; same policy
  applies — the upstream 400 is forwarded unchanged.
- The Responses cell collapses typed `output_text` parts on assistant
  messages in the `input` array to plain strings before sending. Groq
  rejects typed-block assistant content on `/responses` with a 400;
  user `input_text` parts and the wire response shape are unaffected.
- Anthropic Messages routes through the canonical converter in
  `packages/api/src/ai-provider/anthropic/openai-response.provider.ts`
  — the same one OpenAI uses. See the
  [Anthropic Messages API page](../../features/api/anthropic-messages.md)
  for the per-pair conversion contract.
