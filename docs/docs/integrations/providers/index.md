---
sidebar_position: 1
---

# LLM Providers

VM-X supports seven providers — five direct vendors plus two flavors
of AWS Bedrock. Each lives in its own folder under
`packages/api/src/ai-provider/<folder>/` and exposes up to three
per-surface converter classes (one per [API endpoint](../../features/api/index.md)).
Pick one (or several — VM-X is built for multi-provider routing) by
creating an **AI Connection**.

| Provider                                                         | Provider id          | Folder                 | Endpoint shape on the wire                    | Auth     |
| ---------------------------------------------------------------- | -------------------- | ---------------------- | --------------------------------------------- | -------- |
| [OpenAI](./openai.md)                                            | `openai`             | `openai`               | OpenAI Chat Completions + Responses           | API key  |
| [Anthropic](./anthropic.md)                                      | `anthropic`          | `anthropic`            | Anthropic Messages (native SDK)               | API key  |
| [Google Gemini](./gemini.md)                                     | `gemini`             | `gemini`               | OpenAI-compat + native `@google/genai` SDK    | API key  |
| [Groq](./groq.md)                                                | `groq`               | `groq`                 | OpenAI-compatible endpoint                    | API key  |
| [Perplexity](./perplexity.md)                                    | `perplexity`         | `perplexity`           | OpenAI-compatible endpoint (search-augmented) | API key  |
| [AWS Bedrock (Converse)](./aws-bedrock.md)                       | `aws-bedrock`        | `aws-bedrock-converse` | Bedrock Converse                              | IAM role |
| [AWS Bedrock-Invoke (Anthropic on AWS)](./aws-bedrock-invoke.md) | `aws-bedrock-invoke` | `aws-bedrock-invoke`   | Anthropic Messages via Bedrock InvokeModel    | IAM role |

### One-line summaries

- **OpenAI** — direct vendor; Chat Completions + Responses are both
  native, so they passthrough on their respective endpoints.
- **Anthropic** — direct vendor via the official Anthropic SDK;
  Anthropic Messages is the native shape (passthrough).
- **Google Gemini** — OpenAI-compat by default; auto-routes to the
  native `@google/genai` SDK when the request uses a Gemini-only
  feature (server tools, grounding, `web_search_options`).
- **Groq** — fast Llama / Mixtral inference on the OpenAI-compat
  endpoint.
- **Perplexity** — OpenAI-compat Sonar models; every completion is
  search-augmented (custom `tools` not exposed).
- **AWS Bedrock (Converse)** — pan-vendor Bedrock surface (Anthropic,
  Llama, Mistral, Cohere, Titan, …) via the Converse API; IAM auth.
- **AWS Bedrock-Invoke** — Anthropic models on Bedrock via
  `InvokeModel` using the native Anthropic wire format; preserves
  `cache_control`, `thinking`, server tools, etc. end-to-end.

## Endpoints

Every provider can be reached through any of the three VM-X
endpoints — the gateway converts request and response shapes when
they don't match the provider's native wire format. See [API
Endpoints](../../features/api/index.md) for the full per-endpoint
contract.

The gateway's per-pair conversion matrix (no internal pivot — every
non-passthrough cell has a direct converter that targets the
provider's wire format in one hop):

|                            | Chat Completions                  | Responses                                      | Anthropic Messages              |
| -------------------------- | --------------------------------- | ---------------------------------------------- | ------------------------------- |
| **OpenAI**                 | ✅ passthrough                    | ✅ **passthrough** (native `responses.create`) | direct ↔ Responses (single hop) |
| **Anthropic** (native SDK) | direct ↔ Anthropic                | direct ↔ Anthropic                             | ✅ **passthrough**              |
| **Gemini**                 | ✅ passthrough¹                   | direct ↔ Chat Completions                      | direct ↔ Chat Completions       |
| **Groq**                   | ✅ passthrough                    | direct ↔ Chat Completions                      | direct ↔ Chat Completions       |
| **Perplexity**             | ✅ passthrough                    | direct ↔ Chat Completions                      | direct ↔ Chat Completions       |
| **AWS Bedrock (Converse)** | direct ↔ Converse                 | direct ↔ Converse                              | direct ↔ Converse               |
| **AWS Bedrock-Invoke**     | direct ↔ Anthropic + Bedrock-wire | direct ↔ Anthropic + Bedrock-wire              | ✅ **passthrough**              |

¹ Gemini's chat-completion path automatically routes to Google's
**native `@google/genai` SDK** when the request carries a Gemini-only
tool descriptor (`googleSearch`, `googleSearchRetrieval`,
`urlContext`, `codeExecution`, `fileSearch`) or `web_search_options`.
The native path supports streaming + non-streaming for grounded
flows; everything else stays on the OpenAI-compat endpoint. See
[Gemini](./gemini.md#native-google-genai-fallback) for the supported
subset.

"Passthrough" means **no information loss**: provider-only fields
(`cache_control`, `thinking`, `top_k`, `service_tier`, server tools,
betas, …) round-trip unchanged on the wire. "Direct ↔ X" means the
gateway has a single-hop converter into the provider's wire format —
no pivot through a third format. Cross-format details live on the
[API Endpoints](../../features/api/index.md) pages.

## Capabilities at a glance

| Feature                         | OpenAI |      Anthropic       | Gemini | Groq | Perplexity | Bedrock |    Bedrock-Invoke    |
| ------------------------------- | :----: | :------------------: | :----: | :--: | :--------: | :-----: | :------------------: |
| Streaming                       |   ✅   |          ✅          |   ✅   |  ✅  |     ✅     |   ✅    |          ✅          |
| Function / tool calling         |   ✅   |          ✅          |   ✅   | ✅¹  |     —      |   ✅    |          ✅          |
| Vision input                    |   ✅   |          ✅          |   ✅   |  —   |     —      |   ✅    |          ✅          |
| Prompt caching                  |   —    |          ✅          |   —    |  —   |     —      |    —    |          ✅          |
| Extended thinking               |   —    |          ✅          |   —    |  —   |     —      |    —    |          ✅          |
| Server tools (`web_search`, …)  |   —    |          ✅          |   —    |  —   |    ✅²     |    —    |          ✅          |
| Reasoning tokens reported       |   ✅   |          ✅          |   ✅   |  —   |     —      |   ✅    |          ✅          |
| Per-call retries (`maxRetries`) |   ✅   |          ✅          |   ✅   |  ✅  |     ✅     |   ✅    |          ✅          |
| Native cost-tracking columns    |   ✅   | ✅ (cache breakdown) |   ✅   |  ✅  |     ✅     |   ✅    | ✅ (cache breakdown) |

¹ Best on the larger Llama models (`llama-3.3-70b-versatile`); the
smaller `8b-instant` is fast but inconsistent at function calling.
² Built-in for Sonar models — every completion is search-augmented;
custom `tools` aren't exposed.

## Adding a connection

1. Navigate to **AI Connections** in the UI.
2. Click **Create Connection**.
3. Pick the provider, fill in the credentials form, and (optionally)
   set capacity / discovered-rate-limit defaults.
4. Save — the connection becomes available for any AI Resource in
   the same workspace + environment.

See [AI Connections](../../features/ai-connections.md) for the full
walkthrough including credential encryption, capacity, discovered
limits, and the shared IAM-role pattern for AWS providers.

## Adding a new provider (contributors)

The provider classes live in
`packages/api/src/ai-provider/<folder>/` — one folder per provider
with up to three per-surface converter classes plus shared helpers:
`openai-chat-completion.provider.ts`, `openai-response.provider.ts`,
`anthropic-messages.provider.ts`, a `shared.ts`, and an `index.ts`
composer that wires them into one provider entry. The
contributor doc walks through the three "paths" for adding a new
one — extending `OpenAIProvider`, modeling after `AnthropicProvider`
/ `AWSBedrockInvokeProvider`, or full custom — with code skeletons,
DI registration, factory wiring, and the live-flow test matrix:
[`contributing-docs/ai-providers.md`](https://github.com/vm-x-ai/vm-x-ai/blob/main/contributing-docs/ai-providers.md).

## Next steps

- [OpenAI](./openai.md)
- [Anthropic](./anthropic.md)
- [Google Gemini](./gemini.md)
- [Groq](./groq.md)
- [Perplexity](./perplexity.md)
- [AWS Bedrock (Converse)](./aws-bedrock.md)
- [AWS Bedrock-Invoke](./aws-bedrock-invoke.md)
- [AI Connections](../../features/ai-connections.md) — credential & capacity setup
- [AI Resources](../../features/ai-resources/index.md) — pick the provider/model strategy your endpoint resolves to
- [API Endpoints](../../features/api/index.md) — Chat Completions / Anthropic Messages / Responses
