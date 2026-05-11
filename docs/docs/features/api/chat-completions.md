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
[`vmx`](./vmx-envelope.md) envelope. Use the **VM-X resource name** in
`model`, not the upstream model id.

## Quick start

<Tabs>
  <TabItem value="python" label="Python (OpenAI SDK)">

```python
from openai import OpenAI

client = OpenAI(
    api_key="<vmx-api-key>",
    base_url="http://localhost:3000/v1/completion/<workspace>/<environment>",
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
  baseURL: 'http://localhost:3000/v1/completion/<workspace>/<environment>',
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
curl http://localhost:3000/v1/completion/<workspace>/<environment>/chat/completions \
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
curl http://localhost:3000/v1/completion/<workspace>/<environment>/chat/completions \
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
curl http://localhost:3000/v1/completion/<workspace>/<environment>/chat/completions \
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
curl http://localhost:3000/v1/completion/<workspace>/<environment>/chat/completions \
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
curl http://localhost:3000/v1/completion/<workspace>/<environment>/chat/completions \
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
curl http://localhost:3000/v1/completion/<workspace>/<environment>/chat/completions \
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
curl http://localhost:3000/v1/completion/<workspace>/<environment>/chat/completions \
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
curl http://localhost:3000/v1/completion/<workspace>/<environment>/chat/completions \
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

| Provider             | Native passthrough? | Notes                                                                                                                                                                       |
| -------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI               | ✅ Yes              | Direct dispatch via `client.chat.completions.create`.                                                                                                                       |
| Anthropic            | ✅ Yes              | Anthropic accepts the OpenAI-compat shape natively. `cache_control` / `thinking` work via `vmx.providerArgs` or [`/anthropic/messages`](./anthropic-messages.md).           |
| Gemini               | ✅ Yes              | Via Google's OpenAI-compat endpoint. Auto-routes to the native `@google/genai` SDK when the request carries `googleSearch`/`urlContext`/`codeExecution`/`fileSearch` tools. |
| Groq                 | ✅ Yes              | Via Groq's OpenAI-compat endpoint.                                                                                                                                          |
| Perplexity           | ✅ Yes              | Via Perplexity's OpenAI-compat endpoint. Web search is built into every model.                                                                                              |
| AWS Bedrock-Converse | Convert             | Body converted to Converse shape; `cache_control` from the `__vmx_passthrough` envelope re-applied as `cachePoint` blocks.                                                  |
| AWS Bedrock-Invoke   | Convert             | OpenAI → Anthropic → Bedrock-Invoke wire shape (Anthropic on AWS).                                                                                                          |

When the request format doesn't match the upstream's native shape, VM-X
converts. Fields like `cache_control` and `thinking` ride on the
private `__vmx_passthrough` envelope so a fallback can re-apply them
end-to-end. See the [conversion matrix](https://github.com/vm-x-ai/vm-x-ai/blob/main/contributing-docs/conversion-matrix.md)
for the per-pair details.

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
