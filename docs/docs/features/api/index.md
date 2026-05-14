---
sidebar_position: 1
slug: /api
---

# API surfaces

VM-X is a **multi-surface gateway**: it exposes three top-level
completion surfaces under each workspace/environment, and every surface
feeds the same routing / fallback / capacity / audit pipeline. Pick the
surface that matches the SDK your application already speaks — every
upstream provider VM-X supports is reachable from every surface.

| Surface                            | Path                                                                   | Request shape           | Native client       |
| ---------------------------------- | ---------------------------------------------------------------------- | ----------------------- | ------------------- |
| **Chat Completions** (most common) | `POST /v1/completion/{workspaceId}/{environmentId}/chat/completions`   | OpenAI Chat Completions | `openai` SDK        |
| **Anthropic Messages**             | `POST /v1/completion/{workspaceId}/{environmentId}/anthropic/messages` | Anthropic Messages      | `@anthropic-ai/sdk` |
| **Responses**                      | `POST /v1/completion/{workspaceId}/{environmentId}/responses`          | OpenAI Responses        | `openai` SDK        |

Pick the endpoint that matches the SDK your application already uses.
You don't need to bring a third dependency just to talk to VM-X.

## Which endpoint should I use?

```
Already using the OpenAI SDK?
├── Yes → /chat/completions  (most common, broadest provider compatibility)
│         …or /responses if you need typed event streaming, agentic loops,
│                          or OpenAI-native server tools (web_search, etc.)
└── No
    ├── Already using @anthropic-ai/sdk? → /anthropic/messages
    │   (full access to cache_control, extended thinking, server tools,
    │    service_tier, top_k, etc.)
    └── Building from scratch? → /chat/completions for the broadest
                                  ecosystem; /responses if you'll lean
                                  into OpenAI's agentic loop primitives.
```

## Why three endpoints?

Different teams standardise on different SDKs:

- The **OpenAI SDK** is the most-used one and what most tutorials show.
- Anthropic's **`@anthropic-ai/sdk`** is the canonical client for Claude
  features that don't have an OpenAI equivalent — `cache_control`,
  extended `thinking`, server tools (`web_search`, `code_execution`,
  `bash`, `text_editor`, `computer`), `service_tier`, refusal stop
  details, and so on.
- The **Responses API** is OpenAI's newer event-typed shape used by their
  agentic loops.

VM-X accepts all three on the wire so you can integrate without
rewriting the call site, and routes the request through the same
gateway pipeline regardless of the format.

## Surface × provider conversion matrix

Each provider package exposes one **converter class per surface**
(`openai-chat-completion.provider.ts`, `openai-response.provider.ts`,
`anthropic-messages.provider.ts`). The orchestrator dispatches the
incoming wire body to the matching method on the resolved provider —
`provider.openAICompletion(...)`, `provider.openAIResponse(...)`, or
`provider.anthropicMessages(...)` — and the converter is responsible for
mapping the surface body to whatever the upstream actually accepts.

When the wire format matches the upstream's native shape, the converter
sends the body **verbatim** — Anthropic-only features that have no
OpenAI equivalent (`cache_control`, extended `thinking`, `top_k`, server
tools, `service_tier`, …) round-trip losslessly. When they don't match,
the converter rewrites the request, dispatches in the upstream's native
form, and converts the response back on the way out. Fields the
conversion can't express are stowed on a private `__vmx_passthrough`
envelope so a fallback to a native-format provider later in the chain
can re-attach them; provider-specific fields with no analogue are
dropped (logged), never silently corrupted.

Every cell in the matrix below is supported — the gateway routes any of
the three surfaces to any provider:

| Surface ↓ / Provider → | OpenAI | Anthropic | Bedrock-Converse | Bedrock-Invoke | Gemini | Groq | Perplexity |
| ---------------------- | :----: | :-------: | :--------------: | :------------: | :----: | :--: | :--------: |
| **Chat Completions**   |  yes   |    yes    |       yes        |      yes       |  yes   | yes  |    yes     |
| **Responses**          |  yes   |    yes    |       yes        |      yes       |  yes   | yes  |    yes     |
| **Anthropic Messages** |  yes   |    yes    |       yes        |      yes       |  yes   | yes  |    yes     |

For per-cell fidelity detail (which exact fields drop, which translate,
which round-trip) read the converter under
[`packages/api/src/ai-provider/<provider>/`](https://github.com/vm-x-ai/vm-x-ai/tree/main/packages/api/src/ai-provider)
alongside its live spec at
[`__integration__/providers/<provider>.spec.ts`](https://github.com/vm-x-ai/vm-x-ai/tree/main/packages/api/src/__integration__/providers).
The [AI provider architecture](https://github.com/vm-x-ai/vm-x-ai/blob/main/contributing-docs/ai-providers.md)
contributor doc covers the converter pattern itself.

## The VMX envelope

Each surface body accepts an opt-in `vmx` object (clients that can't
modify the typed SDK body can use a top-level `__vmx_passthrough`
instead) carrying VM-X-specific fields the provider SDKs don't know
about — resource overrides, audit metadata, request timeouts, and
`providerArgs` for upstream-native fields the surface shape can't
express. The envelope is identical across all three surfaces. See the
[VM-X envelope](./vmx-envelope.md) page for the full field reference.

## Authentication

All three endpoints accept either of two auth header forms:

```
Authorization: Bearer <vmx-api-key>
```

…or:

```
x-api-key: <vmx-api-key>
```

The API key is scoped to a workspace + environment and an allow-list of
AI Resources. Find it under **Security → API Keys** in the dashboard.

## Resource-name model

Every endpoint takes the **AI Resource name** in the `model` field
— not the upstream provider's model id. The resource decides which
provider, which model, what routing rules, what fallback chain.

```jsonc
{
  "model": "my-resource", // ← VM-X resource name, NOT 'gpt-4o-mini'
  "messages": [{ "role": "user", "content": "..." }]
}
```

### Ad-hoc addressing — `<connection_name>/<model>`

If you don't want to pre-create an AI Resource, pass
`<connection_name>/<model>` in the `model` field. The gateway looks up
the connection by name in this workspace/environment and dispatches the
request directly to that connection + upstream model — no resource
record needed.

```jsonc
{
  // ← uses the "openai-prod" connection, gpt-4o-mini model
  "model": "openai-prod/gpt-4o-mini",
  "messages": [{ "role": "user", "content": "..." }]
}
```

The first `/` is the separator; anything after it is the upstream model
id verbatim (so `bedrock-prod/anthropic.claude-3-5-sonnet-20241022-v2:0`
works as you'd expect, including the `:0` suffix). If no connection of
that name exists, VM-X falls back to looking the literal string up as a
resource name — so resource names containing `/` still resolve normally.

Trade-off: ad-hoc addressing **bypasses resource-level routing,
fallback, and capacity** (connection-level capacity still applies, and
every request is still audited). Use it for one-off calls, scratch
work, or when you've intentionally chosen to skip the resource layer.
For routing and fallback chains, define an AI Resource and pass its
name instead.

To override an existing resource's model on a single request without
the `/` shortcut, see
[`vmx.resourceConfigOverrides`](./vmx-envelope.md#field-reference) on
the vmx envelope page.

## Headers VM-X adds to every response

| Header                      | Value                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| `x-vmx-model`               | The model that actually ran (after routing + fallback resolution).                        |
| `x-vmx-provider`            | Provider id (`openai` / `anthropic` / `aws-bedrock` / …).                                 |
| `x-vmx-connection-id`       | UUID of the AI Connection used.                                                           |
| `x-vmx-gate-duration-ms`    | Time the gate took to evaluate capacity + prioritization (ms).                            |
| `x-vmx-routing-duration-ms` | Time the routing service took to pick a model (ms). Absent when no routing was evaluated. |
| `x-vmx-event-count`         | Number of audit events emitted on the request (routing, fallback, …).                     |
| `x-vmx-metadata-<key>`      | Echo of every `vmx.metadata` entry, lower-cased and CRLF-stripped.                        |
| `x-request-id`              | Forwarded from the upstream provider when present.                                        |
| `x-ratelimit-*`             | Rate-limit headers from the upstream, normalised to OpenAI's shape.                       |

## Errors

The gateway's error responses follow the OpenAI error shape:

```json
{
  "error": {
    "message": "Resource has reached the limit of requests",
    "code": "resource_exhausted"
  }
}
```

Two flavours of `error.code` show up on the wire:

- **OpenAI-compatible codes** (lower-case, set on `CompletionError.openAICompatibleError`)
  for completion-time failures — these are the codes you'll match on in
  client retry logic.
- **VM-X service-error codes** (UPPER_SNAKE_CASE, the
  [`ErrorCode`](https://github.com/vm-x-ai/vm-x-ai/blob/main/packages/api/src/error-code.ts)
  enum) for resource / auth / lookup failures raised before dispatch.

Common codes:

| HTTP status   | `error.code`                               | Meaning                                                                                               |
| ------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `400`         | `invalid_request`                          | Malformed upstream-provider body, unsupported parameter, or unsafe outbound URL (`url-safety` guard). |
| `400`         | `blocked_by_routing_condition`             | A routing rule with `action: BLOCK` matched.                                                          |
| `400`         | `aws_bedrock_invoke_image_url_unsupported` | Bedrock-Invoke can't fetch external image URLs server-side; use base64 `data:` URLs.                  |
| `400`         | `WORKSPACE_NOT_MEMBER`                     | The authenticated principal isn't a member of the addressed workspace.                                |
| `401` / `403` | (NestJS guard message)                     | API key missing / invalid, or principal lacks `RoleGuard` permission. No `error.code` is set.         |
| `404`         | `AI_RESOURCE_NOT_FOUND`                    | Resource name doesn't exist in this workspace/environment.                                            |
| `404`         | `API_KEY_NOT_FOUND`                        | The API key id wasn't found.                                                                          |
| `404`         | `API_KEY_RESOURCE_NOT_AUTHORIZED`          | The API key isn't allow-listed for the requested resource.                                            |
| `429`         | `resource_exhausted`                       | Capacity gate denied (RPM/TPM cap hit) — see `Retry-After` header on the response.                    |
| `429`         | `prioritization_gate_denied`               | Prioritization gate denied because the pool was over its share.                                       |
| `5xx`         | provider-specific                          | Upstream provider error — the gateway propagates the upstream's status + body.                        |

Errors that occur **after streaming has started** are emitted in the
endpoint's native streaming envelope:

| Endpoint           | Mid-stream error frame                                          |
| ------------------ | --------------------------------------------------------------- |
| Chat Completions   | `data: { "error": {...} }\n\n` followed by `data: [ERROR]\n\n`  |
| Responses          | `event: error\ndata: { "error": {...} }\n\n` (no `[DONE]` tail) |
| Anthropic Messages | `event: error\ndata: { "error": {...} }\n\n` (no `[DONE]` tail) |

## Pages in this section

- **[Chat Completions](./chat-completions.md)** — `/chat/completions` reference + examples
- **[Responses](./responses.md)** — `/responses` reference + examples
- **[Anthropic Messages](./anthropic-messages.md)** — `/anthropic/messages` reference + examples
- **[VM-X envelope](./vmx-envelope.md)** — `vmx`, `__vmx_passthrough`, `providerArgs`
- **[Web search](./web-search.md)** — provider-by-provider web search guide

## Next steps

- [AI Resources](../ai-resources/index.md) — pick the model strategy your endpoint resolves to
- [LLM Providers](../../integrations/providers/index.md) — provider-specific config + capability deep dives
- [Usage and Analytics](../usage.md) — read your traffic back via the Audit + Usage pages
