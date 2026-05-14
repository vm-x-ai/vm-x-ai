---
sidebar_position: 6
---

# Perplexity

Perplexity's OpenAI-compatible API. The Perplexity provider is a thin
extension of the OpenAI provider — every surface points the OpenAI SDK
at a Perplexity base URL and otherwise reuses the OpenAI SDK call path
verbatim. Perplexity's **Sonar** models combine an LLM with built-in
web search, so on Chat Completions every completion is search-augmented
by default; on Responses, search is opt-in via the `web_search` hosted
tool.

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

Perplexity ships native OpenAI-compatible Chat Completions **and**
Responses endpoints, so both surfaces are native passthroughs. The
Anthropic Messages surface pivots through Responses via the canonical
adapter.

| Client request shape | What hits the wire                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| Chat Completions     | Native passthrough — `POST https://api.perplexity.ai/chat/completions` (unversioned, legacy host).            |
| Responses            | Native passthrough — `POST https://api.perplexity.ai/v1/responses` (aliased to Perplexity's `/v1/agent`).     |
| Anthropic Messages   | Pivots through the Responses converter (Anthropic ↔ Responses) and dispatches to Perplexity's Responses host. |

The version-prefix asymmetry between the two hosts is intentional —
Chat Completions is grandfathered on the unversioned root; Responses
only exists under `/v1`.

## Capabilities

| Capability              | Status                                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Streaming               | Yes (both surfaces).                                                                                                        |
| Web search              | Yes — built-in on every Sonar Chat Completions call; opt-in via the `web_search` hosted tool on Responses.                  |
| Function / tool calling | Not supported on the Sonar lineup — caller-supplied `tools[]` with `type: "function"` will 400 upstream. Use OpenAI / Groq. |
| Structured outputs      | Yes — `response_format: { type: "json_schema", json_schema: { schema, strict? } }` on Chat Completions.                     |
| Reasoning effort        | Yes — `reasoning_effort` (`low` / `medium` / `high`) on `sonar-reasoning` / `sonar-reasoning-pro`.                          |

## Models

Pass any Sonar model id Perplexity exposes — `sonar`, `sonar-pro`,
`sonar-reasoning`, `sonar-reasoning-pro`. The provider's default model
for new connections is `sonar-pro`.

> **Responses-surface model id quirk.** Perplexity's Responses endpoint
> requires the namespaced form `perplexity/<model>` and currently only
> exposes `perplexity/sonar` (not `sonar-pro`). Send the bare `sonar*`
> ids to the Chat Completions surface; use `perplexity/sonar` when you
> address Responses or Anthropic Messages.

## Web search

### Chat Completions — built-in on every call

Sonar searches the web on every Chat Completions request — there is no
tool descriptor to send. Tune the search via Perplexity-native top-level
fields (the gateway forwards them verbatim through the OpenAI SDK's
open-record serialisation, including via `vmx.providerArgs`):

| Field                       | Purpose                                                                |
| --------------------------- | ---------------------------------------------------------------------- |
| `search_recency_filter`     | `hour` / `day` / `week` / `month` / `year` — recency cap.              |
| `search_domain_filter`      | `string[]` — allow-list of source domains.                             |
| `search_after_date_filter`  | `MM/DD/YYYY` — only consider sources published on or after this date.  |
| `search_before_date_filter` | `MM/DD/YYYY` — only consider sources published on or before this date. |
| `return_related_questions`  | Include "people also ask"-style follow-up suggestions in the response. |
| `return_images`             | Attach inline image results to the response when relevant.             |
| `web_search_options`        | Object form of the same overlay (`search_context_size`, etc.).         |
| `reasoning_effort`          | `low` / `medium` / `high` — gates against `sonar-reasoning*`.          |

```jsonc
{
  "vmx": {
    "providerArgs": {
      "search_recency_filter": "week",
      "search_domain_filter": ["github.com", "typescriptlang.org"]
    }
  }
}
```

### Responses — `web_search` hosted tool with `filters`

On the Responses surface, web search is an opt-in hosted tool. Send
`tools: [{ type: "web_search" }]`. The gateway also accepts the
OpenAI-canonical alias `web_search_preview` and renames it to
`web_search` on the wire so direct callers using the canonical OpenAI
shape don't hit upstream `unknown tool type` errors.

Per-tool knobs live under `tools[i].filters` and are forwarded
**verbatim** — the rename only rewrites the `type` field:

| `filters` key           | Effect                                      |
| ----------------------- | ------------------------------------------- |
| `search_domain_filter`  | `string[]` — allow-list of source domains.  |
| `search_recency_filter` | `hour` / `day` / `week` / `month` / `year`. |

```jsonc
{
  "model": "my-perplexity-resource",
  "input": "Latest TypeScript release? Cite sources.",
  "tools": [
    {
      "type": "web_search",
      "filters": {
        "search_domain_filter": ["typescriptlang.org"],
        "search_recency_filter": "week"
      }
    }
  ]
}
```

See [Web search](../../features/api/web-search.md) for the full
provider × endpoint matrix and end-to-end examples.

## Citations and search metadata

Perplexity surfaces per-claim sources in two ways, and the gateway
preserves both verbatim — no normalisation, no synthesis:

- **Chat Completions:** top-level `citations: string[]` and
  `search_results: Array<{ title?, url?, snippet?, date?, last_updated?, source? }>`
  on the response body (also surfaced on streaming chunks, typically
  the closing one). Neither field is part of OpenAI's
  `ChatCompletion` type — the OpenAI SDK preserves unknown top-level
  keys, so they ride through unchanged.
- **Responses:** OpenAI-canonical `annotations[]` of type
  `url_citation` on each `output_text` content part **plus** the
  same top-level `citations[]` / `search_results[]` extension fields
  retained for compatibility. The cell does not synthesise the
  annotation channel from the extension fields — Perplexity emits
  both natively.

The Anthropic Messages surface drops these fields — Anthropic's
`Message` envelope has no native top-level slot for URL citations,
and `TextBlock.citations` carries Anthropic's own shape, not a URL
list. If you need Perplexity sources, call Chat Completions or
Responses directly.

## VM-X envelope notes

- Perplexity's compat endpoints **reject unknown top-level fields**.
  The gateway strips the `vmx` / `__vmx_passthrough` envelopes before
  send. Anything you place under `vmx.providerArgs` is merged onto the
  wire body upstream of the provider cell (orchestrator order:
  `defaultArgs` ⊕ native body ⊕ `vmx.providerArgs`).
- The audit row stores the full provider-side wire body
  (`providerRequestPayload`) and the full response, so you can
  re-render citations from the audit page later.

## Notes

- All three surfaces use the canonical cross-format converters
  documented in the [API Endpoints](../../features/api/index.md)
  pages. The Anthropic Messages cell dispatches through Responses
  (not Chat Completions), so Sonar's reasoning, multimodal inputs,
  and Responses-native web search all reach it on that path.
- For per-cell fidelity detail, read the converter under
  [`packages/api/src/ai-provider/perplexity/`](https://github.com/vm-x-ai/vm-x-ai/tree/main/packages/api/src/ai-provider/perplexity)
  alongside the live spec at
  [`__integration__/providers/perplexity.spec.ts`](https://github.com/vm-x-ai/vm-x-ai/blob/main/packages/api/src/__integration__/providers/perplexity.spec.ts).
