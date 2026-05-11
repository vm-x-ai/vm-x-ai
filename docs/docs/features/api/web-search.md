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

| Provider       | Chat Completions                                                      | Responses                             | Anthropic Messages                                             |
| -------------- | --------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------- |
| **OpenAI**     | `gpt-*-search-preview` model + `web_search_options`                   | `tools: [{ type: "web_search" }]`     | n/a (route via Responses or use Anthropic provider)            |
| **Anthropic**  | `tools: [{ type: "web_search_20250305", name: "web_search" }]`        | (converts via Responses-side adapter) | `tools: [{ type: "web_search_20250305", name: "web_search" }]` |
| **Gemini**     | `tools: [{ googleSearch: {} }]` (auto-routes to native @google/genai) | (converts via Chat Completions)       | (converts via Chat Completions)                                |
| **Perplexity** | built-in (every Perplexity model) — no tool descriptor needed         | (converts via Chat Completions)       | (converts via Chat Completions)                                |

> **Streaming + Gemini googleSearch:** the native @google/genai path
> doesn't yet wire streaming for googleSearch requests. VM-X returns a
> clean `400` (`gemini_native_streaming_unsupported`) if you set
> `stream: true` together with a `googleSearch` tool — drop streaming
> on those calls until the native path covers it.

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
curl http://localhost:3000/v1/completion/<workspace>/<environment>/chat/completions \
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
`{ type: 'web_search' }` to `tools[]`. Pin the resource to a
search-capable Responses model (OpenAI lists which models support the
tool); routes that resolve to OpenAI-compat upstreams without hosted
tool support (Gemini / Groq / Perplexity) get a clean
`400 responses_unsupported_tool_type` from the per-provider dispatch.

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
curl http://localhost:3000/v1/completion/<workspace>/<environment>/responses \
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
    base_url="http://localhost:3000/v1/completion/<workspace>/<environment>/anthropic",
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
  baseURL: 'http://localhost:3000/v1/completion/<workspace>/<environment>/anthropic',
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
curl http://localhost:3000/v1/completion/<workspace>/<environment>/anthropic/messages \
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
tool to Google's native `@google/genai` SDK, then maps the response
back to the OpenAI Chat Completions / Responses / Anthropic Messages
shape your client expects.

Grounding metadata lands on `vertex_ai_grounding_metadata` (top-level
on the response object **and** mirrored on the message object for
clients that read either).

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
curl http://localhost:3000/v1/completion/<workspace>/<environment>/chat/completions \
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

> **Native path quirks:** the Gemini native dispatch drops a few
> features the OpenAI-compat path supports (multi-modal parts,
> function-tool round-trips, `responseSchema`). Keep `googleSearch`
> calls free of those features, or call without `googleSearch` first
> and re-issue with it. See [`gemini/native.helpers.ts`](https://github.com/vm-x-ai/vm-x-ai/blob/main/packages/api/src/ai-provider/gemini/native.helpers.ts)
> for the full supported subset.

## Perplexity — built-in

Perplexity searches the web on every request — there's no tool
descriptor to send. Cited sources land on the top-level `citations[]`
array; tune the search via `vmx.providerArgs`:

| `vmx.providerArgs` field    | Effect                                                                    |
| --------------------------- | ------------------------------------------------------------------------- |
| `search_recency_filter`     | `'day' \| 'week' \| 'month' \| 'year'` — recency cap on retrieved sources |
| `search_domain_filter`      | `string[]` — allow-list of domains                                        |
| `search_after_date_filter`  | `'YYYY-MM-DD'` — only retrieve sources after this date                    |
| `search_before_date_filter` | `'YYYY-MM-DD'` — only retrieve sources before this date                   |

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
curl http://localhost:3000/v1/completion/<workspace>/<environment>/chat/completions \
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
   events on `web_search_tool_result` blocks. Gemini's googleSearch
   path is non-streaming today (T5 — clean 400 if you set
   `stream: true`).
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
