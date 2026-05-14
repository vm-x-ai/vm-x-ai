---
sidebar_position: 6
slug: /api/web-search
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Web search

Web search is a **tool**, not an endpoint. All three completion
endpoints — `/chat/completions`, `/responses`, and
`/anthropic/messages` — can carry a web-search tool, but the wire
shape and the citation format differ per provider.

This page maps each `(provider, endpoint)` cell to the tool descriptor
you send and the citation field you read back.

## Provider × Endpoint matrix

| Provider       | Chat Completions                                                                                      | Responses                                                                                                                                                                            | Anthropic Messages                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| **OpenAI**     | `gpt-*-search-*` model (search baked in) + optional `web_search_options`                              | `tools: [{ type: "web_search" }]` (canonical; `web_search_preview` still accepted)                                                                                                   | n/a — pick a non-search OpenAI model; the converter routes through Responses         |
| **Anthropic**  | (converts via Anthropic Messages adapter)                                                             | `tools: [{ type: "web_search" }]` — adapter maps `web_search_20250305 → web_search` for the Responses-via-Anthropic path                                                             | `tools: [{ type: "web_search_20250305", name: "web_search" }]`                       |
| **Gemini**     | `tools: [{ googleSearch: {} }]` _or_ `web_search_options` (both auto-route to native `@google/genai`) | `tools: [{ type: "web_search" }]` → mapped to `{googleSearch:{}}`; `filters.search_recency_filter` → `googleSearch.timeRangeFilter`                                                  | `tools: [{ type: "web_search_20250305", name: "web_search" }]` → `{googleSearch:{}}` |
| **Perplexity** | built-in on every model — no tool descriptor needed; tune via top-level `search_*_filter` fields      | `tools: [{ type: "web_search", filters: { search_recency_filter, search_domain_filter } }]` — the adapter renames `web_search_preview → web_search` and preserves `filters` verbatim | (converts via Chat Completions)                                                      |

> **OpenAI Chat-Completions-only search models are blocked on Responses + Anthropic.** > `gpt-5-search-api`, `gpt-4o-search-preview`, and
> `gpt-4o-mini-search-preview` have web search baked into the model and
> only work on Chat Completions. The playground's `/api/responses` and
> `/api/anthropic` BFF routes hard-stop these with HTTP `400` > `{ error: { code: "model_endpoint_mismatch" } }` (see
> `packages/ui/src/app/api/_lib/openai-model-quirks.ts`). Direct API
> callers driving the gateway from outside the playground get the raw
> upstream error — pick a non-search model and add
> `tools: [{ type: "web_search" }]` instead.

## Where citations land

| Provider   | Endpoint           | Citation location                                                                                                                                             |
| ---------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI     | Chat Completions   | `choices[0].message.annotations[]` with `type: 'url_citation'`                                                                                                |
| OpenAI     | Responses          | `output[].content[].annotations[]` with `type: 'url_citation'`                                                                                                |
| Anthropic  | Anthropic Messages | `content[]` includes a `web_search_tool_result` block; subsequent `text` blocks carry `citations[]`                                                           |
| Gemini     | (any)              | `choices[0].message.grounding_metadata` (camelCase: `searchEntryPoint`, `groundingChunks[]`, `groundingSupports[]`) — forwarded verbatim from `@google/genai` |
| Perplexity | Chat Completions   | `citations[]` on the top-level response object (one entry per cited URL)                                                                                      |

## OpenAI — Chat Completions (`gpt-*-search-preview`)

OpenAI's Chat Completions web search is a **model variant**, not a
tool. Use a `*-search-preview` model name and (optionally) configure
recency / context size via `web_search_options`.

<Tabs>
  <TabItem value="python" label="Python">

```python
response = client.chat.completions.create(
    model="my-search-resource",  # resolves to e.g. gpt-4o-mini-search-preview
    messages=[
        {"role": "user", "content": "What's the latest TypeScript release?"},
    ],
    web_search_options={"search_context_size": "medium"},
)

# Inspect annotations on the assistant message.
for ann in response.choices[0].message.annotations or []:
    if ann["type"] == "url_citation":
        print(ann["url_citation"]["url"], ann["url_citation"]["title"])
```

  </TabItem>
  <TabItem value="ts" label="TypeScript">

```ts
const response = await client.chat.completions.create({
  model: 'my-search-resource',
  messages: [{ role: 'user', content: "What's the latest TypeScript release?" }],
  // @ts-expect-error web_search_options is preview-model only
  web_search_options: { search_context_size: 'medium' },
});

for (const ann of response.choices[0].message.annotations ?? []) {
  if (ann.type === 'url_citation') {
    console.log(ann.url_citation.url, ann.url_citation.title);
  }
}
```

  </TabItem>
  <TabItem value="curl" label="cURL">

```bash
curl http://localhost:3030/api/v1/completion/<workspace>/<environment>/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <vmx-api-key>" \
  -d '{
    "model": "my-search-resource",
    "messages": [{"role":"user","content":"Latest TypeScript release?"}],
    "web_search_options": {"search_context_size": "medium"}
  }'
```

  </TabItem>
</Tabs>

## OpenAI — Responses

On the Responses endpoint, web search is a **hosted tool**. Add
`{ type: 'web_search' }` to `tools[]` — the current canonical name.
The legacy `web_search_preview` still works, but new integrations
should use `web_search`. Pin the resource to a search-capable
non-search-only model (e.g. `gpt-5`, `gpt-4.1`); the three
search-baked-in models (`gpt-5-search-api`, `gpt-4o-search-preview`,
`gpt-4o-mini-search-preview`) are **Chat-Completions-only** and the
BFF rejects them upfront with `model_endpoint_mismatch` rather than
letting OpenAI return its less-helpful upstream error.

<Tabs>
  <TabItem value="python" label="Python">

```python
response = client.responses.create(
    model="my-resource",
    input="Latest TypeScript release? Cite sources.",
    tools=[{"type": "web_search"}],
)

# Citations attach to text content parts inside output[].
for item in response.output:
    if item.type != "message":
        continue
    for part in item.content:
        if part.type == "output_text":
            for ann in (part.annotations or []):
                if ann["type"] == "url_citation":
                    print(ann["url_citation"]["url"])
```

  </TabItem>
  <TabItem value="ts" label="TypeScript">

```ts
const response = await client.responses.create({
  model: 'my-resource',
  input: 'Latest TypeScript release? Cite sources.',
  tools: [{ type: 'web_search' }],
});

for (const item of response.output) {
  if (item.type !== 'message') continue;
  for (const part of item.content) {
    if (part.type !== 'output_text') continue;
    for (const ann of (part as { annotations?: { type: string; url_citation?: { url: string } }[] }).annotations ?? []) {
      if (ann.type === 'url_citation') console.log(ann.url_citation?.url);
    }
  }
}
```

  </TabItem>
  <TabItem value="curl" label="cURL">

```bash
curl http://localhost:3030/api/v1/completion/<workspace>/<environment>/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <vmx-api-key>" \
  -d '{
    "model": "my-resource",
    "input": "Latest TypeScript release? Cite sources.",
    "tools": [{"type":"web_search"}]
  }'
```

  </TabItem>
</Tabs>

## Anthropic — Anthropic Messages

Anthropic's web search is a **server tool** — the model invokes it
autonomously without a function definition. Cap the number of searches
per call with `max_uses`.

<Tabs>
  <TabItem value="python" label="Python (Anthropic SDK)">

```python
import anthropic

client = anthropic.Anthropic(
    api_key="<vmx-api-key>",
    base_url="http://localhost:3030/api/v1/completion/<workspace>/<environment>/anthropic",
)

message = client.messages.create(
    model="my-claude-resource",
    max_tokens=2048,
    messages=[{"role": "user", "content": "Latest TypeScript release? Cite sources."}],
    tools=[
        {
            "type": "web_search_20250305",
            "name": "web_search",
            "max_uses": 3,
        }
    ],
)

# The response contains web_search_tool_result blocks plus text blocks
# whose `citations[]` reference the search results.
for block in message.content:
    if block.type == "text":
        for citation in (block.citations or []):
            print(citation["url"], "—", citation.get("title"))
```

  </TabItem>
  <TabItem value="ts" label="TypeScript">

```ts
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: '<vmx-api-key>',
  baseURL: 'http://localhost:3030/api/v1/completion/<workspace>/<environment>/anthropic',
});

const message = await client.messages.create({
  model: 'my-claude-resource',
  max_tokens: 2048,
  messages: [{ role: 'user', content: 'Latest TypeScript release? Cite sources.' }],
  tools: [
    {
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: 3,
    },
  ],
});

for (const block of message.content) {
  if (block.type === 'text') {
    for (const citation of (block as { citations?: { url: string; title?: string }[] }).citations ?? []) {
      console.log(citation.url, '—', citation.title);
    }
  }
}
```

  </TabItem>
  <TabItem value="curl" label="cURL">

```bash
curl http://localhost:3030/api/v1/completion/<workspace>/<environment>/anthropic/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <vmx-api-key>" \
  -d '{
    "model": "my-claude-resource",
    "max_tokens": 2048,
    "messages": [{"role":"user","content":"Latest TypeScript release? Cite sources."}],
    "tools": [{
      "type": "web_search_20250305",
      "name": "web_search",
      "max_uses": 3
    }]
  }'
```

  </TabItem>
</Tabs>

### Cross-endpoint: Anthropic web search via `/responses`

You can also use Anthropic's web search through the `/responses`
endpoint. VM-X carries the Anthropic-only tool descriptor on the
private `__vmx_passthrough.anthropic.server_tools` envelope through
the conversion path, so the request reaches the Anthropic provider
unchanged.

<Tabs>
  <TabItem value="python" label="Python">

```python
response = client.responses.create(
    model="my-claude-resource",
    input="Latest TypeScript release? Cite sources.",
    extra_body={
        "__vmx_passthrough": {
            "anthropic": {
                "server_tools": [
                    {
                        "type": "web_search_20250305",
                        "name": "web_search",
                        "max_uses": 3,
                    }
                ]
            }
        }
    },
)
```

  </TabItem>
</Tabs>

For most use cases, **prefer `/anthropic/messages` directly** when
you need Anthropic web search — it's clearer and avoids the
passthrough plumbing.

## Gemini — `googleSearch`

Gemini's `googleSearch` is a **Gemini-only tool** that Google's
OpenAI-compat endpoint rejects. VM-X auto-routes any request carrying
a `googleSearch`/`googleSearchRetrieval`/`urlContext`/`codeExecution`/`fileSearch`
tool — or the portable `web_search_options` knob — to Google's native
`@google/genai` SDK, then maps the response back to the OpenAI Chat
Completions / Responses / Anthropic Messages shape your client expects.

What the per-format adapters map onto `googleSearch` for you:

| Surface            | Input tool descriptor                                          | Mapped to                                                                                                                                         |
| ------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat Completions   | `tools: [{ googleSearch: {} }]` or `web_search_options: {}`    | `{googleSearch: {}}` (native)                                                                                                                     |
| Responses          | `tools: [{ type: 'web_search' \| 'web_search_preview' }]`      | `{googleSearch: {}}`; `filters.search_recency_filter` (`hour`/`day`/`week`/`month`/`year`) lifts to `googleSearch.timeRangeFilter`                |
| Anthropic Messages | `tools: [{ type: 'web_search_20250305', name: 'web_search' }]` | `{googleSearch: {}}` (Anthropic's `user_location` / `allowed_domains` / `blocked_domains` / `max_uses` have no Gemini equivalent and are dropped) |

The rest of the OpenAI web-search subfields don't have a Gemini-API
equivalent and are silently dropped: `user_location`,
`filters.allowed_domains`, `filters.blocked_domains`, and
`filters.search_domain_filter`. `excludeDomains` exists on Google's
`GoogleSearch` interface but is Vertex-AI-only, and `GeminiConnectionConfig`
only supports the Gemini API today.

If you need any of those native knobs, see [Gemini-native passthrough](#gemini-native-passthrough)
below.

Grounding metadata lands on `vertex_ai_grounding_metadata` (top-level
on the response object **and** mirrored on the message object for
clients that read either) plus `grounding_metadata` with the verbatim
camelCase fields (`searchEntryPoint`, `groundingChunks[]`,
`groundingSupports[]`) forwarded from `@google/genai`.

<Tabs>
  <TabItem value="python" label="Python (OpenAI SDK)">

```python
response = client.chat.completions.create(
    model="my-gemini-resource",
    messages=[
        {"role": "user", "content": "Latest news about Anthropic from this week?"},
    ],
    tools=[{"googleSearch": {}}],
)

# Grounding metadata lands on the assistant message as `grounding_metadata`,
# forwarded verbatim from @google/genai. Field names are camelCase.
msg = response.choices[0].message.model_dump()
grounding = msg.get("grounding_metadata") or {}
for chunk in grounding.get("groundingChunks", []):
    print(chunk.get("web", {}).get("uri"), "—", chunk.get("web", {}).get("title"))

# `groundingSupports[]` ties each cited segment of the assistant text
# back to the grounding chunk indices, e.g.:
#   { "segment": { "startIndex": 80, "endIndex": 197, "text": "…" },
#     "groundingChunkIndices": [0, 1] }
for support in grounding.get("groundingSupports", []):
    seg = support.get("segment", {})
    print(seg.get("startIndex"), seg.get("endIndex"), support.get("groundingChunkIndices"))
```

  </TabItem>
  <TabItem value="ts" label="TypeScript">

```ts
const response = await client.chat.completions.create({
  model: 'my-gemini-resource',
  messages: [{ role: 'user', content: 'Latest news about Anthropic from this week?' }],
  // @ts-expect-error Gemini-only tool descriptor
  tools: [{ googleSearch: {} }],
});

type GroundingMetadata = {
  searchEntryPoint?: { renderedContent?: string };
  groundingChunks?: { web?: { uri: string; title?: string } }[];
  groundingSupports?: {
    segment?: { startIndex?: number; endIndex?: number; text?: string };
    groundingChunkIndices?: number[];
  }[];
};

const msg = response.choices[0].message as unknown as {
  grounding_metadata?: GroundingMetadata;
};
const grounding = msg.grounding_metadata;

for (const chunk of grounding?.groundingChunks ?? []) {
  console.log(chunk.web?.uri, '—', chunk.web?.title);
}
```

  </TabItem>
  <TabItem value="curl" label="cURL">

```bash
curl http://localhost:3030/api/v1/completion/<workspace>/<environment>/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <vmx-api-key>" \
  -d '{
    "model": "my-gemini-resource",
    "messages": [{"role":"user","content":"Latest news about Anthropic from this week?"}],
    "tools": [{"googleSearch": {}}]
  }'
```

  </TabItem>
</Tabs>

### Gemini-native passthrough

Anything in `tools[]` whose object key matches a Gemini-native tool
(`googleSearch`, `googleSearchRetrieval`, `urlContext`,
`codeExecution`, `fileSearch`, `computerUse`, `mcpServer`,
`googleMaps`, `retrieval`, `functionDeclarations`) is detected by
`isGeminiNativeTool` and forwarded **verbatim** to `@google/genai` —
the cross-format mapping above is skipped entirely. Use this when you
need a Gemini-API knob the OpenAI-shape adapter can't express (e.g.
an explicit `timeRangeFilter` start/end window):

```python
response = client.responses.create(
    model="my-gemini-resource",
    input="What changed in TypeScript last month?",
    extra_body={
        "vmx": {
            "providerArgs": {
                "tools": [
                    {
                        "googleSearch": {
                            "timeRangeFilter": {
                                "startTime": "2026-04-14T00:00:00Z",
                                "endTime":   "2026-05-14T00:00:00Z",
                            }
                        }
                    }
                ]
            }
        }
    },
)
```

The orchestrator merges `vmx.providerArgs` into the top-level wire
body before per-format dispatch (`providerArgs` wins over both
`defaultArgs` and the raw request body), so this works on Chat
Completions, Responses, and Anthropic Messages alike — the native
entry survives the converter and the rest of `tools[]` is dropped or
preserved based on whether the converter recognises it.

> **Native path quirks:** the Gemini native dispatch drops a few
> features the OpenAI-compat path supports (multi-modal parts,
> function-tool round-trips, `responseSchema`). Keep `googleSearch`
> calls free of those features, or call without `googleSearch` first
> and re-issue with it.

## Perplexity — built-in

Perplexity searches the web on every request — on **Chat Completions**
there's no tool descriptor to send; on **Responses** you do attach
`tools: [{ type: 'web_search' }]` (Perplexity's wire shape) and can
nest per-tool knobs under `filters`. Cited sources land on the
top-level `citations[]` array either way.

### Chat Completions — tune via `vmx.providerArgs`

| `vmx.providerArgs` field    | Effect                                                                    |
| --------------------------- | ------------------------------------------------------------------------- |
| `search_recency_filter`     | `'day' \| 'week' \| 'month' \| 'year'` — recency cap on retrieved sources |
| `search_domain_filter`      | `string[]` — allow-list of domains                                        |
| `search_after_date_filter`  | `'YYYY-MM-DD'` — only retrieve sources after this date                    |
| `search_before_date_filter` | `'YYYY-MM-DD'` — only retrieve sources before this date                   |

### Responses — `tools[].filters`

On Perplexity's Responses-compatible endpoint, the same knobs nest
under each search-tool entry's `filters` object. The
`PerplexityResponseProvider` rewrites OpenAI-canonical
`web_search_preview` → Perplexity-canonical `web_search` and preserves
the entire `filters` block verbatim:

```python
response = client.responses.create(
    model="my-perplexity-resource",
    input="Latest TypeScript release?",
    tools=[
        {
            "type": "web_search",
            "filters": {
                "search_domain_filter": ["github.com", "typescriptlang.org"],
                "search_recency_filter": "week",
            },
        }
    ],
)
```

<Tabs>
  <TabItem value="python" label="Python">

```python
response = client.chat.completions.create(
    model="my-perplexity-resource",
    messages=[{"role": "user", "content": "Latest TypeScript release?"}],
    extra_body={
        "vmx": {
            "providerArgs": {
                "search_recency_filter": "week",
                "search_domain_filter": ["github.com", "typescriptlang.org"],
            }
        }
    },
)

# `citations` is a top-level field on Perplexity's Chat Completions response.
for url in getattr(response, "citations", []) or []:
    print(url)
```

  </TabItem>
  <TabItem value="ts" label="TypeScript">

```ts
const response = await client.chat.completions.create({
  model: 'my-perplexity-resource',
  messages: [{ role: 'user', content: 'Latest TypeScript release?' }],
  // @ts-expect-error vmx envelope
  vmx: {
    providerArgs: {
      search_recency_filter: 'week',
      search_domain_filter: ['github.com', 'typescriptlang.org'],
    },
  },
});

for (const url of (response as unknown as { citations?: string[] }).citations ?? []) {
  console.log(url);
}
```

  </TabItem>
  <TabItem value="curl" label="cURL">

```bash
curl http://localhost:3030/api/v1/completion/<workspace>/<environment>/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <vmx-api-key>" \
  -d '{
    "model": "my-perplexity-resource",
    "messages": [{"role":"user","content":"Latest TypeScript release?"}],
    "vmx": {
      "providerArgs": {
        "search_recency_filter": "week",
        "search_domain_filter": ["github.com", "typescriptlang.org"]
      }
    }
  }'
```

  </TabItem>
</Tabs>

## Practical tips

1. **Phrase the prompt to elicit the tool.** Models won't call web
   search on questions they can answer from training data. Time-sensitive
   prompts ("today's", "this week's", "latest version of …") fire it
   reliably.
2. **`max_uses` (Anthropic) caps cost.** Without it, the model can run
   multiple searches in a single response. Start at `3` and tune.
3. **Citations vs grounding metadata.** OpenAI and Anthropic emit
   per-text-span citations; Gemini emits grounding metadata at the
   message/response level (one block referencing all sources). Treat
   them as functionally equivalent for source-attribution UIs.
4. **Streaming.** OpenAI Chat-Completions search-preview models stream
   the same as any other Chat Completions request. Anthropic streams
   web-search tool use as `content_block_start` / `content_block_delta`
   events on `web_search_tool_result` blocks. Gemini's `googleSearch`
   now streams natively via `generateContentStream` — both the
   OpenAI-compat path and the Responses path emit SSE chunks the same
   way as a non-search request.
5. **vmx audit.** Search-driven calls show up in the Audit page like
   any other call; the resolved provider/model is on
   `x-vmx-provider` / `x-vmx-model`, and per-call recency / domain
   filters that you set via `vmx.providerArgs` round-trip into
   `providerRequestPayload` so the audit row reflects the real wire
   request.

## Next steps

- [Chat Completions](./chat-completions.md) — full Chat Completions reference
- [Responses](./responses.md) — typed-event streaming + reasoning
- [Anthropic Messages](./anthropic-messages.md) — full Anthropic Messages reference
- [VM-X envelope](./vmx-envelope.md) — `providerArgs` deep dive (Perplexity recency, etc.)
