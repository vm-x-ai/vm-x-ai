---
sidebar_position: 4
slug: /api/responses
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Responses

OpenAI's **Responses API** is a typed-event interface for agentic
loops. It uses `input` (string or array of items) instead of
`messages`, ships a typed event stream where every event has its own
`event:` line, and adds first-class support for reasoning, hosted
tools, and `instructions` as a system-prompt field.

Reach for `/responses` when:

- You're using OpenAI's agentic SDK (`client.responses.create`).
- You need typed event streaming with named events
  (`response.output_text.delta`, `response.completed`, …).
- You want OpenAI's hosted tools — `web_search`, `code_interpreter`,
  `file_search`, `computer_use`.
- You're using reasoning effort (`reasoning: { effort: '...' }`) on
  o-series or Opus models.

## Endpoint

```
POST /v1/completion/{workspaceId}/{environmentId}/responses
```

Headers:

```
Content-Type: application/json
Authorization: Bearer <vmx-api-key>
```

Request shape: standard OpenAI Responses body, plus an optional
[`vmx`](./vmx-envelope.md) envelope. Use the **VM-X resource name** in
`model`.

## Quick start

<Tabs>
  <TabItem value="python" label="Python (OpenAI SDK)">

```python
from openai import OpenAI

client = OpenAI(
    api_key="<vmx-api-key>",
    base_url="http://localhost:3030/api/v1/completion/<workspace>/<environment>",
)

response = client.responses.create(
    model="my-resource",
    input="Hello!",
    instructions="Be concise.",
)

# Pull the assistant text out of the typed `output[]`.
for item in response.output:
    if item.type == "message":
        for part in item.content:
            if part.type == "output_text":
                print(part.text)
```

  </TabItem>
  <TabItem value="ts" label="TypeScript (OpenAI SDK)">

```ts
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: '<vmx-api-key>',
  baseURL: 'http://localhost:3030/api/v1/completion/<workspace>/<environment>',
});

const response = await client.responses.create({
  model: 'my-resource',
  input: 'Hello!',
  instructions: 'Be concise.',
});

const text = response.output
  .filter((o) => o.type === 'message')
  .flatMap((o) => o.content)
  .filter((c) => c.type === 'output_text')
  .map((c) => (c as { text: string }).text)
  .join('');
console.log(text);
```

  </TabItem>
  <TabItem value="curl" label="cURL">

```bash
curl http://localhost:3030/api/v1/completion/<workspace>/<environment>/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <vmx-api-key>" \
  -d '{
    "model": "my-resource",
    "input": "Hello!",
    "instructions": "Be concise."
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
  <TabItem value="python" label="Python (OpenAI SDK)">

```python
# "openai-prod" is the AI Connection name; "gpt-4o-mini" is the
# upstream OpenAI model id. No resource record required.
response = client.responses.create(
    model="openai-prod/gpt-4o-mini",
    input="Hello!",
)
```

  </TabItem>
  <TabItem value="ts" label="TypeScript (OpenAI SDK)">

```ts
const response = await client.responses.create({
  model: 'openai-prod/gpt-4o-mini',
  input: 'Hello!',
});
```

  </TabItem>
  <TabItem value="curl" label="cURL">

```bash
curl http://localhost:3030/api/v1/completion/<workspace>/<environment>/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <vmx-api-key>" \
  -d '{
    "model": "openai-prod/gpt-4o-mini",
    "input": "Hello!"
  }'
```

  </TabItem>
</Tabs>

The first `/` is the separator; anything after it is the upstream
model id verbatim — so
`bedrock-prod/anthropic.claude-3-5-sonnet-20241022-v2:0` works as you'd
expect, including the trailing `:0`. If no connection of that name
exists, VM-X falls back to looking the literal string up as a resource
name, so resource names that legitimately contain `/` still resolve.

> **Trade-off:** ad-hoc addressing skips the resource layer, which
> means no resource-level routing, fallback, or capacity. Connection-
> level capacity still applies and the request is still audited. For
> routing / fallback / per-resource capacity, define an AI Resource and
> pass its name instead.

## Shape primer — what's different from Chat Completions

| Field             | Chat Completions        | Responses                                                                 |
| ----------------- | ----------------------- | ------------------------------------------------------------------------- |
| Conversation      | `messages[]`            | `input` (string or `input[]` of typed items)                              |
| System prompt     | `messages[role:system]` | `instructions` (top-level)                                                |
| Tokens cap        | `max_tokens`            | `max_output_tokens`                                                       |
| Tool definition   | `tools[].function`      | `tools[]` (`type: 'function' \| 'web_search'`)                            |
| Reasoning control | n/a                     | `reasoning: { effort: 'low' \| 'medium' \| 'high' }`                      |
| Streaming events  | `data: {chunk}`         | `event: <type>\ndata: {…}\n\n` per event                                  |
| Stop reason       | `finish_reason`         | `status` (`completed` / `incomplete` / …)                                 |
| Output            | `choices[].message`     | `output[]` (typed items: `message`, `function_call`, `reasoning`)         |
| Continuity        | n/a (resend history)    | `previous_response_id` + `store: true` (OpenAI-native; ignored elsewhere) |

## Examples

### Multi-message input items

When you need a multi-turn conversation, send `input` as an array of
`message` items:

<Tabs>
  <TabItem value="python" label="Python">

```python
response = client.responses.create(
    model="my-resource",
    input=[
        {
            "type": "message",
            "role": "user",
            "content": [{"type": "input_text", "text": "My name is Lucas."}],
        },
        {
            "type": "message",
            "role": "assistant",
            "content": [
                {"type": "output_text", "text": "Hello, Lucas. How can I help?"}
            ],
        },
        {
            "type": "message",
            "role": "user",
            "content": [{"type": "input_text", "text": "What's my name?"}],
        },
    ],
)
```

  </TabItem>
  <TabItem value="ts" label="TypeScript">

```ts
const response = await client.responses.create({
  model: 'my-resource',
  input: [
    {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'My name is Lucas.' }],
    },
    {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Hello, Lucas. How can I help?' }],
    },
    {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: "What's my name?" }],
    },
  ],
});
```

  </TabItem>
  <TabItem value="curl" label="cURL">

```bash
curl http://localhost:3030/api/v1/completion/<workspace>/<environment>/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <vmx-api-key>" \
  -d '{
    "model": "my-resource",
    "input": [
      {"type":"message","role":"user","content":[{"type":"input_text","text":"My name is Lucas."}]},
      {"type":"message","role":"assistant","content":[{"type":"output_text","text":"Hello, Lucas. How can I help?"}]},
      {"type":"message","role":"user","content":[{"type":"input_text","text":"What is my name?"}]}
    ]
  }'
```

  </TabItem>
</Tabs>

> **assistant `content` part type:** assistant messages use `output_text`
> (not `input_text`), even on the input side. VM-X normalises this for
> you when an OpenAI Responses request lands on a non-OpenAI provider.

### Function tools

Responses-shape tools are flatter than Chat Completions — `name` and
`parameters` live at the top of the tool object.

<Tabs>
  <TabItem value="python" label="Python">

```python
response = client.responses.create(
    model="my-resource",
    input="Weather in Tokyo?",
    tools=[
        {
            "type": "function",
            "name": "get_weather",
            "description": "Get current weather for a city.",
            "parameters": {
                "type": "object",
                "properties": {"location": {"type": "string"}},
                "required": ["location"],
            },
        }
    ],
    tool_choice="required",
)

# tool calls land as function_call items in output[]
for item in response.output:
    if item.type == "function_call":
        print(item.name, item.arguments)
```

  </TabItem>
  <TabItem value="ts" label="TypeScript">

```ts
const response = await client.responses.create({
  model: 'my-resource',
  input: 'Weather in Tokyo?',
  tools: [
    {
      type: 'function',
      name: 'get_weather',
      description: 'Get current weather for a city.',
      parameters: {
        type: 'object',
        properties: { location: { type: 'string' } },
        required: ['location'],
      },
    },
  ],
  tool_choice: 'required',
});

const fc = response.output.find((o) => o.type === 'function_call');
console.log(fc?.name, fc?.arguments);
```

  </TabItem>
  <TabItem value="curl" label="cURL">

```bash
curl http://localhost:3030/api/v1/completion/<workspace>/<environment>/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <vmx-api-key>" \
  -d '{
    "model": "my-resource",
    "input": "Weather in Tokyo?",
    "tools": [{
      "type": "function",
      "name": "get_weather",
      "description": "Get current weather for a city.",
      "parameters": {
        "type": "object",
        "properties": {"location": {"type":"string"}},
        "required": ["location"]
      }
    }],
    "tool_choice": "required"
  }'
```

  </TabItem>
</Tabs>

### Tool result round-trip

Send the function's output back as a `function_call_output` item
keyed by `call_id`:

<Tabs>
  <TabItem value="python" label="Python">

```python
# Continuing from the previous example...
fc = next(o for o in response.output if o.type == "function_call")

final = client.responses.create(
    model="my-resource",
    input=[
        {
            "type": "message",
            "role": "user",
            "content": [{"type": "input_text", "text": "Weather in Tokyo?"}],
        },
        fc,  # the function_call from the previous turn
        {
            "type": "function_call_output",
            "call_id": fc.call_id,
            "output": '{"temp_c": 22, "conditions": "clear"}',
        },
    ],
)
```

  </TabItem>
  <TabItem value="ts" label="TypeScript">

```ts
const fc = response.output.find((o) => o.type === 'function_call')!;

const final = await client.responses.create({
  model: 'my-resource',
  input: [
    {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'Weather in Tokyo?' }],
    },
    fc,
    {
      type: 'function_call_output',
      call_id: fc.call_id,
      output: JSON.stringify({ temp_c: 22, conditions: 'clear' }),
    },
  ],
});
```

  </TabItem>
</Tabs>

### Reasoning effort (o-series, Opus)

Set `reasoning: { effort: 'low' | 'medium' | 'high' }`. The model
allocates more or less time to reasoning before producing the final
output.

<Tabs>
  <TabItem value="python" label="Python">

```python
response = client.responses.create(
    model="my-reasoning-resource",  # e.g. an o4-mini or claude-opus-4-x resource
    input="Prove there are infinitely many primes.",
    reasoning={"effort": "high"},
    max_output_tokens=2000,
)
```

  </TabItem>
  <TabItem value="ts" label="TypeScript">

```ts
const response = await client.responses.create({
  model: 'my-reasoning-resource',
  input: 'Prove there are infinitely many primes.',
  reasoning: { effort: 'high' },
  max_output_tokens: 2000,
});
```

  </TabItem>
  <TabItem value="curl" label="cURL">

```bash
curl http://localhost:3030/api/v1/completion/<workspace>/<environment>/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <vmx-api-key>" \
  -d '{
    "model": "my-reasoning-resource",
    "input": "Prove there are infinitely many primes.",
    "reasoning": {"effort": "high"},
    "max_output_tokens": 2000
  }'
```

  </TabItem>
</Tabs>

> **Cross-provider note:** when a Responses request resolves to
> Anthropic, `reasoning.effort` maps to Anthropic's `thinking.budget_tokens`
> tier (low → 1k, medium → 4k, high → 12k tokens). The reasoning content
> comes back as `reasoning` items in `output[]`.

### Web search (hosted tool)

Web search is a built-in server-side tool — no function definition
needed. Add `{ type: 'web_search' }` to `tools[]`. Use the canonical
`web_search` type (not the older `web_search_preview` — OpenAI still
accepts both, and VM-X normalises `web_search_preview` to
`web_search` when dispatching to Perplexity).

Provider behaviour at a glance:

- **OpenAI** — passthrough to OpenAI's hosted `web_search`. Note that
  the Chat-Completions-only search models (`gpt-5-search-api`,
  `gpt-4o-search-preview`, `gpt-4o-mini-search-preview`) cannot run on
  this endpoint at all — see [BFF constraints](#bff-constraints) below.
- **Anthropic / AWS Bedrock (Converse + Invoke)** — adapter maps the
  tool to Claude's `web_search_20250305` server tool.
- **Perplexity** — Sonar searches by default; `{type: 'web_search'}` is
  the native tool shape, including optional `filters` /
  `user_location`.
- **Gemini** — adapter maps to Google's grounded search tool.
- **Groq** — passed through verbatim (Groq's Responses-compat endpoint
  accepts hosted-tool entries; support depends on the upstream model).

<Tabs>
  <TabItem value="python" label="Python">

```python
response = client.responses.create(
    model="my-resource",
    input="What's the latest version of TypeScript? Cite sources.",
    tools=[{"type": "web_search"}],
)
```

  </TabItem>
  <TabItem value="ts" label="TypeScript">

```ts
const response = await client.responses.create({
  model: 'my-resource',
  input: "What's the latest version of TypeScript? Cite sources.",
  tools: [{ type: 'web_search' }],
});
```

  </TabItem>
  <TabItem value="curl" label="cURL">

```bash
curl http://localhost:3030/api/v1/completion/<workspace>/<environment>/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <vmx-api-key>" \
  -d '{
    "model": "my-resource",
    "input": "What is the latest version of TypeScript? Cite sources.",
    "tools": [{"type":"web_search"}]
  }'
```

  </TabItem>
</Tabs>

See the dedicated [web search guide](./web-search.md) for citations,
recency filters, and provider-by-provider behaviour.

### Streaming — typed events

Responses streams are typed: every event has its own `event:` name
followed by a `data:` JSON frame.

<Tabs>
  <TabItem value="python" label="Python">

```python
stream = client.responses.create(
    model="my-resource",
    input="Stream a poem.",
    stream=True,
)

for event in stream:
    # event.type discriminates: response.created,
    # response.output_text.delta, response.completed, etc.
    if event.type == "response.output_text.delta":
        print(event.delta, end="", flush=True)
    elif event.type == "response.completed":
        print()  # final newline
```

  </TabItem>
  <TabItem value="ts" label="TypeScript">

```ts
const stream = await client.responses.create({
  model: 'my-resource',
  input: 'Stream a poem.',
  stream: true,
});

for await (const event of stream) {
  if (event.type === 'response.output_text.delta') {
    process.stdout.write(event.delta);
  } else if (event.type === 'response.completed') {
    process.stdout.write('\n');
  }
}
```

  </TabItem>
  <TabItem value="curl" label="cURL">

```bash
curl http://localhost:3030/api/v1/completion/<workspace>/<environment>/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <vmx-api-key>" \
  -N -d '{
    "model": "my-resource",
    "input": "Stream a poem.",
    "stream": true
  }'
```

Wire format per event:

```
event: response.created
data: {"type":"response.created","response":{"id":"resp_..."}}

event: response.output_text.delta
data: {"type":"response.output_text.delta","delta":"..."}

event: response.completed
data: {"type":"response.completed","response":{...,"usage":{...}}}
```

  </TabItem>
</Tabs>

Common event types VM-X forwards:

| Event                                    | When                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| `response.created`                       | Response object is registered (with `id`).                                                  |
| `response.in_progress`                   | Generation started.                                                                         |
| `response.output_item.added`             | A new top-level output item begins (message/function_call/reasoning).                       |
| `response.content_part.added`            | A content part begins inside a message item.                                                |
| `response.output_text.delta`             | Streaming text delta.                                                                       |
| `response.function_call_arguments.delta` | Streaming JSON args delta on a function call.                                               |
| `response.reasoning_summary_text.delta`  | Streaming reasoning text delta.                                                             |
| `response.output_item.done`              | An output item finished.                                                                    |
| `response.completed`                     | Stream done; final `response` object on the event (carries `usage` + assembled `output[]`). |
| `response.incomplete`                    | Generation stopped before completion — usually `max_output_tokens` or `content_filter`.     |
| `error`                                  | Mid-stream error frame (no trailing `[DONE]` sentinel).                                     |

Every event carries a strictly monotonic `sequence_number` starting at
`0`, and `usage` always lands on the final `response.completed` /
`response.incomplete` event — there is no separate usage chunk like
Chat Completions has.

### Attaching `vmx` metadata

<Tabs>
  <TabItem value="python" label="Python">

```python
response = client.responses.create(
    model="my-resource",
    input="Pick a number 1-10.",
    extra_body={
        "vmx": {
            "correlationId": "agent-run-2026-05-10-abc",
            "metadata": {"team": "growth", "experiment": "exp_42"},
            "timeoutMs": 30_000,
        }
    },
)
```

  </TabItem>
  <TabItem value="ts" label="TypeScript">

```ts
const response = await client.responses.create({
  model: 'my-resource',
  input: 'Pick a number 1-10.',
  // @ts-expect-error custom extra
  vmx: {
    correlationId: 'agent-run-2026-05-10-abc',
    metadata: { team: 'growth', experiment: 'exp_42' },
    timeoutMs: 30_000,
  },
});
```

  </TabItem>
  <TabItem value="curl" label="cURL">

```bash
curl http://localhost:3030/api/v1/completion/<workspace>/<environment>/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <vmx-api-key>" \
  -d '{
    "model": "my-resource",
    "input": "Pick a number 1-10.",
    "vmx": {
      "correlationId": "agent-run-2026-05-10-abc",
      "metadata": {"team": "growth", "experiment": "exp_42"},
      "timeoutMs": 30000
    }
  }'
```

  </TabItem>
</Tabs>

## Provider compatibility

| Provider             | Native passthrough? | Notes                                                                                                                                                                                    |
| -------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI               | Yes                 | Direct dispatch via `client.responses.create`. Supports `previous_response_id` / `conversation` continuity, hosted tools, and the full reasoning event stream.                           |
| Anthropic            | Convert             | Direct Responses↔Anthropic adapter — no internal pivot through Chat Completions. Reasoning effort → `thinking.budget_tokens`; reasoning content comes back as `reasoning` items.         |
| AWS Bedrock-Converse | Convert             | Direct Responses↔Converse adapter.                                                                                                                                                       |
| AWS Bedrock-Invoke   | Convert             | Responses → Anthropic (canonical adapter) → Bedrock-Invoke wire shape (Claude-only on this connection).                                                                                  |
| Gemini               | Convert             | Direct Responses↔Gemini adapter via the native `@google/genai` SDK (no OpenAI-compat hop).                                                                                               |
| Groq                 | Yes                 | Native passthrough to Groq's Responses-compatible endpoint (`api.groq.com/openai/v1/responses`). Assistant `output_text` parts in `input[]` are flattened to plain strings (Groq quirk). |
| Perplexity           | Yes                 | Native passthrough to Perplexity's `POST /v1/responses` (alias to `/v1/agent`). `{type:'web_search_preview'}` is renamed to `{type:'web_search'}` before dispatch.                       |

For the per-pair conversion details (which Responses fields survive
each conversion path), see the
[conversion matrix](https://github.com/vm-x-ai/vm-x-ai/blob/main/contributing-docs/conversion-matrix.md).

## BFF constraints

The playground UI (Next.js BFF at
[`packages/ui/src/app/api/responses/route.ts`](https://github.com/vm-x-ai/vm-x-ai/blob/main/packages/ui/src/app/api/responses/route.ts))
adds two pre-flight checks on top of the gateway. **Direct gateway
callers (OpenAI SDK, cURL, your own service) are not affected** —
these only fire on requests routed through the playground.

- **OpenAI Chat-Completions-only search models are rejected.**
  `gpt-5-search-api`, `gpt-4o-search-preview`, and
  `gpt-4o-mini-search-preview` have web search baked into the model
  and only run on `/chat/completions`. The BFF returns
  `400 model_endpoint_mismatch` with a hint to switch to the Chat
  Completions endpoint instead of surfacing the upstream's
  `Tool 'web_search_preview' is not supported` / 500-on-plain-prompt
  error. The allow-list lives in
  [`openai-model-quirks.ts`](https://github.com/vm-x-ai/vm-x-ai/blob/main/packages/ui/src/app/api/_lib/openai-model-quirks.ts).
- **Non-canonical `output[]` items are stripped on non-streaming
  responses.** Perplexity emits `{type:'search_results', …}` items
  alongside the canonical message/reasoning/function_call set. The AI
  SDK's Responses Zod schema rejects unknown discriminators, so the
  BFF filters `output[]` down to the AI-SDK-accepted union. Sources
  are still readable via the top-level `citations[]` /
  `search_results[]` extension fields that Perplexity also stamps —
  the gateway preserves both verbatim.

## Errors

See the [endpoint overview](./index.md#errors) for the full error
catalog. On streaming requests, mid-stream errors are emitted as a
single typed event:

```
event: error
data: {"error": {"message": "...", "code": "..."}}
```

There is no trailing `[DONE]` sentinel — the stream simply terminates
after the error frame. Clients consuming with the OpenAI SDK pick this
up via the typed event stream's `error` discriminator.

## Next steps

- [Web search](./web-search.md) — `tools: [{type: 'web_search'}]` deep dive
- [VM-X envelope](./vmx-envelope.md) — `correlationId`, `metadata`, `providerArgs`, …
- [Chat Completions](./chat-completions.md) — when you don't need typed events
- [Anthropic Messages](./anthropic-messages.md) — when you need `cache_control` / `thinking` in the request shape
