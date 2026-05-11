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
deep-links with the resource preselected).

## Two modes

A toggle at the top of the page picks the source of the model spec:

- **Use AI Resource** — pick from the workspace's existing resources.
  Empty workspaces show a "Create AI Resource" CTA. Otherwise the
  picker pre-selects the first resource alphabetically (or the one
  passed via `?resourceId=<id>`).

- **Use Connection / Model** — type a connection name and a model
  name directly. The gateway parses `<connection_name>/<model_name>`
  and builds an ephemeral resource on the fly, so you can prototype
  against any connection without first wrapping it in a Resource.

## Endpoint mode + Streaming

A toggle group at the top of the page picks one of three input
formats. Each completion can be sent through:

- **OpenAI — Chat Completions** (default) — OpenAI's classic shape;
  supports streaming on/off, all OpenAI-compatible providers, plus
  multimodal attachments (image / audio / file parts).
- **OpenAI — Responses** — OpenAI's newer typed-events API. The
  Streaming toggle is disabled in this mode (single-shot
  non-streaming).
- **Anthropic — Messages** — drop-in compatibility with Anthropic's
  `POST /v1/messages`. Same streaming caveat as Responses (toggle
  disabled).

All three go through the same routing/fallback/capacity/audit
pipeline as production traffic.

## Web search

Toggle **Web search** to ask the gateway to enable provider web
search:

- Chat Completions → `web_search_options: {}` (OpenAI search-class
  models, Perplexity sonar models)
- Responses → `tools: [{ type: 'web_search_preview' }]`
- Anthropic Messages → `tools: [{ type: 'web_search_20250305' }]`

Providers that don't recognise the field ignore it.

## Gateway envelope inputs

A side panel on the page exposes the optional `vmx` envelope inputs
so you can exercise correlation, metadata-tagging, and per-call
resource overrides without leaving the playground:

- **Correlation ID** — forwarded as `vmx.correlationId`; lets you
  group multi-step calls in the audit / usage views.
- **Metadata** — key/value pairs forwarded as `vmx.metadata`. The
  playground always tags sends with `playground=true` and the
  signed-in `user_id` so audit filters can separate playground
  traffic from real workload.
- **Resource override JSON** — a free-form JSON object merged into
  the resource via `vmx.resourceConfigOverrides` for the duration of
  the call (handy for tweaking model parameters without saving the
  resource).

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

The gateway forwards the attachment as the right OpenAI content type
(`image_url` data URL, `input_audio`, `file`) and lets the provider
decide whether it can handle that modality. If the provider rejects it,
the error surfaces in the chat panel.

### Audit + storage

Audit rows store **metadata only** for attachments — the mime type,
byte size, and a SHA-256 of the base64 payload — not the bytes
themselves. This keeps the `request_audit.request_payload` JSONB
column small and avoids carrying potentially-PII'd bytes around. The
live request to the provider always includes the full bytes; only the
audit-row copy is sanitised.

## See also

- [Chat Completions API](./api/chat-completions.md)
- [Responses API](./api/responses.md)
- [Anthropic Messages API](./api/anthropic-messages.md) —
  format-preservation rules for the `anthropic/messages` route.
- [The `vmx` envelope](./api/vmx-envelope.md) — what the playground's
  side panel forwards.
- [Web search](./api/web-search.md) — per-format toggle wiring.
