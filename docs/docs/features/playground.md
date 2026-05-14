---
sidebar_position: 6
---

# Playground

VM-X ships with an in-app **Playground** for trying out completions
without leaving the console. It lives at:

```
/workspaces/<workspaceId>/<environmentId>/playground
```

…and is reachable from the sidebar's "Workspaces" submenu, or from any
AI Resource edit page via the **Open playground** button (which
deep-links with the resource preselected via `?resourceId=<id>`).

## Picking the model: Resource vs. Connection / Model

A toggle at the top of the page picks the source of the model spec:

- **Use AI Resource** — pick from the workspace's existing resources.
  Empty workspaces show a "Create AI Resource" CTA. Otherwise the
  picker pre-selects the first resource alphabetically (or the one
  passed via `?resourceId=<id>`).

- **Use Connection / Model** — type a connection name and a model name
  directly. The synthesised resource's `name` becomes
  `<connection>/<model>`; the gateway recognises the slash syntax and
  builds an ephemeral resource on the fly, so you can prototype against
  any connection without first wrapping it in a Resource.

## Picking the request shape (the surface toggle)

A three-way toggle picks which **gateway endpoint** the playground
posts to. All three drive the same `useChat` hook from the Vercel AI
SDK; only the upstream wire shape differs, and all three flow through
the same routing / fallback / capacity / audit pipeline as production
traffic.

- **OpenAI — Chat Completions** — classic `POST /chat/completions`
  shape; supports streaming on/off, all OpenAI-compatible providers,
  plus multimodal attachments (image / audio / file parts).
- **OpenAI — Responses** — OpenAI's typed-events Responses API.
  Reasoning summaries stream out of the box.
- **Anthropic — Messages** — drop-in compatibility with Anthropic's
  `POST /v1/messages`. `thinking` deltas stream as reasoning chunks.

Switching surfaces keeps each tab's chat history independent (each
surface has its own `useChat` instance), so you can A/B the same prompt
across the three shapes without losing prior turns.

> **About the compatibility endpoints.** The toggle picks the _request
> shape_ the gateway accepts — the gateway then converts to the
> resource's configured upstream provider regardless of which shape you
> chose. When the request shape and the resource's provider already
> match (e.g. an Anthropic resource via Anthropic Messages), the
> gateway forwards the body verbatim with no shape conversion.

## Streaming, web search, reasoning

Three header switches:

- **Streaming** — on by default. When off, the BFF runs the upstream
  call non-streaming (`generateText`) and re-encodes the result as a
  one-burst UI message stream — `useChat` still consumes the same
  protocol, the reply just lands all at once instead of token-by-token.
- **Web search** — asks the BFF to inject the provider's web-search
  tool. The shape varies per surface (see [BFF normalizations](#bff-normalizations-and-guards)).
- **Reasoning effort** — slider with stops `off / min / low / med /
high`. The BFF translates the tier to the right field per surface:
  - Chat Completions → `reasoning_effort` (via
    `providerOptions.openai.reasoningEffort`)
  - Responses → `reasoning: { effort, summary: 'auto' }`
  - Anthropic → `thinking: { type: 'enabled', budget_tokens }`
    (mapped from tier: minimal=1024, low=2048, medium=4096, high=8192)

Models that don't support reasoning ignore the field.

## BFF normalizations and guards

The Playground talks to the gateway through three Next.js BFF routes —
`/api/chat`, `/api/responses`, and `/api/anthropic` — that inject the
`vmx` envelope, attach the signed-in OIDC access token, and normalise a
few provider quirks the Vercel AI SDK is strict about. The gateway
itself preserves upstream wire format verbatim; these adapters live in
the UI so the gateway stays a clean passthrough.

What the BFFs do:

- **Inject the web-search tool per surface**:
  - Chat Completions → `web_search_options: {}` (picked up by OpenAI
    search-class models; Perplexity sonar searches by default).
  - Responses → adds `{ type: 'web_search' }` to `tools[]`.
  - Anthropic Messages → adds Anthropic's canonical
    `{ type: 'web_search_20250305', name: 'web_search' }` server tool;
    the gateway then translates that per upstream provider.
- **Block OpenAI Chat-Completions-only search models** on the Responses
  and Anthropic surfaces. `gpt-5-search-api`,
  `gpt-4o-search-preview`, and `gpt-4o-mini-search-preview` only work
  via Chat Completions; selecting one on the wrong surface returns a
  `400 model_endpoint_mismatch` instead of a confusing upstream 500.
- **Normalise upstream response shapes** the AI SDK's Zod schemas
  reject:
  - Chat Completions: nest flat `url_citation` annotations under their
    `url_citation` sub-object.
  - Responses: drop non-canonical `output[]` items (e.g. Perplexity's
    `search_results`) so the SDK can parse the body; rewrite non-2xx
    JSON error envelopes as a one-frame SSE `error` event on the
    streaming path.
  - Anthropic: strip the placeholder `thinking` content in
    `message_start`, drop `citations: null` from non-streaming bodies,
    and SSE-encode JSON error envelopes on the streaming path.

These are the kinds of quirks you'd otherwise hit as silent 500s. They
live exclusively in the BFF — the gateway never rewrites a provider
body.

## Gateway envelope inputs

A side panel exposes the optional `vmx` envelope inputs so you can
exercise correlation, metadata-tagging, and per-call resource overrides
without leaving the playground. See
[The `vmx` envelope](./api/vmx-envelope.md) for the full field list.

- **Correlation ID** — forwarded as `vmx.correlationId`; surfaces on
  the audit row, metrics, and the `x-vmx-correlation-id` response
  header.
- **Metadata** — key/value pairs forwarded as `vmx.metadata`. The
  playground always tags sends with `playground=true` and the
  signed-in `user_id` so audit/usage filters can separate playground
  traffic from real workload. User-specified pairs win on key
  collision.
- **Resource override JSON** — a free-form JSON object shallow-merged
  on top of the picked resource and forwarded as
  `vmx.resourceConfigOverrides` for the duration of the call. Handy
  for swapping the model or tightening retries/timeouts without
  editing the resource. Example:

  ```json
  {
    "model": {
      "provider": "anthropic",
      "connectionId": "<connId>",
      "model": "claude-haiku-4-5-20251001"
    }
  }
  ```

## Multimodal input

The chat box accepts:

- **Images** — paste from the clipboard (most common: screenshots),
  drag/drop onto the chat panel, or click the paperclip.
- **Audio** — drag/drop or paperclip; encodes inline as base64.
- **Files** — generic; same upload flow.

Each attachment shows up as a chip above the input with its type icon,
filename, size, and a remove (✕) button. Total attachment payload is
capped at **100 MB** per request — the BFF and Fastify gateway are both
configured for that ceiling.

> **Attachments are Chat-Completions-only today.** The Responses and
> Anthropic surfaces ignore the `files` argument; only the
> `/api/chat` route forwards them downstream.

### Audit drawer + storage

Every bot reply has a **View audit details** action that opens an
in-page drawer with the matching audit row (cost, headers, events,
full response payload). The audit service buffers writes for up to
10 s before flushing to Postgres, so a quick click right after a reply
polls every 2 s until the row lands.

Audit rows store **metadata only** for attachments — the mime type,
byte size, and a SHA-256 of the base64 payload — not the bytes
themselves. This keeps the `request_audit.request_payload` JSONB
column small and avoids carrying potentially-PII'd bytes around. The
live request to the provider always includes the full bytes; only the
audit-row copy is sanitised.

## How state is kept

The page is a client component. State lives in React `useState` /
`useChat` only — nothing is persisted to `localStorage`, so a refresh
clears history. Each surface has its own `useChat` instance keyed by
the selected resource (or the literal `connection-model-ephemeral` key
in Connection / Model mode), so switching surfaces keeps per-tab
history while switching the resource resets it.

## See also

- [Chat Completions API](./api/chat-completions.md)
- [Responses API](./api/responses.md)
- [Anthropic Messages API](./api/anthropic-messages.md) —
  format-preservation rules for the `anthropic/messages` route.
- [The `vmx` envelope](./api/vmx-envelope.md) — what the playground's
  side panel forwards.
- [Web search](./api/web-search.md) — per-surface tool wiring and the
  Chat-Completions-only model list.
