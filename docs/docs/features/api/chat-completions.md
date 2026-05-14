---
sidebar_position: 3
slug: /api/chat-completions
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Chat Completions

The OpenAI **Chat Completions** endpoint is VM-X's broadest surface —
every supported provider speaks it (natively or via conversion). Reach
for it when:

- Your application already uses the OpenAI SDK.
- You want maximum provider portability (one shape works for OpenAI,
  Anthropic, Gemini, Groq, Perplexity, AWS Bedrock).
- You don't need the typed-event streaming shape of `/responses` or
  the Anthropic-specific features (`cache_control`, extended `thinking`,
  server tools) of `/anthropic/messages`.

## Endpoint

```
POST /v1/completion/{workspaceId}/{environmentId}/chat/completions
```

Headers:

```
Content-Type: application/json
Authorization: Bearer <vmx-api-key>
```

Request shape: standard OpenAI Chat Completions body, plus an optional
[`vmx`](./vmx-envelope.md) envelope embedded as a top-level field. Use
the **VM-X resource name** in `model`, not the upstream model id.

The gateway preserves the OpenAI wire format verbatim — every caller-supplied
field (including SDK-typed-and-not-typed extras like `service_tier`,
`safety_identifier`, `prompt_cache_key`, `reasoning_effort`, custom
tools, `metadata`, …) is forwarded into the upstream call when the route
resolves to a provider that speaks Chat Completions natively. When the
route resolves to a provider that doesn't (Anthropic, Bedrock-Converse,
Bedrock-Invoke, Gemini), a per-provider converter in
[`openai-chat-completion.provider.ts`](https://github.com/vm-x-ai/vm-x-ai/tree/main/packages/api/src/ai-provider)
translates request and response. Fields that can't be expressed on the
target are stowed on a private `__vmx_passthrough` envelope so a
fallback to a native-format provider later in the chain can re-attach
them.

## Quick start

<Tabs>
  <TabItem value="python" label="Python (OpenAI SDK)">

```python
from openai import OpenAI

client = OpenAI(
    api_key="<vmx-api-key>",
    base_url="http://localhost:3030/api/v1/completion/<workspace>/<environment>",
)

response = client.chat.completions.create(
    model="my-resource",
    messages=[{"role": "user", "content": "Hello!"}],
)

print(response.choices[0].message.content)
```

  </TabItem>
  <TabItem value="ts" label="TypeScript (OpenAI SDK)">

```ts
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: '<vmx-api-key>',
  baseURL: 'http://localhost:3030/api/v1/completion/<workspace>/<environment>',
});

const completion = await client.chat.completions.create({
  model: 'my-resource',
  messages: [{ role: 'user', content: 'Hello!' }],
});

console.log(completion.choices[0].message.content);
```

  </TabItem>
  <TabItem value="curl" label="cURL">

```bash
curl http://localhost:3030/api/v1/completion/<workspace>/<environment>/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <vmx-api-key>" \
  -d '{
    "model": "my-resource",
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
  <TabItem value="python" label="Python (OpenAI SDK)">

```python
# "openai-prod" is the AI Connection name; "gpt-4o-mini" is the
# upstream OpenAI model id. No resource record required.
response = client.chat.completions.create(
    model="openai-prod/gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello!"}],
)
```

  </TabItem>
  <TabItem value="ts" label="TypeScript (OpenAI SDK)">

```ts
const completion = await client.chat.completions.create({
  model: 'openai-prod/gpt-4o-mini',
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

  </TabItem>
  <TabItem value="curl" label="cURL">

```bash
curl http://localhost:3030/api/v1/completion/<workspace>/<environment>/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <vmx-api-key>" \
  -d '{
    "model": "openai-prod/gpt-4o-mini",
    "messages": [{"role":"user","content":"Hello!"}]
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

## Examples

### System prompt + multi-turn conversation

The system message goes first; subsequent messages alternate
`user` / `assistant`.

<Tabs>
  <TabItem value="python" label="Python">

```python
response = client.chat.completions.create(
    model="my-resource",
    messages=[
        {"role": "system", "content": "You are a concise senior engineer."},
        {"role": "user", "content": "My name is Lucas."},
        {"role": "assistant", "content": "Got it, Lucas."},
        {"role": "user", "content": "What's my name?"},
    ],
)
```

  </TabItem>
  <TabItem value="ts" label="TypeScript">

```ts
const completion = await client.chat.completions.create({
  model: 'my-resource',
  messages: [
    { role: 'system', content: 'You are a concise senior engineer.' },
    { role: 'user', content: 'My name is Lucas.' },
    { role: 'assistant', content: 'Got it, Lucas.' },
    { role: 'user', content: "What's my name?" },
  ],
});
```

  </TabItem>
  <TabItem value="curl" label="cURL">

```bash
curl http://localhost:3030/api/v1/completion/<workspace>/<environment>/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <vmx-api-key>" \
  -d '{
    "model": "my-resource",
    "messages": [
      {"role":"system","content":"You are a concise senior engineer."},
      {"role":"user","content":"My name is Lucas."},
      {"role":"assistant","content":"Got it, Lucas."},
      {"role":"user","content":"What is my name?"}
    ]
  }'
```

  </TabItem>
</Tabs>

### Tool calling

Define your tools in the OpenAI function-calling shape; the assistant
responds with `tool_calls` when it wants to invoke one. Send the tool
result back as a `tool` role message keyed by `tool_call_id`.

<Tabs>
  <TabItem value="python" label="Python">

```python
tools = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get the current weather for a city.",
            "parameters": {
                "type": "object",
                "properties": {"location": {"type": "string"}},
                "required": ["location"],
            },
        },
    }
]

# 1. Model emits a tool_call
first = client.chat.completions.create(
    model="my-resource",
    messages=[{"role": "user", "content": "Weather in Tokyo?"}],
    tools=tools,
    tool_choice="required",
)
tc = first.choices[0].message.tool_calls[0]

# 2. Run the tool locally...
weather = {"temp_c": 22, "conditions": "clear"}

# 3. Send the result back
final = client.chat.completions.create(
    model="my-resource",
    messages=[
        {"role": "user", "content": "Weather in Tokyo?"},
        first.choices[0].message,  # the assistant turn that emitted the tool_call
        {"role": "tool", "tool_call_id": tc.id, "content": str(weather)},
    ],
    tools=tools,
)
print(final.choices[0].message.content)
```

  </TabItem>
  <TabItem value="ts" label="TypeScript">

```ts
const tools = [
  {
    type: 'function' as const,
    function: {
      name: 'get_weather',
      description: 'Get the current weather for a city.',
      parameters: {
        type: 'object',
        properties: { location: { type: 'string' } },
        required: ['location'],
      },
    },
  },
];

const first = await client.chat.completions.create({
  model: 'my-resource',
  messages: [{ role: 'user', content: 'Weather in Tokyo?' }],
  tools,
  tool_choice: 'required',
});
const tc = first.choices[0].message.tool_calls![0];

const weather = { temp_c: 22, conditions: 'clear' };

const final = await client.chat.completions.create({
  model: 'my-resource',
  messages: [{ role: 'user', content: 'Weather in Tokyo?' }, first.choices[0].message, { role: 'tool', tool_call_id: tc.id, content: JSON.stringify(weather) }],
  tools,
});
```

  </TabItem>
  <TabItem value="curl" label="cURL">

```bash
curl http://localhost:3030/api/v1/completion/<workspace>/<environment>/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <vmx-api-key>" \
  -d '{
    "model": "my-resource",
    "messages": [{"role":"user","content":"Weather in Tokyo?"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get the current weather for a city.",
        "parameters": {
          "type": "object",
          "properties": {"location": {"type":"string"}},
          "required": ["location"]
        }
      }
    }],
    "tool_choice": "required"
  }'
```

  </TabItem>
</Tabs>

### Streaming

Set `stream: true`. The wire format is OpenAI Server-Sent Events: each
chunk on its own `data:` line, terminated by `data: [DONE]`.

To get token usage on the final chunk, set
`stream_options: { include_usage: true }` (VM-X also adds this
automatically when `stream: true` is set).

<Tabs>
  <TabItem value="python" label="Python">

```python
stream = client.chat.completions.create(
    model="my-resource",
    messages=[{"role": "user", "content": "Stream a poem."}],
    stream=True,
)

for chunk in stream:
    delta = chunk.choices[0].delta.content or ""
    print(delta, end="", flush=True)
```

  </TabItem>
  <TabItem value="ts" label="TypeScript">

```ts
const stream = await client.chat.completions.create({
  model: 'my-resource',
  messages: [{ role: 'user', content: 'Stream a poem.' }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
}
```

  </TabItem>
  <TabItem value="curl" label="cURL">

```bash
curl http://localhost:3030/api/v1/completion/<workspace>/<environment>/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <vmx-api-key>" \
  -N -d '{
    "model": "my-resource",
    "messages": [{"role":"user","content":"Stream a poem."}],
    "stream": true
  }'
```

The `-N` flag disables curl's output buffering so you see chunks as
they arrive. Each line is `data: <json>\n\n` until the final
`data: [DONE]`.

  </TabItem>
</Tabs>

### Multi-modal — images via `image_url`

Send images as a `data:` URL or a public URL on a `user` message's
`content` array.

<Tabs>
  <TabItem value="python" label="Python">

```python
response = client.chat.completions.create(
    model="my-vision-resource",
    messages=[
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Describe this image."},
                {
                    "type": "image_url",
                    "image_url": {
                        "url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
                    },
                },
            ],
        }
    ],
)
```

  </TabItem>
  <TabItem value="ts" label="TypeScript">

```ts
const completion = await client.chat.completions.create({
  model: 'my-vision-resource',
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Describe this image.' },
        {
          type: 'image_url',
          image_url: {
            url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...',
          },
        },
      ],
    },
  ],
});
```

  </TabItem>
  <TabItem value="curl" label="cURL">

```bash
curl http://localhost:3030/api/v1/completion/<workspace>/<environment>/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <vmx-api-key>" \
  -d '{
    "model": "my-vision-resource",
    "messages": [{
      "role": "user",
      "content": [
        {"type": "text", "text": "Describe this image."},
        {"type": "image_url", "image_url": {"url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."}}
      ]
    }]
  }'
```

  </TabItem>
</Tabs>

> **Bedrock-Invoke note:** Bedrock-Invoke (Anthropic-on-AWS) can't fetch
> external image URLs server-side. Use base64 `data:` URLs instead, or
> route through Bedrock-Converse which does fetch URLs. VM-X surfaces a
> clean 400 with code `aws_bedrock_invoke_image_url_unsupported` if you
> hit this.

### JSON mode and JSON Schema

Pin the response to JSON via `response_format`.

<Tabs>
  <TabItem value="python" label="Python (json_object)">

```python
response = client.chat.completions.create(
    model="my-resource",
    messages=[
        {"role": "system", "content": "Respond ONLY in valid JSON."},
        {"role": "user", "content": "Give me a 3-key object describing TypeScript."},
    ],
    response_format={"type": "json_object"},
)
```

  </TabItem>
  <TabItem value="python-schema" label="Python (json_schema)">

```python
response = client.chat.completions.create(
    model="my-resource",
    messages=[{"role": "user", "content": "Pick a country: Brazil."}],
    response_format={
        "type": "json_schema",
        "json_schema": {
            "name": "country",
            "strict": True,
            "schema": {
                "type": "object",
                "properties": {
                    "city": {"type": "string"},
                    "country_code": {"type": "string"},
                },
                "required": ["city", "country_code"],
                "additionalProperties": False,
            },
        },
    },
)
```

  </TabItem>
  <TabItem value="ts" label="TypeScript (json_schema)">

```ts
const completion = await client.chat.completions.create({
  model: 'my-resource',
  messages: [{ role: 'user', content: 'Pick a country: Brazil.' }],
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: 'country',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          city: { type: 'string' },
          country_code: { type: 'string' },
        },
        required: ['city', 'country_code'],
        additionalProperties: false,
      },
    },
  },
});
```

  </TabItem>
  <TabItem value="curl" label="cURL">

```bash
curl http://localhost:3030/api/v1/completion/<workspace>/<environment>/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <vmx-api-key>" \
  -d '{
    "model": "my-resource",
    "messages": [{"role":"user","content":"Pick a country: Brazil."}],
    "response_format": {
      "type": "json_schema",
      "json_schema": {
        "name": "country",
        "strict": true,
        "schema": {
          "type": "object",
          "properties": {
            "city": {"type":"string"},
            "country_code": {"type":"string"}
          },
          "required": ["city","country_code"],
          "additionalProperties": false
        }
      }
    }
  }'
```

  </TabItem>
</Tabs>

> **Anthropic note:** Anthropic doesn't have a native `response_format`
> field. VM-X synthesises a tool call internally so a Chat-Completions
> JSON-schema request still works when the resource resolves to
> Anthropic. The model's response is unwrapped back into `message.content`
> as a JSON string.

### Attaching `vmx` metadata

<Tabs>
  <TabItem value="python" label="Python">

```python
response = client.chat.completions.create(
    model="my-resource",
    messages=[{"role": "user", "content": "Summarise: ..."}],
    extra_body={
        "vmx": {
            "correlationId": "summarizer-job-2026-05-10-abc",
            "metadata": {
                "team": "growth",
                "feature": "summarizer",
                "user_id": "u_42",
            },
            "timeoutMs": 20_000,
        }
    },
)
```

  </TabItem>
  <TabItem value="ts" label="TypeScript">

```ts
const completion = await client.chat.completions.create({
  model: 'my-resource',
  messages: [{ role: 'user', content: 'Summarise: ...' }],
  // @ts-expect-error custom extra
  vmx: {
    correlationId: 'summarizer-job-2026-05-10-abc',
    metadata: { team: 'growth', feature: 'summarizer', user_id: 'u_42' },
    timeoutMs: 20_000,
  },
});
```

  </TabItem>
  <TabItem value="curl" label="cURL">

```bash
curl http://localhost:3030/api/v1/completion/<workspace>/<environment>/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <vmx-api-key>" \
  -d '{
    "model": "my-resource",
    "messages": [{"role":"user","content":"Summarise: ..."}],
    "vmx": {
      "correlationId": "summarizer-job-2026-05-10-abc",
      "metadata": {
        "team": "growth",
        "feature": "summarizer",
        "user_id": "u_42"
      },
      "timeoutMs": 20000
    }
  }'
```

  </TabItem>
</Tabs>

See the full [vmx envelope reference](./vmx-envelope.md) for `providerArgs`,
`secondaryModelIndex`, and `resourceConfigOverrides`.

## Provider compatibility

| Provider             | Path        | Notes                                                                                                                                                                                                                                                                                                                                                    |
| -------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI               | Passthrough | Direct dispatch via the OpenAI SDK's `client.chat.completions.create`. Every Chat Completions field is forwarded verbatim, including SDK-typed extras (`service_tier`, `metadata`, `safety_identifier`, `prompt_cache_key`, `reasoning_effort`, `web_search_options`, …).                                                                                |
| Groq                 | Passthrough | OpenAI SDK pointed at `api.groq.com/openai/v1`. Groq-specific top-level fields (`reasoning_effort`, `reasoning_format`, `search_settings`, `service_tier`) ride through. Groq 400s on `logprobs`/`logit_bias`/`top_logprobs`/`messages[].name`/`n > 1` — VM-X surfaces the 400.                                                                          |
| Perplexity           | Passthrough | OpenAI SDK pointed at `api.perplexity.ai`. Sonar-specific filter fields (`search_domain_filter`, `search_recency_filter`, `web_search_options`, `return_images`, `user_location`, …) ride through. Web search is built into every model; response carries `citations[]` + `search_results[]`.                                                            |
| Anthropic            | Convert     | Converted to Anthropic Messages and dispatched against `api.anthropic.com`. `cache_control` / extended `thinking` / `top_k` / server tools work via [`vmx.providerArgs`](./vmx-envelope.md) or natively on [`/anthropic/messages`](./anthropic-messages.md). `n > 1` is rejected with `anthropic_n_unsupported`.                                         |
| Gemini               | Convert     | Converted to Gemini's native `GenerateContentParameters` (`@google/genai`) — not the OpenAI-compat shim. Preserves `thoughtSignature`, grounding metadata, code-execution parts, per-modality usage. Native tools (`googleSearch`, `urlContext`, `codeExecution`, `fileSearch`, `googleMaps`, `computerUse`) forward verbatim when present on `tools[]`. |
| AWS Bedrock-Converse | Convert     | Converted to the Converse API shape; `cache_control` from `__vmx_passthrough` re-applied as `cachePoint` blocks. `reasoning_effort` maps to `thinking.budget_tokens`. Image inputs must carry a parseable format.                                                                                                                                        |
| AWS Bedrock-Invoke   | Convert     | Two-stage: OpenAI → Anthropic canonical → Bedrock-Invoke (Claude on AWS). External `image_url` URLs are rejected upstream with `aws_bedrock_invoke_image_url_unsupported`; use base64 `data:` URLs or route to Bedrock-Converse, which does fetch external URLs.                                                                                         |

See the [conversion matrix](https://github.com/vm-x-ai/vm-x-ai/blob/main/contributing-docs/conversion-matrix.md)
for the full per-field details on each convert path.

## Response shape

The body is a standard OpenAI `ChatCompletion` (or stream of
`ChatCompletionChunk`s). Provider-specific extension fields ride
through unchanged — examples:

- **OpenAI / OpenAI-compat:** `usage.prompt_tokens_details.cached_tokens`,
  `usage.completion_tokens_details.reasoning_tokens`, `service_tier` (echoed),
  refusal stop details.
- **Anthropic (convert path):** `usage.prompt_tokens_details` surfaces
  Anthropic cache stats (`cache_creation_input_tokens`, `cache_read_input_tokens`).
- **Gemini (convert path):** `message.gemini_code_execution`, `vertex_ai_grounding_metadata`,
  `url_context_metadata`, `prompt_feedback`.
- **Groq (passthrough):** `message.reasoning` (when `reasoning_format`
  is `parsed`) for GPT-OSS / Qwen3 / DeepSeek-R1.
- **Perplexity (passthrough):** top-level `citations[]` and
  `search_results[]`; per-token `usage.cost.*`.

On top of the upstream shape, VM-X decorates the response with a
top-level `vmx` object carrying gateway metrics:

```jsonc
{
  "id": "chatcmpl-...",
  "choices": [
    /* ... */
  ],
  "usage": {
    /* ... */
  },
  "vmx": {
    "metrics": {
      "gateDurationMs": 4,
      "routingDurationMs": null,
      "timeToFirstTokenMs": null,
      "tokensPerSecond": null
    },
    "events": [
      /* audit events for this request — gate, routing, fallback */
    ]
  }
}
```

The same metrics are echoed onto the HTTP response headers
(`x-vmx-model`, `x-vmx-provider`, `x-vmx-connection-id`,
`x-vmx-gate-duration-ms`, `x-vmx-routing-duration-ms`,
`x-vmx-event-count`, plus `x-vmx-metadata-<key>` for every
[`vmx.metadata`](./vmx-envelope.md) entry). The full header list is
in the [endpoint overview](./index.md#headers-vm-x-adds-to-every-response).

When a request fails, VM-X attaches the exact `providerRequestPayload`
that was sent upstream (or would have been, if the failure happened
before dispatch) to the audit row, so you can replay or diff any
gateway-side conversion against the wire body.

## Errors

See the [endpoint overview](./index.md#errors) for the full error catalog.
On streaming requests, errors that fire after the first chunk are
emitted as a final `data: { "error": {...} }` frame followed by
`data: [ERROR]\n\n` (the `[ERROR]` sentinel — distinct from the
successful-end `[DONE]` sentinel — lets clients distinguish a clean
finish from a truncated one).

## Next steps

- [VM-X envelope](./vmx-envelope.md) — `correlationId`, `metadata`, `providerArgs`, …
- [Anthropic Messages](./anthropic-messages.md) — `cache_control`, extended thinking, server tools
- [Web search](./web-search.md) — provider-by-provider web search guide
- [AI Resources](../ai-resources/index.md) — how `model` resolves to a provider + model
