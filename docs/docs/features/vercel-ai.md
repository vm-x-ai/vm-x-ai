---
sidebar_position: 6
---

# Vercel AI SDK Integration

The [Vercel AI SDK](https://ai-sdk.dev) (`ai` + the `@ai-sdk/*` provider
packages) works with VM-X out of the box. Point `@ai-sdk/openai` at the
`/chat/completions` or `/responses` endpoint, or `@ai-sdk/anthropic` at
the `/anthropic/messages` endpoint — every request flows through the
same gateway, sharing routing, fallback, capacity, and audit.

For the underlying URL pattern, auth header forms, and `vmx` envelope
shape, see the [API overview](./api/index.md) and the
[`vmx` envelope reference](./api/vmx-envelope.md). This page only
covers the Vercel-AI-specific bits.

## Overview

The Vercel AI SDK is a TypeScript-first framework for building AI
applications. It exposes three high-level helpers — `generateText`,
`streamText`, `generateObject` — plus a `tool()` builder for
client-side tool use. The provider packages (`@ai-sdk/openai`,
`@ai-sdk/anthropic`, etc.) handle the actual HTTP calls.

VM-X can stand in as the upstream for any of those provider packages,
because the VM-X gateway speaks the same wire shapes:

- `@ai-sdk/openai` → `/v1/completion/{ws}/{env}/chat/completions`
  (the SDK's `.chat(model)` method) or `/responses` (`.responses(model)`).
- `@ai-sdk/anthropic` → `/v1/completion/{ws}/{env}/anthropic/v1/messages`
  (the SDK auto-appends `/v1/messages` to the configured `baseURL`).

Either route gives you:

- All Vercel AI SDK features (streaming, tool use, structured output, agents)
- VM-X routing, fallback, capacity, and audit
- Centralized AI provider management

## Installation

```bash
pnpm add ai @ai-sdk/openai @ai-sdk/anthropic zod
```

`zod` is only needed if you use `generateObject` or the `tool()` helper.

## Basic Usage

### Chat Completions (`/chat/completions`)

```ts
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';

const workspaceId = 'your-workspace-id';
const environmentId = 'your-environment-id';
const resourceName = 'your-resource-name';

const vmx = createOpenAI({
  baseURL: `http://localhost:3030/api/v1/completion/${workspaceId}/${environmentId}`,
  apiKey: process.env.VMX_API_KEY,
});

const { text, usage } = await generateText({
  model: vmx.chat(resourceName), // AI Resource name, not a provider model id
  prompt: 'What is the weather in São Paulo?',
});

console.log(text);
```

The `baseURL` stops at `…/{ws}/{env}` — the SDK's `.chat(model)` method
appends `/chat/completions` for you. The `apiKey` is sent as
`Authorization: Bearer <key>`, one of the two auth header forms VM-X
accepts. The `model` field is the **AI Resource name**, not an upstream
provider model id — see the
[resource-name model](./api/index.md#resource-name-model) docs.

### Responses (`/responses`)

Same provider, different method:

```ts
const { text } = await generateText({
  model: vmx.responses(resourceName), // SDK appends /responses
  prompt: 'What is the weather in São Paulo?',
});
```

Use Responses when you want OpenAI's event-typed shape — agentic loops,
typed streaming events, or native server-tool support (`web_search`,
etc.). For most apps `vmx.chat()` is the right default.

### Anthropic Messages (`/anthropic/messages`)

```ts
import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';

const vmxAnthropic = createAnthropic({
  baseURL: `http://localhost:3030/api/v1/completion/${workspaceId}/${environmentId}/anthropic`,
  apiKey: process.env.VMX_API_KEY,
});

const { text } = await generateText({
  model: vmxAnthropic(resourceName),
  prompt: 'What is the weather in São Paulo?',
});
```

The Anthropic provider appends `/v1/messages` to the `baseURL`, so end
your `baseURL` at `…/anthropic` (VM-X exposes `…/anthropic/v1/messages`
as an alias for the canonical `…/anthropic/messages` route).

This path keeps Anthropic-only features (`cache_control`, extended
`thinking`, server tools, `top_k`, `service_tier`, …) intact end-to-end
when the resolved provider is Anthropic or AWS Bedrock-Invoke. See the
[Anthropic Messages reference](./api/anthropic-messages.md) for the
passthrough matrix.

## Streaming

```ts
import { streamText } from 'ai';

const stream = streamText({
  model: vmx.chat(resourceName),
  prompt: 'Write a two-sentence story about a robot.',
});

for await (const chunk of stream.textStream) {
  process.stdout.write(chunk);
}

const usage = await stream.usage; // resolved when the stream completes
```

`streamText` works identically against `vmx.chat()`, `vmx.responses()`,
and `vmxAnthropic()`.

## Tool use

The Vercel AI SDK's `tool()` helper + the agentic loop in `generateText`
runs through VM-X transparently — your `execute` function runs locally,
the model's tool calls flow over the wire, and VM-X just sees the
request/response shape it expects.

```ts
import { generateText, stepCountIs, tool } from 'ai';
import { z } from 'zod';

const result = await generateText({
  model: vmx.chat(resourceName),
  stopWhen: stepCountIs(5),
  tools: {
    getWeather: tool({
      description: 'Get the current weather for a city.',
      inputSchema: z.object({ city: z.string() }),
      execute: async ({ city }) => ({ tempC: 22, conditions: 'cloudy', city }),
    }),
  },
  prompt: 'What is the weather in São Paulo?',
});

console.log(result.text);
console.log(`tool calls across ${result.steps.length} steps`);
```

`stopWhen: stepCountIs(N)` caps the loop depth so a runaway model can't
burn tokens forever.

## Structured output

`generateObject` validates the model's response against a Zod schema.

```ts
import { generateObject } from 'ai';
import { z } from 'zod';

const { object } = await generateObject({
  model: vmx.chat(resourceName),
  schema: z.object({
    recipe: z.object({
      name: z.string(),
      ingredients: z.array(z.string()),
      steps: z.array(z.string()),
    }),
  }),
  prompt: 'Generate a short recipe for tomato soup.',
});

console.log(object.recipe);
```

## Sending a `vmx` envelope

VM-X reads its envelope fields (`correlationId`, `metadata`, `timeoutMs`,
`providerArgs`, `resourceConfigOverrides`, `secondaryModelIndex`) from
the **request body** under the `vmx` key. The Vercel AI SDK provider
packages don't expose an `extraBody` hook, but they do accept a custom
`fetch` function — splice the envelope in there:

```ts
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';

function withVmxEnvelope(vmx: Record<string, unknown>): typeof globalThis.fetch {
  return async (input, init) => {
    if (init?.body && typeof init.body === 'string') {
      try {
        const parsed = JSON.parse(init.body);
        init = { ...init, body: JSON.stringify({ vmx, ...parsed }) };
      } catch {
        // Body wasn't JSON (multipart, FormData, …) — leave it alone.
      }
    }
    return globalThis.fetch(input, init);
  };
}

const provider = createOpenAI({
  baseURL,
  apiKey,
  fetch: withVmxEnvelope({
    correlationId: `req-${Date.now()}`,
    metadata: { team: 'growth', user_id: 'u_42' },
    timeoutMs: 15_000,
  }),
});

const { text, response } = await generateText({
  model: provider.chat(resourceName),
  prompt: 'Hello',
});

// VM-X echoes the resolved values via response headers.
console.log(response.headers?.['x-vmx-correlation-id']);
console.log(response.headers?.['x-vmx-model']);
```

The same wrapper works with `@ai-sdk/anthropic` — pass it via the
`fetch` option to `createAnthropic({...})`.

See the [`vmx` envelope reference](./api/vmx-envelope.md) for the full
field list, including `resourceConfigOverrides` (per-request model /
routing override) and `providerArgs` (extra params for the upstream
provider call).

### Alternative: `x-vmx-*` request headers

If you only need `correlationId` and `metadata` (not the full
envelope), VM-X also accepts those via request headers:

```ts
const provider = createOpenAI({
  baseURL,
  apiKey,
  headers: {
    'x-vmx-correlation-id': `req-${Date.now()}`,
    'x-vmx-metadata-team': 'growth',
    'x-vmx-metadata-feature': 'recommendations',
  },
});
```

No custom `fetch` wrapper required. Body-side `vmx` fields still win
on key collision. The body-only fields (`resourceConfigOverrides`,
`providerArgs`, `secondaryModelIndex`, `timeoutMs`) aren't
header-readable — use the `fetch` wrapper for those.

## Authentication

The Vercel AI SDK sends `apiKey` as `Authorization: Bearer <key>` by
default — VM-X accepts that, plus the alternate `x-api-key` header form.
If you need to override the header for any reason, pass `headers` to the
provider factory:

```ts
const vmx = createOpenAI({
  baseURL: '...',
  apiKey: 'unused', // Vercel SDK still requires a non-empty string
  headers: { 'x-api-key': process.env.VMX_API_KEY! },
});
```

## Example project

A complete runnable example is in
[`examples/vercel-ai`](https://github.com/vm-x-ai/vm-x-ai/tree/main/examples/vercel-ai).
It includes one file per scenario:

- `openai-chat.ts` — `generateText` via `/chat/completions`
- `openai-responses.ts` — `generateText` via `/responses`
- `anthropic.ts` — `generateText` via `/anthropic/messages`
- `streaming.ts` — `streamText`
- `tools.ts` — multi-step `tool()` use
- `object.ts` — `generateObject` with a Zod schema
- `vmx-envelope.ts` — custom `fetch` wrapper that injects `correlationId`
  / `metadata` / `timeoutMs` into the request body
- `config.ts` — shared helper that loads `.env.local` and computes the
  `…/{ws}/{env}` and `…/{ws}/{env}/anthropic` base URLs reused by every
  scenario file above

To get started:

```bash
pnpm exec nx run vercel-ai-example:setup          # provision workspace + API key
pnpm exec nx run vercel-ai-example:openai-chat    # run a scenario
pnpm exec nx run vercel-ai-example:tools          # multi-step tool use
```

## Troubleshooting

### `404 Not Found` on `/v1/messages`

The Vercel AI SDK's Anthropic provider appends `/v1/messages` to the
configured `baseURL`. Make sure your `baseURL` ends at `…/anthropic`
(without `/messages`) — VM-X registers `…/anthropic/v1/messages` as an
alias for the canonical `…/anthropic/messages` route, so the SDK's
appended path resolves correctly.

### Model not found

The `model` field takes the **AI Resource name**, not an upstream
provider model id. `vmx.chat('gpt-4o-mini')` will only work if you have
a resource literally named `gpt-4o-mini` — otherwise pick the resource
name you configured in the dashboard.

For one-off calls without a pre-created resource, use the
[ad-hoc addressing](./api/index.md#ad-hoc-addressing--connection_namemodel)
shortcut: `vmx.chat('openai-prod/gpt-4o-mini')` resolves to the
`openai-prod` connection and dispatches directly to `gpt-4o-mini`.
