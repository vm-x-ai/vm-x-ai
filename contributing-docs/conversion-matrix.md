# Cross-format conversion support matrix

Canonical contributor reference for the per-cell (provider × surface) conversion picture. The gateway exposes three input surfaces (OpenAI Chat Completions, OpenAI Responses, Anthropic Messages) and routes each one to a provider-specific converter that adapts request/response/stream to the provider's wire shape — or passes through verbatim where the surface and wire shape already match.

Each cell below points to the converter file(s) under `packages/api/src/ai-provider/<provider>/` that implement that (provider × surface) pair. For per-cell behaviour detail, read the converter alongside its `*.spec.ts` neighbour and the live spec at `packages/api/src/__integration__/providers/<provider>.spec.ts`.

Last refreshed 2026-05-14.

## Legend

- **native** — input surface equals the provider's wire shape; the cell is a thin passthrough that strips gateway envelopes (`__vmx_passthrough`, `vmx.*` extensions) and dispatches the request verbatim. Highest fidelity.
- **compat passthrough** — the provider speaks an OpenAI-compatible wire format. Cell forwards via the OpenAI SDK with a `baseURL` override; provider-specific quirks (e.g. Perplexity filter fields, Groq reasoning fields) are preserved as opaque pass-through.
- **converted** — cell contains a request adapter, response converter, and stream converter that translate between the input surface and a different wire shape. Lossy on features that have no analogue in the target wire format.
- **pivot** — cell delegates to a sibling cell of the same provider after rewriting the surface (e.g. Anthropic Messages → OpenAI Responses → OpenAI native). Inherits all of the inner cell's fidelity caveats.
- Status icons: native ✅ · compat ⚠️ · converted ⚠️/❌ where noted.

## Provider × surface matrix

Columns are the three input surfaces hitting `gateway/*/*.controller.ts`. Each cell links to the converter file(s) it owns. "Fidelity" is the typical outcome; drill-downs below cover specific feature classes.

| Provider               | OpenAI Chat Completions                                                                                                                                                                                                                                       | OpenAI Responses                                                                                                                                                       | Anthropic Messages                                                                                                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OpenAI**             | native ✅ — [`openai-chat-completion.provider.ts`](../packages/api/src/ai-provider/openai/openai-chat-completion.provider.ts)                                                                                                                                 | native ✅ — [`openai-response.provider.ts`](../packages/api/src/ai-provider/openai/openai-response.provider.ts)                                                        | pivot ⚠️ — [`anthropic-messages.provider.ts`](../packages/api/src/ai-provider/openai/anthropic-messages.provider.ts) (Responses pivot via [`anthropic-via-responses.ts`](../packages/api/src/ai-provider/openai/anthropic-via-responses.ts)) |
| **Anthropic**          | converted ⚠️ — [`openai-chat-completion.provider.ts`](../packages/api/src/ai-provider/anthropic/openai-chat-completion.provider.ts) (uses [`adapters/anthropic-messages.adapter.ts`](../packages/api/src/ai-provider/adapters/anthropic-messages.adapter.ts)) | converted ❌ — [`openai-response.provider.ts`](../packages/api/src/ai-provider/anthropic/openai-response.provider.ts)                                                  | native ✅ — [`anthropic-messages.provider.ts`](../packages/api/src/ai-provider/anthropic/anthropic-messages.provider.ts)                                                                                                                     |
| **Gemini**             | converted ✅ (compat shim) — [`openai-chat-completion.provider.ts`](../packages/api/src/ai-provider/gemini/openai-chat-completion.provider.ts) (native path via [`shared.ts`](../packages/api/src/ai-provider/gemini/shared.ts))                              | converted ⚠️ — [`openai-response.provider.ts`](../packages/api/src/ai-provider/gemini/openai-response.provider.ts)                                                     | pivot ❌ — [`anthropic-messages.provider.ts`](../packages/api/src/ai-provider/gemini/anthropic-messages.provider.ts) (pivots via Chat)                                                                                                       |
| **Groq**               | compat ✅ — [`openai-chat-completion.provider.ts`](../packages/api/src/ai-provider/groq/openai-chat-completion.provider.ts)                                                                                                                                   | compat ✅ — [`openai-response.provider.ts`](../packages/api/src/ai-provider/groq/openai-response.provider.ts)                                                          | pivot ⚠️ — [`anthropic-messages.provider.ts`](../packages/api/src/ai-provider/groq/anthropic-messages.provider.ts) (via `openai/anthropic-via-chat-completion.ts`)                                                                           |
| **Perplexity**         | compat ✅ — [`openai-chat-completion.provider.ts`](../packages/api/src/ai-provider/perplexity/openai-chat-completion.provider.ts)                                                                                                                             | compat ✅ — [`openai-response.provider.ts`](../packages/api/src/ai-provider/perplexity/openai-response.provider.ts)                                                    | pivot ⚠️ — [`anthropic-messages.provider.ts`](../packages/api/src/ai-provider/perplexity/anthropic-messages.provider.ts) (Pattern B compat helper)                                                                                           |
| **Bedrock — Converse** | converted ⚠️ — [`openai-chat-completion.provider.ts`](../packages/api/src/ai-provider/aws-bedrock-converse/openai-chat-completion.provider.ts) (Chat→Converse adapter in [`shared.ts`](../packages/api/src/ai-provider/aws-bedrock-converse/shared.ts))       | converted ❌ — [`openai-response.provider.ts`](../packages/api/src/ai-provider/aws-bedrock-converse/openai-response.provider.ts)                                       | converted ❌ — [`anthropic-messages.provider.ts`](../packages/api/src/ai-provider/aws-bedrock-converse/anthropic-messages.provider.ts)                                                                                                       |
| **Bedrock — Invoke**   | converted ⚠️ — [`openai-chat-completion.provider.ts`](../packages/api/src/ai-provider/aws-bedrock-invoke/openai-chat-completion.provider.ts) (two-stage: OpenAI→Anthropic, Anthropic→Invoke)                                                                  | converted ❌ — [`openai-response.provider.ts`](../packages/api/src/ai-provider/aws-bedrock-invoke/openai-response.provider.ts) (two-stage: Responses→Anthropic→Invoke) | native (passthrough) ✅ — [`anthropic-messages.provider.ts`](../packages/api/src/ai-provider/aws-bedrock-invoke/anthropic-messages.provider.ts)                                                                                              |

Cross-cell reference: server-hosted Anthropic tool dispatch (which tools survive each conversion direction) lives in [`adapters/anthropic-server-tools.ts`](../packages/api/src/ai-provider/adapters/anthropic-server-tools.ts) — the executable classification table.

## Feature-category matrix

Each cell is the **typical** outcome. ⚠️ means works but lossy — see drill-downs below.

| Feature category                             | OAI→Anth                        | Anth→OAI                       | OAI→Gem                         | OAI→Bed                                        | Anth→Gem                         | Anth→Bed                                |
| -------------------------------------------- | ------------------------------- | ------------------------------ | ------------------------------- | ---------------------------------------------- | -------------------------------- | --------------------------------------- |
| Core sampling (temp/top_p/max_tokens)        | ✅                              | ⚠️ stop dropped                | ✅ compat / ⚠️ native           | ✅ Conv / ⚠️ Resp→Conv                         | ✅                               | ✅ Conv / ✅ Inv                        |
| Function tools                               | ✅                              | ✅                             | ✅                              | ✅                                             | ✅                               | ✅                                      |
| `tool_choice` (auto/required/named)          | ✅                              | ⚠️ `none`→undefined            | ✅ compat                       | ⚠️ Conv (`none` dropped) / ✅ Inv              | ✅                               | ⚠️ Conv (`none` dropped) / ✅ Inv       |
| Server-hosted tools                          | ⚠️ Chat / ❌ Resp               | ❌                             | ⚠️ native (5 keys) / ❌ shim    | ❌ Conv / ⚠️ Inv                               | ❌                               | ❌ Conv / ✅ Inv                        |
| Anthropic-schema client tools                | n/a                             | ❌                             | n/a                             | ❌ Conv / ✅ Inv                               | n/a                              | ❌ Conv / ✅ Inv                        |
| MCP connector                                | ✅ Chat / ❌ Resp               | ❌                             | ❌                              | ❌ Conv / ⚠️ Inv                               | ❌                               | ❌ Conv / ✅ Inv                        |
| Vision: base64 / data-URL                    | ✅                              | ✅                             | ✅ compat / ❌ native           | ✅ Conv / ✅ Chat→Inv                          | ✅                               | ⚠️ Conv (only base64) / ✅ Inv          |
| Vision: external URL                         | ✅                              | ✅                             | ✅ compat / ❌ native           | ✅ Conv (server-fetched) / ❌ Inv              | ✅                               | ❌ Conv / ⚠️ Inv (will 400)             |
| Vision: `file_id` source                     | ❌                              | ❌                             | ❌                              | ❌                                             | ❌                               | ❌ Conv / ✅ Inv                        |
| PDF / document block                         | ⚠️ Chat / ❌ Resp               | ❌                             | ⚠️ compat / ❌ native           | ✅ Chat→Conv / ❌ Resp→Conv / ❌ Inv           | ⚠️ url is non-standard           | ❌ Conv / ✅ Inv                        |
| Audio input                                  | ❌                              | ❌                             | ⚠️ compat / ❌ native           | ❌ rejected with 400                           | ❌                               | ❌ Conv / ✅ Inv                        |
| `cache_control` / prompt caching             | ✅ Chat / ❌ Resp               | ❌                             | ❌ stripped                     | **❌ Conv broken** / ✅ Chat→Inv / ❌ Resp→Inv | ❌ stripped                      | **❌ Conv broken** / ✅ Inv             |
| Reasoning effort / thinking                  | ✅ Chat / ⚠️ Resp               | ⚠️ xhigh/max not mapped        | ❌ native / ⚠️ compat           | ✅ Chat / ⚠️ Resp                              | ❌ stripped                      | ⚠️ Conv / ✅ Inv                        |
| Thinking signature round-trip                | ✅ Chat / ❌ Resp               | ❌ hard-coded `''`             | ❌                              | ✅ Chat→Inv / ❌ Resp→Inv                      | ❌                               | ⚠️ Conv (no `signature_delta`) / ✅ Inv |
| `redacted_thinking`                          | ✅ Chat / ⚠️ Resp               | ❌                             | ❌                              | ✅ Chat→Inv / ❌ Resp→Inv                      | ❌                               | ❌ Conv / ✅ Inv                        |
| Citations / `citationsContent`               | ⚠️ Chat (stream-only) / ❌ Resp | ❌                             | ❌                              | ❌                                             | ❌                               | ❌ Conv / ✅ Inv                        |
| Server-side structured output                | ✅ Chat (synth tool) / ❌ Resp  | ❌                             | ❌ native                       | ⚠️ Chat→Inv / ❌ Conv / ❌ Resp                | ❌                               | ❌ Conv / ✅ Inv                        |
| Stream events forwarded faithfully           | ✅ Chat / ⚠️ Resp               | ⚠️ no `event:`, dropped events | ✅ compat / ❌ native (demoted) | ⚠️ Conv (no reasoning deltas) / ✅ Inv         | ❌ returns ChatCompletion chunks | ⚠️ Conv (no `signature_delta`) / ✅ Inv |
| Stop reasons (full set)                      | ✅ Chat / ⚠️ Resp               | ⚠️ `failed`→`max_tokens` bug   | ⚠️ Gemini specifics collapsed   | ✅ Conv / ✅ Inv                               | ⚠️ collapsed                     | ⚠️ Conv (no `pause_turn`) / ✅ Inv      |
| Token usage incl. cache breakdown            | ✅                              | ⚠️ `reasoning_tokens` lost     | ⚠️ native: per-modality lost    | ✅ Inv / ⚠️ Conv (no `cacheDetails`)           | ⚠️                               | ⚠️ Conv (no breakdown) / ✅ Inv         |
| Caller header forwarding                     | ❌ everywhere                   | ❌                             | ❌                              | ❌ Conv / ❌ Inv                               | ❌                               | ❌ Conv / ❌ Inv                        |
| `event:` SSE prefix on `/anthropic/messages` | n/a                             | ❌                             | n/a                             | n/a                                            | ❌                               | ❌                                      |

## Critical drill-downs

### Prompt caching

| Direction                          | Status                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| OpenAI Chat → Anthropic            | ✅ — passthrough envelope re-applies system + tool breakpoints                                    |
| OpenAI Responses → Anthropic       | ❌ — Responses path never reads passthrough                                                       |
| Anthropic → OpenAI                 | ❌ — discarded; OpenAI auto-cache only                                                            |
| OpenAI → Gemini                    | ❌ — stripped before Gemini sees                                                                  |
| **OpenAI Chat → Bedrock-Converse** | **❌ silently broken** — `cache_control` lands in `additionalModelRequestFields` (wrong location) |
| OpenAI Chat → Bedrock-Invoke       | ✅ — survives via passthrough envelope into native body                                           |
| Anthropic → Bedrock-Converse       | ❌ — direct adapter never emits `cachePoint` blocks                                               |
| Anthropic → Bedrock-Invoke         | ✅ — true passthrough                                                                             |

### Reasoning continuity (thinking + signature on multi-turn)

| Direction                    | Status                                                    |
| ---------------------------- | --------------------------------------------------------- |
| OpenAI Chat ↔ Anthropic      | ✅ end-to-end via `message.reasoning.signature` extension |
| OpenAI Responses ↔ Anthropic | ❌ — Responses path emits `signature: ''` hard-coded      |
| Anthropic → OpenAI Responses | ❌ — same `signature: ''` bug                             |
| OpenAI/Anthropic → Gemini    | ❌ — `thoughtSignature` not handled anywhere              |
| Anthropic → Bedrock-Converse | ❌ — no `signature_delta` branch on stream                |
| Anthropic → Bedrock-Invoke   | ✅ — verbatim passthrough                                 |

### Structured output (`response_format: json_schema`)

| Direction                      | Status                                                        |
| ------------------------------ | ------------------------------------------------------------- |
| OpenAI Chat → Anthropic        | ✅ via synthetic `__vmx_structured_output__` tool             |
| OpenAI Responses → Anthropic   | ❌ — `text.format` stowed in passthrough but never re-applied |
| Anthropic → OpenAI             | ❌ — `output_config.format` not extracted                     |
| OpenAI → Gemini compat         | ✅ — shim accepts `response_format`                           |
| OpenAI Chat → Bedrock-Converse | ❌ — no equivalent of the synthetic-tool trick                |
| OpenAI Chat → Bedrock-Invoke   | ✅ — synthetic tool flows through native body                 |
| Anthropic → Bedrock-Converse   | ❌                                                            |
| Anthropic → Bedrock-Invoke     | ✅ — passthrough                                              |

### Streaming fidelity

| Direction                      | Status                                                                       |
| ------------------------------ | ---------------------------------------------------------------------------- |
| OpenAI Chat ↔ Anthropic        | ✅                                                                           |
| OpenAI Responses → Anthropic   | ⚠️ — `output: []` shipped on `response.completed`, `signature_delta` dropped |
| Anthropic → OpenAI Responses   | ⚠️ — annotations / refusal / hosted-tool / audio events dropped              |
| OpenAI → Gemini compat         | ✅                                                                           |
| **OpenAI → Gemini native**     | **❌ silently demoted to non-streaming**                                     |
| OpenAI Chat → Bedrock-Converse | ⚠️ — stream converter has no `reasoningContent` branch                       |
| OpenAI Chat → Bedrock-Invoke   | ✅                                                                           |
| Anthropic → Gemini             | ❌ — returns OpenAI ChatCompletion chunks instead of Anthropic SSE           |
| Anthropic → Bedrock-Converse   | ⚠️ — `signature_delta` and `redactedContent` deltas missing                  |
| Anthropic → Bedrock-Invoke     | ✅ — native event-stream forwarded verbatim                                  |

## Known carry-throughs and provider-only fields

Fields that have no portable analogue and only behave correctly inside specific cells. Per the gateway's passthrough policy, the converters do **not** invent translations — these are simply preserved on the cells where the wire shape natively accepts them.

- **Gemini-only request fields** (`googleSearch`, `googleSearchRetrieval`, `urlContext`, `codeExecution`, `fileSearch`) — recognised by the native dispatch path inside [`gemini/shared.ts`](../packages/api/src/ai-provider/gemini/shared.ts) when injected via `vmx.providerArgs`. Stripped on any non-Gemini cell. Native Gemini path is request-narrow + response-narrow + non-streaming; the compat shim ignores them silently.
- **Gemini-only response fields** (`groundingMetadata`, `thoughtSignature`, per-modality token breakdown) — only surfaced when the cell is exercised through the native dispatch shim; lost on the compat passthrough.
- **Perplexity-only request fields** (`search_recency_filter`, `search_domain_filter`, `search_after_date_filter`, `search_before_date_filter`, `return_images`, `return_related_questions`, etc.) — preserved verbatim through the OpenAI-compat passthrough (Chat + Responses cells). Anthropic Messages → Perplexity goes via the Chat compat helper, so the same fields pass through when callers stow them in `vmx.providerArgs` / `passthrough`. Stripped on every non-Perplexity cell.
- **Anthropic server tools** (`web_search_20250305`, `bash_*`, `text_editor_*`, `computer_*`, `code_execution_*`, `memory_*`) — fidelity per direction implemented in [`adapters/anthropic-server-tools.ts`](../packages/api/src/ai-provider/adapters/anthropic-server-tools.ts). Native on Anthropic and Bedrock-Invoke; dropped or transformed everywhere else.
- **Bedrock Converse vs Invoke** — the same model is reachable through two cells with very different fidelity:
  - **Converse** is a structured AWS API. Cell adapts request/response/stream by hand; prompt caching, signature deltas, reasoning deltas, citations, server tools, documents, and several `tool_choice` modes are lossy or dropped.
  - **Invoke** is native Anthropic-Messages over Bedrock's event stream. The Anthropic Messages cell is a true passthrough; the OpenAI Chat/Responses cells run a two-stage convert (OpenAI → Anthropic via the canonical adapter, Anthropic → Invoke via the wire adapter), inheriting Anthropic-cell fidelity.

## Silent bugs

Aggregated and de-duped from all 21 cell audits + the server-tools map:

1. **Bedrock-Converse prompt caching is non-functional** — `cache_control` markers stuffed into `additionalModelRequestFields` instead of emitted as `cachePoint` blocks. Affects every OpenAI→Converse and Anthropic→Converse path. ([aws-bedrock-converse/shared.ts:740-742](../packages/api/src/ai-provider/aws-bedrock-converse/shared.ts#L740-L742))
2. **`signature: ''` hard-coded** in three places — breaks signed-thinking continuity on every Responses-touching conversion. ([openai/anthropic-messages.provider.ts:215-226](../packages/api/src/ai-provider/openai/anthropic-messages.provider.ts#L215-L226), [anthropic/openai-response.provider.ts:264-285](../packages/api/src/ai-provider/anthropic/openai-response.provider.ts#L264-L285), [aws-bedrock-converse/openai-response.provider.ts:271](../packages/api/src/ai-provider/aws-bedrock-converse/openai-response.provider.ts#L271))
3. **Anthropic SSE missing `event:` line** on `/anthropic/messages` — strict SDK parsers don't see typed events. ([gateway/anthropic/anthropic.controller.ts:117](../packages/api/src/gateway/anthropic/anthropic.controller.ts#L117))
4. **Anthropic non-streaming response drops upstream headers** — `filterAnthropicHeaders()` called with no args. ([anthropic/shared.ts:192](../packages/api/src/ai-provider/anthropic/shared.ts#L192))
5. **Gemini native path silently demotes streaming** — `stream: true` returns a non-iterable ChatCompletion. ([gemini/openai-chat-completion.provider.ts:47-59](../packages/api/src/ai-provider/gemini/openai-chat-completion.provider.ts#L47-L59))
6. **Gemini native path is invisible to `vmx.providerArgs`** — caller-injected fields land on the body but `dispatchNativeGemini` only reads a hardcoded subset.
7. **`response.failed` collapsed to `max_tokens`** in Anthropic↔OpenAI Responses converter. ([openai/anthropic-messages.provider.ts:626-629](../packages/api/src/ai-provider/openai/anthropic-messages.provider.ts#L626-L629))
8. **Empty `output[]` on `response.completed`** for both Resp→Converse and Resp→Invoke — final aggregate event ships zero items even though per-item events were emitted.
9. **`reasoning_tokens` silently dropped** on Anthropic→OpenAI response usage extraction.
10. **`tool_choice: 'none'` silently dropped** on Chat→Converse, Resp→Converse, Resp→Invoke, and Anthropic→Converse.
11. **`response_format: json_schema` silently dropped** on Chat→Converse — no synthetic-tool equivalent.
12. **Anthropic-converter `betas` and `mcp_servers` claimed-but-unimplemented** — doc comment lists them as forwarded; no code path captures or sends them.
13. **`thinking` re-emission comment vs. code mismatch** in Anthropic→OpenAI Responses — comment says "BEFORE the assistant message", code pushes to `followUps` (appended after).
14. **OpenAI Chat→Converse stream drops `reasoningContent` deltas** even though non-streaming preserves them.
15. **External-URL images not validated on Anthropic→Invoke** — forwarded as `{type:'url'}` but Bedrock-Invoke rejects URL sources.
16. **`betas[]` field-name mismatch on Anthropic→Bedrock-Invoke** — bytes survive but Bedrock expects `anthropic_beta` (string array), not `betas`.
17. **Resp→Converse silently drops `performanceConfig`** from connection config.

See [task.md](../task.md) for the implementation backlog driven by this matrix.
