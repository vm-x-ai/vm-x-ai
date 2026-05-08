---
sidebar_position: 6
---

# Perplexity

Perplexity's OpenAI-compatible endpoint at `https://api.perplexity.ai`.
The Perplexity provider is a thin extension of the OpenAI provider —
it swaps the base URL and otherwise reuses the OpenAI Chat Completions
SDK call path verbatim. Perplexity's **Sonar** models combine an LLM
with built-in web search, so every completion is search-augmented by
default.

## Connection config

| Field    | Required | Description                                                                                               |
| -------- | :------: | --------------------------------------------------------------------------------------------------------- |
| `apiKey` |   yes    | Perplexity API key. Create one at [perplexity.ai → API settings](https://www.perplexity.ai/settings/api). |

```jsonc
{
  "provider": "perplexity",
  "config": { "apiKey": "pplx-..." }
}
```

## Endpoint passthrough

| Client request shape | What hits the wire                                                              |
| -------------------- | ------------------------------------------------------------------------------- |
| Chat Completions     | Verbatim — Perplexity is OpenAI-compatible.                                     |
| Anthropic Messages   | Direct Anthropic ↔ Chat Completions converter (single hop — no internal pivot). |
| Responses            | Direct Responses ↔ Chat Completions converter (single hop — no internal pivot). |

## Capabilities

| Capability              | Status                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Streaming               | ✅                                                                                                                 |
| Web search              | ✅ — every Sonar request is search-augmented; citations on the response                                            |
| Function / tool calling | ❌ on the `sonar` line — these models don't expose function calling on the wire. Use OpenAI / Groq for tool flows. |

## `providerArgs` — common Perplexity-native fields

These fields are **not** part of the OpenAI Chat Completions spec but
Perplexity's compat endpoint accepts them. Use `providerArgs` to send
them through:

```jsonc
{
  "vmx": {
    "providerArgs": {
      "search_recency_filter": "week",
      "search_domain_filter": ["example.com", "wikipedia.org"],
      "search_after_date_filter": "2024-01-01",
      "search_before_date_filter": "2024-12-31",
      "return_related_questions": true
    }
  }
}
```

| Field                       | Purpose                                                                |
| --------------------------- | ---------------------------------------------------------------------- |
| `search_recency_filter`     | `hour` / `day` / `week` / `month` — limits search to recent results.   |
| `search_domain_filter`      | Allow-list of domains for the search backend.                          |
| `search_after_date_filter`  | ISO date — only consider sources published on or after this date.      |
| `search_before_date_filter` | ISO date — only consider sources published on or before this date.     |
| `return_related_questions`  | Include "people also ask"-style follow-up suggestions in the response. |
| `return_images`             | Attach inline image results to the response when relevant.             |

## Models

Pass any Sonar model id Perplexity exposes — `sonar`, `sonar-pro`,
`sonar-reasoning`, `sonar-reasoning-pro`. The default for new
connections is `sonar-pro`.

## Notes

- Perplexity's compat endpoint **rejects unknown top-level fields**.
  The gateway strips `vmx` / `__vmx_passthrough` before send.
- **Citations land on the response's top-level `citations[]` array**
  (not inside `choices[0].message`). Related questions are forwarded
  verbatim alongside. The audit row stores the full response so you
  can re-render citations from the audit page later.
- The Anthropic Messages and Responses cells use the canonical
  cross-format converters — see the
  [API Endpoints](../../features/api/index.md) pages for the
  per-pair conversion contract.
