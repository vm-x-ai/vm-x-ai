---
sidebar_position: 2
slug: /api/vmx-envelope
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# The `vmx` envelope

Every endpoint accepts an opt-in `vmx` extension on the request body.
It's how you attach metadata, group multi-step calls, override resource
config, bound runtime, and inject provider-native fields — without
leaving the SDK shape.

The envelope works **identically** on `/chat/completions`,
`/anthropic/messages`, and `/responses`. Reach for it whenever the
underlying SDK doesn't have a typed field for what you need.

## Quick example

```jsonc
{
  "model": "your-resource-name",
  "messages": [{ "role": "user", "content": "..." }],

  "vmx": {
    "correlationId": "agent-run-2026-05-06-abc123",
    "metadata": { "team": "growth", "feature": "summarizer" },
    "timeoutMs": 30000,
    "providerArgs": { "search_recency_filter": "week" },
    "secondaryModelIndex": 0,
    "resourceConfigOverrides": {
      "model": {
        "provider": "openai",
        "model": "gpt-4o-mini",
        "connectionName": "my-openai-prod"
      }
    }
  }
}
```

## Field reference

| Field                     | Purpose                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `correlationId`           | Free-form string that groups related calls (e.g., a multi-step agent run). Surfaces as a column on the Audit page so you can pull every call from one trace.                                                                                                                                                                                                                        |
| `metadata`                | `Record<string, string>`. Any keys you like — the Audit page's filter autocomplete picks them up automatically. Indexed for filtering and group-by aggregation on the Usage page.                                                                                                                                                                                                   |
| `timeoutMs`               | Per-request abort cap (clamped to 10 minutes). VM-X builds an `AbortSignal.timeout` that propagates all the way down to the provider SDK, so a slow upstream stops costing you tokens. Composes with the per-model `timeoutMs` (whichever fires first wins).                                                                                                                        |
| `providerArgs`            | Provider-native fields that override the parsed body. Useful when the OpenAI / Anthropic compatible shape can't express a feature your provider offers — Perplexity `search_recency_filter`, Anthropic `top_k`, Gemini `safetySettings`. The merge order is `defaultArgs < parsed body < providerArgs`, so this wins over both — even on `messages`.                                |
| `secondaryModelIndex`     | Skip the resource's primary model and use the Nth secondary instead (`0`-based). Useful for A/B tests, blue/green rollouts, and per-call model pinning without leaving the resource API.                                                                                                                                                                                            |
| `resourceConfigOverrides` | Override the resource's primary model / connection / args / routing for this request only. The merge is deep — caller-supplied keys win, the resource fills in the rest. Inside any model config you can address the connection by either `connectionId` (UUID) or `connectionName` (human-readable name); see [Addressing a connection by name](#addressing-a-connection-by-name). |

## How to attach `vmx` from each SDK

The OpenAI and Anthropic SDKs are typed against their respective APIs
and don't know about the `vmx` field. Use the SDK's "extra body" escape
hatch (`extra_body` in Python, top-level cast in TypeScript) to pass
it through.

### OpenAI SDK (Chat Completions or Responses)

<Tabs>
  <TabItem value="python" label="Python">

```python
from openai import OpenAI

client = OpenAI(
    api_key="<vmx-api-key>",
    base_url="http://localhost:3000/v1/completion/<workspace>/<environment>",
)

response = client.chat.completions.create(
    model="my-resource",
    messages=[{"role": "user", "content": "Hello!"}],
    extra_body={
        "vmx": {
            "correlationId": "agent-run-1",
            "metadata": {"team": "growth", "user_id": "u_42"},
            "timeoutMs": 15_000,
        }
    },
)
```

  </TabItem>
  <TabItem value="ts" label="TypeScript">

```ts
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: '<vmx-api-key>',
  baseURL: 'http://localhost:3000/v1/completion/<workspace>/<environment>',
});

const completion = await client.chat.completions.create({
  model: 'my-resource',
  messages: [{ role: 'user', content: 'Hello!' }],
  // The OpenAI SDK passes through unknown top-level fields; vmx is one.
  // @ts-expect-error custom extra
  vmx: {
    correlationId: 'agent-run-1',
    metadata: { team: 'growth', user_id: 'u_42' },
    timeoutMs: 15_000,
  },
});
```

  </TabItem>
</Tabs>

### Anthropic SDK (Anthropic Messages)

<Tabs>
  <TabItem value="python" label="Python">

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
    extra_body={
        "vmx": {
            "correlationId": "agent-run-1",
            "metadata": {"team": "growth"},
        }
    },
)
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
  model: 'my-resource',
  max_tokens: 512,
  messages: [{ role: 'user', content: 'Hello!' }],
  // @ts-expect-error custom extra
  vmx: { correlationId: 'agent-run-1', metadata: { team: 'growth' } },
});
```

  </TabItem>
</Tabs>

### cURL (any endpoint)

`vmx` is just a top-level JSON field; nothing special:

```bash
curl http://localhost:3000/v1/completion/<workspace>/<environment>/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <vmx-api-key>" \
  -d '{
    "model": "my-resource",
    "messages": [{"role":"user","content":"Hello!"}],
    "vmx": {
      "correlationId": "agent-run-1",
      "metadata": {"team": "growth"}
    }
  }'
```

## Addressing a connection by name

Every model config in `resourceConfigOverrides` (the primary `model`,
each `fallbackModels[*]`, each `secondaryModels[*]`, and every
`routing.conditions[*].then`) accepts EITHER `connectionId` (a UUID)
OR `connectionName` (a human-readable name unique within the
workspace + environment). Use `connectionName` when you don't want to
look up the UUID first — the gateway resolves it before dispatch.

```jsonc
{
  "model": "my-resource",
  "messages": [{ "role": "user", "content": "..." }],
  "vmx": {
    "resourceConfigOverrides": {
      "model": {
        "provider": "openai",
        "model": "gpt-4o",
        "connectionName": "openai-prod"
      },
      "fallbackModels": [
        {
          "provider": "anthropic",
          "model": "claude-haiku-4-5",
          "connectionName": "anthropic-prod"
        }
      ]
    }
  }
}
```

Rules:

- **Exactly one of `connectionId` / `connectionName` must be set** on
  every model config. If both are set, `connectionId` wins (the UUID
  is unambiguous and cannot drift if a connection is renamed later).
- An unknown `connectionName` returns a clean **`400 invalid_request`**
  with an actionable error message — the request is rejected before
  the provider call.
- The same rule applies to **persisted resources**: when you create or
  update an AI Resource via `POST/PATCH /ai-resource/...`, the body
  can carry `connectionName` on any model slot. The service resolves
  to a UUID and stores `connectionId` only — so the database is never
  affected by future renames.
- For ad-hoc, **resource-less** calls, you can also use the
  `connection-name/model` shortcut directly in the request `model`
  field (e.g. `"model": "openai-prod/gpt-4o-mini"`), which builds an
  ephemeral resource on the fly. `resourceConfigOverrides` is the
  more flexible path when you also need to set fallbacks, routing,
  defaultArgs, etc.

## `providerArgs` — your escape hatch

When a provider has a feature the OpenAI / Anthropic compatible shape
can't express, drop it on `vmx.providerArgs`. The gateway merges it on
top of the parsed body so the field reaches the upstream SDK
unchanged.

| Provider   | Common `providerArgs`                                                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Perplexity | `{ "search_recency_filter": "week" }`, `{ "search_domain_filter": [...] }`, `{ "search_after_date_filter": "2024-01-01" }`                   |
| Anthropic  | `{ "top_k": 10 }`, `{ "thinking": { "type": "enabled", "budget_tokens": 5000 } }` (note: also expressible natively on `/anthropic/messages`) |
| Gemini     | `{ "safetySettings": [...] }`, `{ "responseMimeType": "application/json" }`                                                                  |
| OpenAI     | `{ "service_tier": "scale" }`, `{ "user": "user-7e9..." }`                                                                                   |
| Groq       | `{ "service_tier": "on_demand" }`                                                                                                            |

`providerArgs` wins over both `defaultArgs` (resource-level) and the
parsed request body — even for structured fields like `messages` and
`tools`. If you set `providerArgs.messages`, that completely replaces
the parsed `messages` array.

### Example: Perplexity recency filter

<Tabs>
  <TabItem value="python" label="Python">

```python
response = client.chat.completions.create(
    model="my-perplexity-resource",
    messages=[{"role": "user", "content": "Latest TypeScript releases"}],
    extra_body={
        "vmx": {
            "providerArgs": {
                "search_recency_filter": "week",
                "search_domain_filter": ["github.com"],
            }
        }
    },
)
```

  </TabItem>
  <TabItem value="ts" label="TypeScript">

```ts
const completion = await client.chat.completions.create({
  model: 'my-perplexity-resource',
  messages: [{ role: 'user', content: 'Latest TypeScript releases' }],
  // @ts-expect-error custom extra
  vmx: {
    providerArgs: {
      search_recency_filter: 'week',
      search_domain_filter: ['github.com'],
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
    "model": "my-perplexity-resource",
    "messages": [{"role":"user","content":"Latest TypeScript releases"}],
    "vmx": {
      "providerArgs": {
        "search_recency_filter": "week",
        "search_domain_filter": ["github.com"]
      }
    }
  }'
```

  </TabItem>
</Tabs>

## `__vmx_passthrough` — cross-format field carrier

When you send a request in one format that a fallback provider in a
different format would otherwise drop (e.g., an OpenAI Chat Completions
request that ends up routed to Anthropic where you'd want
`cache_control` to take effect), VM-X stows the foreign-shape fields on
a private `__vmx_passthrough` envelope. The right per-pair converter
re-attaches them when the request reaches a provider that understands
them.

You generally don't write `__vmx_passthrough` by hand — VM-X populates
it during request conversion. But the carrier is part of the wire shape
and shows up in `providerRequestPayload` audit rows, so it's useful to
know what's there.

```jsonc
{
  "model": "my-multi-provider-resource",
  "messages": [{ "role": "user", "content": "..." }],

  "__vmx_passthrough": {
    "anthropic": {
      "cache_control": { "type": "ephemeral" },
      "thinking": { "type": "enabled", "budget_tokens": 1000 },
      "top_k": 10,
      "service_tier": "auto",
      "metadata": { "user_id": "u_42" }
    }
  }
}
```

For the full carrier shape per direction, see the
[conversion matrix](https://github.com/vm-x-ai/vm-x-ai/blob/main/contributing-docs/conversion-matrix.md)
contributor doc.

## `correlationId` and `metadata` in the audit / usage UIs

Both fields are first-class on the Audit and Usage pages:

- **Audit** — filter rows by `correlationId` to see every call in one
  agent run; group by any `metadata.<key>` to slice traffic by team,
  feature, user, environment, etc.
- **Usage** — group time-series by `metadata.<key>` to break cost,
  tokens, requests, or latency down across any dimension you tag.

The `metadata` filter autocomplete observes which keys are in use
across recent rows; you don't need to register them in advance.

## `correlationId` vs `x-request-id`

| Header / Field              | Set by              | Use for                                                             |
| --------------------------- | ------------------- | ------------------------------------------------------------------- |
| `vmx.correlationId`         | Caller (this field) | Group multiple calls in your application (one agent run, one job).  |
| `x-request-id` (header)     | Upstream provider   | Tie a single call back to provider-side support tickets.            |
| `x-vmx-event-count` (resp.) | VM-X                | Count of audit events emitted on this request (routing, fallback…). |

## Next steps

- [Chat Completions](./chat-completions.md) — `/chat/completions` reference + examples
- [Anthropic Messages](./anthropic-messages.md) — `/anthropic/messages` reference + examples
- [Responses](./responses.md) — `/responses` reference + examples
- [AI Resources](../ai-resources/index.md) — what `model` resolves to and how routing/fallback compose
