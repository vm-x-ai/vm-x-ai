---
sidebar_position: 5
---

# Groq

Groq's OpenAI-compatible endpoint at `https://api.groq.com/openai/v1`.
The Groq provider is a thin extension of the OpenAI provider — it
swaps the base URL and otherwise reuses the OpenAI Chat Completions
SDK call path verbatim.

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

## Endpoint passthrough

| Client request shape | What hits the wire                                                              |
| -------------------- | ------------------------------------------------------------------------------- |
| Chat Completions     | Verbatim — Groq is OpenAI-compatible.                                           |
| Anthropic Messages   | Direct Anthropic ↔ Chat Completions converter (single hop — no internal pivot). |
| Responses            | Direct Responses ↔ Chat Completions converter (single hop — no internal pivot). |

## Capabilities

| Capability              |                                 Status                                 |
| ----------------------- | :--------------------------------------------------------------------: |
| Streaming               |                                   ✅                                   |
| Function / tool calling | ✅ — best on `llama-3.3-70b-versatile` and the larger Mixtral variants |
| Service tier            |                    ✅ — `service_tier: "on_demand"`                    |

## `providerArgs` — common Groq-native fields

```jsonc
{
  "vmx": {
    "providerArgs": {
      "service_tier": "on_demand"
    }
  }
}
```

## Models

Pass any model id Groq exposes — `llama-3.3-70b-versatile`,
`llama-3.1-8b-instant`, `gemma2-9b-it`, …

## Notes

- Groq's compat endpoint **rejects unknown top-level fields** and
  **rejects `tools[].function.strict: null`**. The gateway strips
  the `vmx` / `__vmx_passthrough` envelopes and omits `strict` when
  unset (rather than passing `null`).
- Tool-call reliability is best on the larger Llama models; the
  smaller `8b-instant` is fast but less consistent at function
  calling. Prefer `llama-3.3-70b-versatile` when tools matter.
- The Anthropic Messages and Responses cells use the canonical
  cross-format converters in
  `packages/api/src/ai-provider/adapters/anthropic-messages.adapter.ts`
  and `gateway/responses/responses-converter.ts` — see the
  [API Endpoints](../../features/api/index.md) pages for the
  per-pair conversion contract.
