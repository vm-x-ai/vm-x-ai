# Cross-format conversion support matrix

Reference for what survives each request/response conversion path between the gateway's three input formats (OpenAI Chat Completions, OpenAI Responses, Anthropic Messages) and each provider's wire shape.

Generated 2026-05-09 from a six-pair audit of the converter chains under `packages/api/src/ai-provider/`. Re-run that audit when the converters change.

Legend: ✅ supported · ⚠️ partial / lossy · ❌ silently dropped or rejected.

## Conversion overview

Each direction's "primary path" is the converter file most clients hit. OpenAI direction means OpenAI Chat OR OpenAI Responses input — sub-rows flag where they diverge.

| Conversion              | Primary file(s)                                                                                                                                                                                                                                                                                                                                                                 | Overall fidelity                                                      | Direction's biggest hazard                                                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OpenAI → Anthropic**  | [adapters/anthropic-messages.adapter.ts](../packages/api/src/ai-provider/adapters/anthropic-messages.adapter.ts) (Chat) · [anthropic/openai-response.provider.ts](../packages/api/src/ai-provider/anthropic/openai-response.provider.ts) (Responses)                                                                                                                            | Chat ⚠️ / Responses ❌                                                | Responses path **never reads `__vmx_passthrough`** → cache_control / top_k / service_tier / metadata / container / server_tools / structured_output all dropped                              |
| **Anthropic → OpenAI**  | [openai/anthropic-messages.provider.ts](../packages/api/src/ai-provider/openai/anthropic-messages.provider.ts) (active — direct Responses adapter)                                                                                                                                                                                                                              | ⚠️                                                                    | All Anthropic-schema client tools (bash/text_editor/computer/memory) and all server-hosted tools dropped at `if (!('input_schema' in t)) return null`                                        |
| **OpenAI → Gemini**     | [gemini/openai-chat-completion.provider.ts](../packages/api/src/ai-provider/gemini/openai-chat-completion.provider.ts) (compat default) · [gemini/native.helpers.ts](../packages/api/src/ai-provider/gemini/native.helpers.ts) (native, only on `googleSearch`/`urlContext`/`codeExecution`/`fileSearch`/`googleSearchRetrieval`)                                               | Compat ✅ / Native ❌                                                 | Native path is request-narrow + response-narrow + no streaming — only exists to surface `groundingMetadata`                                                                                  |
| **OpenAI → Bedrock**    | [aws-bedrock-converse/shared.ts](../packages/api/src/ai-provider/aws-bedrock-converse/shared.ts) (Chat→Converse, ~1100 LOC) · [aws-bedrock-converse/openai-response.provider.ts](../packages/api/src/ai-provider/aws-bedrock-converse/openai-response.provider.ts) (Resp→Converse) · [aws-bedrock-invoke/](../packages/api/src/ai-provider/aws-bedrock-invoke/) (both → Invoke) | Chat→Converse ⚠️ / Resp→Converse ❌ / Chat→Invoke ⚠️ / Resp→Invoke ❌ | Converse prompt caching is **non-functional** (markers go in `additionalModelRequestFields` instead of `cachePoint` blocks)                                                                  |
| **Anthropic → Gemini**  | [gemini/anthropic-messages.provider.ts](../packages/api/src/ai-provider/gemini/anthropic-messages.provider.ts) (pivots via Chat)                                                                                                                                                                                                                                                | ❌                                                                    | Native Gemini path **unreachable** from Anthropic input (server tools stripped before divert sees them); streaming returns OpenAI chunks not Anthropic SSE                                   |
| **Anthropic → Bedrock** | [aws-bedrock-converse/anthropic-messages.provider.ts](../packages/api/src/ai-provider/aws-bedrock-converse/anthropic-messages.provider.ts) (Converse direct adapter) · [aws-bedrock-invoke/anthropic-messages.provider.ts](../packages/api/src/ai-provider/aws-bedrock-invoke/anthropic-messages.provider.ts) (true passthrough)                                                | Converse ❌ / Invoke ✅                                               | Converse direct adapter ignores `cache_control` (no `cachePoint`), `redacted_thinking`, server tools, documents, citations, signature deltas — Invoke is a real passthrough so it just works |

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

## Silent bugs

Aggregated and de-duped from all six audits:

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
