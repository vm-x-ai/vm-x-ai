---
sidebar_position: 5
slug: /api/anthropic-messages
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Anthropic Messages

Anthropic's **Messages API** is the canonical client for Claude
features that don't have an OpenAI equivalent — `cache_control` for
prompt caching, extended `thinking`, the full server-tools suite
(`web_search_*`, `code_execution_*`, `bash_*`, `text_editor_*`,
`computer_*`), `service_tier`, `top_k`, and refusal stop details.

Reach for `/anthropic/messages` when:

- Your application already uses `@anthropic-ai/sdk`.
- You want native access to Anthropic-only features without going
  through a passthrough envelope.
- You want every typed streaming event with its `event:` line so you
  can drive an Anthropic-shaped client end-to-end.

## Endpoint

```
POST /v1/completion/{workspaceId}/{environmentId}/anthropic/messages
```

Headers:

```
Content-Type: application/json
Authorization: Bearer <vmx-api-key>
```

Request shape: standard Anthropic Messages body, plus an optional
[`vmx`](./vmx-envelope.md) envelope. Use the **VM-X resource name** in
`model`.

> **`max_tokens` is required.** Unlike OpenAI Chat Completions where
> `max_tokens` is optional, Anthropic always requires it. The gateway
> enforces this at the validation boundary — a request without
> `max_tokens` returns a 400.

## Quick start

<Tabs>
  <TabItem value="python" label="Python (Anthropic SDK)">

```python
import anthropic

client = anthropic.Anthropic(
    api_key="<vmx-api-key>",
    base_url="http://localhost:3000/v1/completion/<workspace>/<environment>/anthropic",
)

message = client.messages.create(
    model="my-resource",
    max_tokens=512,
    messages=[{"role": "user", "content": "Hello!"}],
)

# content is an array of typed blocks (text, tool_use, thinking, …)
for block in message.content:
    if block.type == "text":
        print(block.text)
```

  </TabItem>
  <TabItem value="ts" label="TypeScript (Anthropic SDK)">

```ts
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: '<vmx-api-key>',
  baseURL: 'http://localhost:3000/v1/completion/<workspace>/<environment>/anthropic',
});

const message = await client.messages.create({
  model: 'my-resource',
  max_tokens: 512,
  messages: [{ role: 'user', content: 'Hello!' }],
});

const text = message.content
  .filter((b) => b.type === 'text')
  .map((b) => (b as { text: string }).text)
  .join('');
console.log(text);
```

  </TabItem>
  <TabItem value="curl" label="cURL">

```bash
curl http://localhost:3000/v1/completion/<workspace>/<environment>/anthropic/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <vmx-api-key>" \
  -d '{
    "model": "my-resource",
    "max_tokens": 512,
    "messages": [{"role":"user","content":"Hello!"}]
  }'
```

  </TabItem>
</Tabs>

## Ad-hoc model addressing — `<connection_name>/<model>`

If you don't want to pre-create an AI Resource, pass
`<connection_name>/<model>` in the `model` field. VM-X looks up the
connection by name in this workspace/environment and dispatches
directly to the upstream model on it. Useful for scratch work and
one-off calls that don't need routing or a fallback chain.

<Tabs>
  <TabItem value="python" label="Python (Anthropic SDK)">

```python
# "anthropic-prod" is the AI Connection name; the rest is the
# upstream Anthropic model id verbatim. No resource record required.
message = client.messages.create(
    model="anthropic-prod/claude-3-5-sonnet-20241022",
    max_tokens=512,
    messages=[{"role": "user", "content": "Hello!"}],
)
```

  </TabItem>
  <TabItem value="ts" label="TypeScript (Anthropic SDK)">

```ts
const message = await client.messages.create({
  model: 'anthropic-prod/claude-3-5-sonnet-20241022',
  max_tokens: 512,
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

  </TabItem>
  <TabItem value="curl" label="cURL">

```bash
curl http://localhost:3000/v1/completion/<workspace>/<environment>/anthropic/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <vmx-api-key>" \
  -d '{
    "model": "anthropic-prod/claude-3-5-sonnet-20241022",
    "max_tokens": 512,
    "messages": [{"role":"user","content":"Hello!"}]
  }'
```

  </TabItem>
</Tabs>

The first `/` is the separator; anything after it is the upstream
model id verbatim — so
`bedrock-prod/anthropic.claude-3-5-sonnet-20241022-v2:0` works as you'd
expect on a Bedrock-Invoke connection (including the trailing `:0`).
If no connection of that name exists, VM-X falls back to looking the
literal string up as a resource name, so resource names that
legitimately contain `/` still resolve.

> **Trade-off:** ad-hoc addressing skips the resource layer, which
> means no resource-level routing, fallback, or capacity. Connection-
> level capacity still applies and the request is still audited. For
> routing / fallback / per-resource capacity, define an AI Resource and
> pass its name instead.

## Examples

### Top-level `system` prompt

System prompts go on the **top level** (not inside `messages[]`).

<Tabs>
  <TabItem value="python" label="Python">

```python
message = client.messages.create(
    model="my-resource",
    max_tokens=256,
    system="You are a concise senior engineer.",
    messages=[{"role": "user", "content": "Why are mutexes hard?"}],
)
```

  </TabItem>
  <TabItem value="ts" label="TypeScript">

```ts
const message = await client.messages.create({
  model: 'my-resource',
  max_tokens: 256,
  system: 'You are a concise senior engineer.',
  messages: [{ role: 'user', content: 'Why are mutexes hard?' }],
});
```

  </TabItem>
  <TabItem value="curl" label="cURL">

```bash
curl http://localhost:3000/v1/completion/<workspace>/<environment>/anthropic/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <vmx-api-key>" \
  -d '{
    "model": "my-resource",
    "max_tokens": 256,
    "system": "You are a concise senior engineer.",
    "messages": [{"role":"user","content":"Why are mutexes hard?"}]
  }'
```

  </TabItem>
</Tabs>

### Multi-turn conversation

Like Chat Completions, alternating `user` / `assistant` messages.

<Tabs>
  <TabItem value="python" label="Python">

```python
message = client.messages.create(
    model="my-resource",
    max_tokens=128,
    messages=[
        {"role": "user", "content": "My name is Lucas."},
        {"role": "assistant", "content": "Hello, Lucas."},
        {"role": "user", "content": "What's my name?"},
    ],
)
```

  </TabItem>
  <TabItem value="ts" label="TypeScript">

```ts
const message = await client.messages.create({
  model: 'my-resource',
  max_tokens: 128,
  messages: [
    { role: 'user', content: 'My name is Lucas.' },
    { role: 'assistant', content: 'Hello, Lucas.' },
    { role: 'user', content: "What's my name?" },
  ],
});
```

  </TabItem>
</Tabs>

### Tool use round-trip

Anthropic tools have `name`, `description`, and `input_schema` (JSON
Schema). The model emits a `tool_use` content block; you respond with
a `user` message whose `content` includes a `tool_result` block keyed
by `tool_use_id`.

<Tabs>
  <TabItem value="python" label="Python">

```python
tools = [
    {
        "name": "get_weather",
        "description": "Get the current weather in a city",
        "input_schema": {
            "type": "object",
            "properties": {"location": {"type": "string"}},
            "required": ["location"],
        },
    }
]

# 1. Model emits a tool_use block.
first = client.messages.create(
    model="my-resource",
    max_tokens=512,
    tools=tools,
    tool_choice={"type": "any"},
    messages=[{"role": "user", "content": "Weather in Tokyo?"}],
)

# Find the tool_use block.
tu = next(b for b in first.content if b.type == "tool_use")

# 2. Run the tool locally...
result = {"temp_c": 22, "conditions": "clear"}

# 3. Send the result back as a tool_result on a user turn.
final = client.messages.create(
    model="my-resource",
    max_tokens=512,
    tools=tools,
    messages=[
        {"role": "user", "content": "Weather in Tokyo?"},
        {"role": "assistant", "content": first.content},  # the assistant's full reply
        {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": tu.id,
                    "content": str(result),
                }
            ],
        },
    ],
)
```

  </TabItem>
  <TabItem value="ts" label="TypeScript">

```ts
const tools = [
  {
    name: 'get_weather',
    description: 'Get the current weather in a city',
    input_schema: {
      type: 'object',
      properties: { location: { type: 'string' } },
      required: ['location'],
    },
  },
];

const first = await client.messages.create({
  model: 'my-resource',
  max_tokens: 512,
  tools,
  tool_choice: { type: 'any' },
  messages: [{ role: 'user', content: 'Weather in Tokyo?' }],
});

const tu = first.content.find((b) => b.type === 'tool_use')!;
const result = { temp_c: 22, conditions: 'clear' };

const final = await client.messages.create({
  model: 'my-resource',
  max_tokens: 512,
  tools,
  messages: [
    { role: 'user', content: 'Weather in Tokyo?' },
    { role: 'assistant', content: first.content },
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: (tu as { id: string }).id,
          content: JSON.stringify(result),
        },
      ],
    },
  ],
});
```

  </TabItem>
  <TabItem value="curl" label="cURL">

```bash
curl http://localhost:3000/v1/completion/<workspace>/<environment>/anthropic/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <vmx-api-key>" \
  -d '{
    "model": "my-resource",
    "max_tokens": 512,
    "tools": [{
      "name": "get_weather",
      "description": "Get the current weather in a city",
      "input_schema": {
        "type": "object",
        "properties": {"location": {"type": "string"}},
        "required": ["location"]
      }
    }],
    "tool_choice": {"type": "any"},
    "messages": [{"role":"user","content":"Weather in Tokyo?"}]
  }'
```

  </TabItem>
</Tabs>

`tool_choice` accepts:

- `{ "type": "auto" }` — model decides (default when `tools` is set).
- `{ "type": "any" }` — model must use a tool, but picks which one.
- `{ "type": "tool", "name": "get_weather" }` — force a specific tool.
- `{ "type": "none" }` — model must not use tools. Native Anthropic
  and Bedrock-Invoke pass this through verbatim. On Bedrock-Converse
  (which has no equivalent), VM-X strips the `tools` array from the
  wire body so the model can't call them (T11).

### Prompt caching with `cache_control`

Mark a content block with `cache_control: { type: 'ephemeral' }` so
Anthropic can cache the prefix and skip re-tokenising on subsequent
calls. Cacheable on `system`, `tools`, and `messages`.

<Tabs>
  <TabItem value="python" label="Python">

```python
SYSTEM = "You are answering questions about a single, large document. " * 200

# First call writes the cache. Look at usage.cache_creation_input_tokens.
first = client.messages.create(
    model="my-resource",
    max_tokens=128,
    system=[
        {
            "type": "text",
            "text": SYSTEM,
            "cache_control": {"type": "ephemeral"},
        }
    ],
    messages=[{"role": "user", "content": "Who's it about?"}],
)
print("Wrote:", first.usage.cache_creation_input_tokens)

# Second call hits the cache. Look at usage.cache_read_input_tokens.
second = client.messages.create(
    model="my-resource",
    max_tokens=128,
    system=[
        {
            "type": "text",
            "text": SYSTEM,
            "cache_control": {"type": "ephemeral"},
        }
    ],
    messages=[{"role": "user", "content": "Three keywords?"}],
)
print("Read:", second.usage.cache_read_input_tokens)
```

  </TabItem>
  <TabItem value="ts" label="TypeScript">

```ts
const SYSTEM = 'You are answering questions about a single, large document. '.repeat(200);

const first = await client.messages.create({
  model: 'my-resource',
  max_tokens: 128,
  system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
  messages: [{ role: 'user', content: "Who's it about?" }],
});
console.log('Wrote:', first.usage.cache_creation_input_tokens);

const second = await client.messages.create({
  model: 'my-resource',
  max_tokens: 128,
  system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
  messages: [{ role: 'user', content: 'Three keywords?' }],
});
console.log('Read:', second.usage.cache_read_input_tokens);
```

  </TabItem>
  <TabItem value="curl" label="cURL">

```bash
curl http://localhost:3000/v1/completion/<workspace>/<environment>/anthropic/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <vmx-api-key>" \
  -d '{
    "model": "my-resource",
    "max_tokens": 128,
    "system": [{
      "type": "text",
      "text": "<your long system prompt>",
      "cache_control": {"type": "ephemeral"}
    }],
    "messages": [{"role":"user","content":"Who is it about?"}]
  }'
```

  </TabItem>
</Tabs>

> **Cross-provider caching:** when an Anthropic Messages request lands
> on AWS Bedrock-Converse, VM-X translates `cache_control` blocks to
> Bedrock's `cachePoint` blocks. The cache hit/write tokens come back
> on `usage.cache_creation_input_tokens` / `cache_read_input_tokens`
> in both directions.

### Extended thinking

Set `thinking: { type: 'adaptive' }` on Opus 4.6+ / Sonnet 4.6+ — the
model decides how much to think. For older Claude versions, use
`thinking: { type: 'enabled', budget_tokens: N }` (where
`budget_tokens` < `max_tokens`, minimum 1024).

<Tabs>
  <TabItem value="python" label="Python">

```python
message = client.messages.create(
    model="my-claude-opus-resource",
    max_tokens=4096,
    thinking={"type": "adaptive"},
    messages=[{"role": "user", "content": "Prove there are infinitely many primes."}],
)

# Inspect the thinking block in content[]
for block in message.content:
    if block.type == "thinking":
        print("Thinking:", block.thinking[:200], "…")
    elif block.type == "text":
        print("Final:", block.text)
```

  </TabItem>
  <TabItem value="ts" label="TypeScript">

```ts
const message = await client.messages.create({
  model: 'my-claude-opus-resource',
  max_tokens: 4096,
  thinking: { type: 'adaptive' },
  messages: [{ role: 'user', content: 'Prove there are infinitely many primes.' }],
});

for (const block of message.content) {
  if (block.type === 'thinking') console.log('Thinking:', (block as { thinking: string }).thinking.slice(0, 200), '…');
  if (block.type === 'text') console.log('Final:', (block as { text: string }).text);
}
```

  </TabItem>
  <TabItem value="curl" label="cURL">

```bash
curl http://localhost:3000/v1/completion/<workspace>/<environment>/anthropic/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <vmx-api-key>" \
  -d '{
    "model": "my-claude-opus-resource",
    "max_tokens": 4096,
    "thinking": {"type": "adaptive"},
    "messages": [{"role":"user","content":"Prove there are infinitely many primes."}]
  }'
```

  </TabItem>
</Tabs>

> **`thinking` blocks include a `signature`** that the model uses to
> verify continuity across turns. When you echo a prior assistant
> reply back as a `messages[].content` array, keep the `thinking`
> block (with its `signature`) intact — Anthropic validates it
> server-side.

### Server tools (web search, code execution, …)

Anthropic's hosted tools run on Anthropic's side; you don't implement
the function. Add the tool definition to `tools[]` and the model uses
it autonomously.

<Tabs>
  <TabItem value="python" label="Python (web_search)">

```python
message = client.messages.create(
    model="my-resource",
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

# The response contains web_search_tool_result blocks + text with citations.
```

  </TabItem>
  <TabItem value="ts" label="TypeScript">

```ts
const message = await client.messages.create({
  model: 'my-resource',
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
```

  </TabItem>
  <TabItem value="curl" label="cURL">

```bash
curl http://localhost:3000/v1/completion/<workspace>/<environment>/anthropic/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <vmx-api-key>" \
  -d '{
    "model": "my-resource",
    "max_tokens": 2048,
    "messages": [{"role":"user","content":"Latest TypeScript release? Cite sources."}],
    "tools": [{"type":"web_search_20250305","name":"web_search","max_uses":3}]
  }'
```

  </TabItem>
</Tabs>

See the [web search guide](./web-search.md) for citation handling and the
full provider matrix.

### Streaming — typed events with `event:` lines

Anthropic's stream envelope tags every event with its `event:` name on
its own line, followed by a `data:` JSON frame. VM-X forwards the
exact wire format.

<Tabs>
  <TabItem value="python" label="Python">

```python
with client.messages.stream(
    model="my-resource",
    max_tokens=512,
    messages=[{"role": "user", "content": "Stream a poem."}],
) as stream:
    for text in stream.text_stream:
        print(text, end="", flush=True)
```

  </TabItem>
  <TabItem value="ts" label="TypeScript">

```ts
const stream = await client.messages.stream({
  model: 'my-resource',
  max_tokens: 512,
  messages: [{ role: 'user', content: 'Stream a poem.' }],
});

for await (const event of stream) {
  if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
    process.stdout.write(event.delta.text);
  }
}
```

  </TabItem>
  <TabItem value="curl" label="cURL">

```bash
curl http://localhost:3000/v1/completion/<workspace>/<environment>/anthropic/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <vmx-api-key>" \
  -N -d '{
    "model": "my-resource",
    "max_tokens": 512,
    "messages": [{"role":"user","content":"Stream a poem."}],
    "stream": true
  }'
```

Wire format:

```
event: message_start
data: {"type":"message_start","message":{...}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Roses"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":4}}

event: message_stop
data: {"type":"message_stop"}
```

  </TabItem>
</Tabs>

Mid-stream errors are emitted as a typed `event: error` frame followed
by stream termination — clients consuming with the Anthropic SDK pick
this up automatically.

### `betas` array (beta-feature opt-in)

Anthropic's beta-features header (`anthropic-beta`) takes a
comma-separated list of feature flags. The Anthropic SDK exposes this
as a `betas: string[]` field on the request; VM-X **lifts it off the
body and emits it as the `anthropic-beta` HTTP header** before
dispatching to Anthropic's API (Anthropic's native API rejects `betas`
as a body field — but Bedrock-Invoke accepts it on the body, so VM-X
preserves the body shape and adapts at the wire layer).

<Tabs>
  <TabItem value="python" label="Python">

```python
message = client.messages.create(
    model="my-resource",
    max_tokens=4096,
    thinking={"type": "enabled", "budget_tokens": 2000},
    messages=[{"role": "user", "content": "Reason about this..."}],
    extra_body={"betas": ["interleaved-thinking-2025-05-14"]},
)
```

  </TabItem>
  <TabItem value="ts" label="TypeScript">

```ts
const message = await client.messages.create({
  model: 'my-resource',
  max_tokens: 4096,
  thinking: { type: 'enabled', budget_tokens: 2000 },
  messages: [{ role: 'user', content: 'Reason about this...' }],
  // @ts-expect-error custom extra
  betas: ['interleaved-thinking-2025-05-14'],
});
```

  </TabItem>
  <TabItem value="curl" label="cURL">

```bash
curl http://localhost:3000/v1/completion/<workspace>/<environment>/anthropic/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <vmx-api-key>" \
  -d '{
    "model": "my-resource",
    "max_tokens": 4096,
    "thinking": {"type":"enabled","budget_tokens":2000},
    "messages": [{"role":"user","content":"Reason about this..."}],
    "betas": ["interleaved-thinking-2025-05-14"]
  }'
```

  </TabItem>
</Tabs>

### Attaching `vmx` metadata

<Tabs>
  <TabItem value="python" label="Python">

```python
message = client.messages.create(
    model="my-resource",
    max_tokens=512,
    messages=[{"role": "user", "content": "Summarise: ..."}],
    extra_body={
        "vmx": {
            "correlationId": "summarizer-2026-05-10",
            "metadata": {"team": "growth", "user_id": "u_42"},
            "timeoutMs": 25_000,
        }
    },
)
```

  </TabItem>
  <TabItem value="ts" label="TypeScript">

```ts
const message = await client.messages.create({
  model: 'my-resource',
  max_tokens: 512,
  messages: [{ role: 'user', content: 'Summarise: ...' }],
  // @ts-expect-error custom extra
  vmx: {
    correlationId: 'summarizer-2026-05-10',
    metadata: { team: 'growth', user_id: 'u_42' },
    timeoutMs: 25_000,
  },
});
```

  </TabItem>
  <TabItem value="curl" label="cURL">

```bash
curl http://localhost:3000/v1/completion/<workspace>/<environment>/anthropic/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <vmx-api-key>" \
  -d '{
    "model": "my-resource",
    "max_tokens": 512,
    "messages": [{"role":"user","content":"Summarise: ..."}],
    "vmx": {
      "correlationId": "summarizer-2026-05-10",
      "metadata": {"team": "growth", "user_id": "u_42"},
      "timeoutMs": 25000
    }
  }'
```

  </TabItem>
</Tabs>

## Provider compatibility

| Provider             | Native passthrough? | Notes                                                                                                                                                                                            |
| -------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Anthropic            | ✅ Yes (native)     | True end-to-end passthrough — `cache_control`, `thinking`, server tools, `service_tier`, refusal stop details all round-trip.                                                                    |
| AWS Bedrock-Invoke   | ✅ Yes (native)     | Claude on AWS — same wire shape, plus the Bedrock `anthropic_version` discriminator. External image URLs are rejected up-front (`aws_bedrock_invoke_image_url_unsupported`); use base64 sources. |
| AWS Bedrock-Converse | Convert             | Direct Anthropic↔Converse adapter — `cache_control` → `cachePoint`, server tools mapped to Converse equivalents where supported.                                                                 |
| OpenAI               | Convert (D5)        | Direct Anthropic↔Responses adapter (no internal pivot through Chat Completions). `thinking` → `reasoning.effort`, `tool_use` → `function_call`.                                                  |
| Gemini               | Convert             | Via Chat Completions on Google's OpenAI-compat endpoint.                                                                                                                                         |
| Groq                 | Convert             | Via Chat Completions.                                                                                                                                                                            |
| Perplexity           | Convert             | Via Chat Completions.                                                                                                                                                                            |

For the per-pair conversion details (which Anthropic fields survive
each conversion path), see the
[conversion matrix](https://github.com/vm-x-ai/vm-x-ai/blob/main/contributing-docs/conversion-matrix.md).

## Errors

See the [endpoint overview](./index.md#errors) for the full error catalog.
On streaming, the gateway emits a typed `event: error` frame
(`event: error\ndata: { "error": {...} }\n\n`) and terminates the
stream — there is no trailing `[DONE]` sentinel; Anthropic's SDK
`MessageStream` picks the `error` event up by name. Long-running
streams also receive periodic `event: ping` heartbeats every ~10s
(T3) so idle proxies don't close the connection during slow tool use.

The gateway maps Anthropic's `anthropic-ratelimit-*` response headers
to OpenAI's `x-ratelimit-*` shape so your rate-limit accounting code
doesn't need to know which provider it just talked to.

## Next steps

- [Web search](./web-search.md) — Anthropic's `web_search_20250305` server tool + the cross-provider matrix
- [VM-X envelope](./vmx-envelope.md) — `correlationId`, `metadata`, `providerArgs`, …
- [Chat Completions](./chat-completions.md) — when you don't need Anthropic-specific features
- [Anthropic provider config](../../integrations/providers/anthropic.md) — connection-level settings
