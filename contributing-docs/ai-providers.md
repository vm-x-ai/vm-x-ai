# AI providers — architecture & "how to add one"

Canonical internal guide for adding or modifying a provider. Sibling read:
[`conversion-matrix.md`](./conversion-matrix.md) (what survives each
input-format → wire conversion). For per-cell behaviour detail, read
the converter under `packages/api/src/ai-provider/<provider>/`
alongside its `*.spec.ts` neighbour and the matching live spec in
`packages/api/src/__integration__/providers/<provider>.spec.ts`.

## The hard architectural rule — passthrough fidelity

> **The gateway preserves the upstream wire format verbatim.** Each
> provider class in `packages/api/src/ai-provider/<provider>/` MUST
> return the response in the **same** input format the caller used.
> No format switching mid-pipeline.

Three input surfaces are exposed at the HTTP edge:

| Surface                 | Controller                                                | Service                                                      |
| ----------------------- | --------------------------------------------------------- | ------------------------------------------------------------ |
| OpenAI Chat Completions | `gateway/chat-completions/chat-completions.controller.ts` | `chat-completions.service.ts` → `GatewayOrchestratorService` |
| OpenAI Responses        | `gateway/responses/responses.controller.ts`               | `responses.service.ts` → `GatewayOrchestratorService`        |
| Anthropic Messages      | `gateway/anthropic/anthropic.controller.ts`               | `anthropic.service.ts` → `GatewayOrchestratorService`        |

A request hits its surface's controller, the per-surface service strips
the gateway's `vmx` envelope + folds in `vmx.providerArgs`, and the
shared `GatewayOrchestratorService` (`gateway/gateway-orchestrator.service.ts`)
runs routing/gating/audit and dispatches to **one** of the three
`CompletionProvider` methods. The provider returns the native wire
shape; the orchestrator writes the audit row and forwards to the
client.

Provider-specific client-side quirks (e.g. response-shape massaging a
particular SDK expects) belong in the **BFF / SDK adapter** — never in
`ai-provider/<provider>/`. Anything inside `ai-provider/` either
passes the body through verbatim or runs a cross-format converter
(see "Where conversion lives" below).

## The `CompletionProvider` interface

`packages/api/src/ai-provider/ai-provider.types.ts`:

```ts
interface CompletionProvider {
  provider: AIProviderDto;

  openAICompletion(req: ChatCompletionCreateParams, conn, model, options?): Promise<OpenAICompletionResponse>;
  openAIResponse(req: ResponseCreateParams, conn, model, options?): Promise<OpenAIResponseResponse>;
  anthropicMessages(req: AnthropicMessagesRequest, conn, model, options?): Promise<AnthropicMessagesResponse>;
}
```

Each method:

- Receives the body in its native input format with the `vmx` envelope
  already stripped by the per-surface service.
- Decides internally whether to passthrough (provider's wire shape ==
  input shape) or convert.
- Captures `providerRequestPayload` (the exact body the upstream SDK
  saw) on every success + error path, including mid-stream errors.
- Returns the response in the **same** format. No internal pivot
  format leaks out.

### Per-provider passthrough/convert matrix

| Provider                                           | `openAICompletion`          | `openAIResponse`            | `anthropicMessages`        |
| -------------------------------------------------- | --------------------------- | --------------------------- | -------------------------- |
| `OpenAIProvider`                                   | passthrough                 | passthrough                 | convert via Responses      |
| `GroqProvider` / `PerplexityProvider`              | passthrough (OpenAI-compat) | passthrough (OpenAI-compat) | convert via Responses      |
| `GeminiProvider`                                   | convert ↔ `@google/genai`   | convert ↔ `@google/genai`   | convert ↔ `@google/genai`  |
| `AnthropicProvider`                                | convert ↔ Anthropic         | convert ↔ Anthropic         | passthrough                |
| `AWSBedrockInvokeProvider` (Anthropic on the wire) | convert ↔ Anthropic + AWS   | convert ↔ Anthropic + AWS   | passthrough (Bedrock wire) |
| `AWSBedrockProvider` (Converse)                    | convert ↔ Converse          | convert ↔ Converse          | convert ↔ Converse         |

Anthropic-Messages on the three OpenAI-compat providers pivots through
the **Responses** surface (`openai/anthropic-via-responses.ts`),
not Chat Completions — typed reasoning / refusal / multimodal
function-call output survive that path. See
[`conversion-matrix.md`](./conversion-matrix.md) for what each cell
preserves.

## Per-provider folder layout

Every provider lives under `packages/api/src/ai-provider/<provider>/`
with this canonical 4-to-5-file layout:

```
ai-provider/
  openai/
    shared.ts                          OpenAIConnectionConfig, createOpenAIClient, header helpers
    openai-chat-completion.provider.ts OpenAIChatCompletionProvider  (passthrough)
    openai-response.provider.ts        OpenAIResponseProvider        (passthrough)
    anthropic-messages.provider.ts     OpenAIAnthropicMessagesProvider (Anthropic ↔ Responses)
    anthropic-via-responses.ts         shared Anthropic↔Responses dispatcher (reused by Groq/Perplexity)
    index.ts                           OpenAIProvider composer + DTO + connection-form JSON schema

  gemini/   uses @google/genai natively via GeminiDispatcher (NOT OpenAI subclasses)
  groq/     OpenAI-compat — extends OpenAI classes with createClient override (baseURL = api.groq.com/openai/v1)
  perplexity/ OpenAI-compat — two base URLs (chat-completions vs /v1/responses), see perplexity/shared.ts

  anthropic/
    shared.ts                          AnthropicDispatcher (@Injectable, owns the SDK call), stripGatewayEnvelopes
    openai-chat-completion.provider.ts AnthropicOpenAICompletionProvider
    openai-response.provider.ts        AnthropicOpenAIResponseProvider
    anthropic-messages.provider.ts     AnthropicMessagesProvider (passthrough)
    index.ts                           AnthropicProvider composer

  aws-bedrock-invoke/  Anthropic on the wire + AWS transport (extends AWSBedrockBaseProvider)
  aws-bedrock-converse/ AWS Converse wire shape (extends AWSBedrockBaseProvider)

  aws-bedrock-base.ts                  Abstract base for AWS providers (cached STS-credential client builder)

  adapters/
    anthropic-messages.adapter.ts      OpenAI Chat Completions ↔ Anthropic cross-format converter
    anthropic-reasoning.ts             reasoning_effort ↔ thinkingBudget mapping
    anthropic-server-tools.ts          server-side tool (web search / code exec) normalisation

  passthrough.helpers.ts               stripPassthroughEnvelope, parsePassthroughBody
  response-shape.helpers.ts            detectStreamChunkShape + StreamUsageAccumulator
  url-safety.ts                        assertSafeOutboundUrl (SSRF guard for image/document fetches)
```

**Composer pattern.** Every `index.ts` is a thin `@Injectable` class
that implements `CompletionProvider` by delegating each method to its
sibling per-surface class. It also owns the `AIProviderDto` —
`id`, `name`, `defaultModel`, `config.logo`, and the
`config.connection.form` JSON Schema the UI renders verbatim.

**Shared dispatcher pattern.** Anthropic, Bedrock-Invoke,
Bedrock-Converse and Gemini each ship an `@Injectable` dispatcher
class in `shared.ts` that owns the SDK call + error mapping + stream
wrapping. The three per-surface files inject the dispatcher and call
`dispatch(...)` (or `completion(...)` for Converse). OpenAI / Groq /
Perplexity skip the dispatcher because the OpenAI SDK call already
lives in `OpenAIChatCompletionProvider`.

## Audit row invariant

Every dispatch writes one audit row with these JSONB columns:

| Column                   | Source                                                                     |
| ------------------------ | -------------------------------------------------------------------------- |
| `requestPayload`         | Body the **client** sent (post-`vmx`-strip, pre-conversion).               |
| `providerRequestPayload` | Body the **upstream SDK** saw on the wire.                                 |
| `responseData`           | Native wire response (or chunk array for streams) in the provider's shape. |
| `responseHeaders`        | Filtered to `x-*` headers.                                                 |
| `cost`                   | Per-request cost breakdown (input / output / cached / reasoning / total).  |
| `events`                 | Routing / fallback events fired during dispatch.                           |

`providerRequestPayload` MUST be set on every code path — non-streaming
success, streaming success (on the wrapper before yield), pre-flight
throw, and mid-stream error. The reference patterns are
`AnthropicDispatcher.iterateSdkStream` (`anthropic/shared.ts`) and
`AWSBedrockInvokeDispatcher.parseBedrockEventStream`
(`aws-bedrock-invoke/shared.ts`). Bedrock-Converse threads the wire
body into its stream generator via the `requestBody` parameter.

## Where conversion lives

Cross-format conversion is co-located with the provider that needs it:

```
openai/anthropic-messages.provider.ts        Anthropic ↔ Responses (canonical dispatcher in openai/anthropic-via-responses.ts)
openai/anthropic-via-responses.ts            shared by openai/groq/perplexity
adapters/anthropic-messages.adapter.ts       OpenAI Chat Completions ↔ Anthropic (used by Anthropic + Bedrock-Invoke + Bedrock-Converse)
gateway/responses/from-anthropic.ts          Anthropic Messages → Responses request adapter
gateway/responses/from-chat-completions.ts   Chat Completions → Responses request adapter
gateway/responses/responses-converter.ts     output adapter back to Responses
aws-bedrock-converse/shared.ts               OpenAI Chat Completions ↔ Converse (~1100 LOC)
gemini/shared.ts + per-surface .provider.ts  OpenAI/Anthropic ↔ @google/genai
```

Cross-format converters are pure functions (or `@Injectable` classes
with no transport dependency). The transport — SDK call, retries,
streaming, error mapping — lives in the dispatcher or the per-surface
provider class.

---

# Adding a new provider

## Decision tree

```
What does the upstream speak on the wire?

1. OpenAI Chat Completions–compatible endpoint (Groq / Perplexity pattern)
   → Template A: extend OpenAI's per-surface classes, override createClient.

2. Anthropic Messages on the wire (most "Claude on Y" services)
   → Template B: model after AnthropicProvider or AWSBedrockInvokeProvider.

3. Custom wire shape (Vertex native, Bedrock Converse, proprietary RPC)
   → Template C: model after AWSBedrockProvider or GeminiProvider — write
     all three conversions and own a native dispatcher.
```

## Template A — OpenAI-compat upstream

Effort: ~5 small files, ~150 LOC. Reference: `groq/`.

`<provider>/openai-chat-completion.provider.ts`:

```ts
import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { OpenAIChatCompletionProvider } from '../openai/openai-chat-completion.provider';
import { type OpenAIConnectionConfig, createOpenAIClient } from '../openai/shared';

const FOOBAR_BASE_URL = 'https://api.foobar.example.com/v1';

@Injectable()
export class FooBarChatCompletionProvider extends OpenAIChatCompletionProvider {
  protected override createClient(connection: AIConnectionEntity<OpenAIConnectionConfig>): Promise<OpenAI> {
    return createOpenAIClient(connection, FOOBAR_BASE_URL);
  }
}
```

`<provider>/openai-response.provider.ts` and
`<provider>/anthropic-messages.provider.ts` follow the same pattern —
extend the OpenAI parent, override `createClient`. The Anthropic-Messages
class injects your `FooBarResponseProvider` so the
Anthropic→Responses pivot routes to your `baseURL`.

`<provider>/index.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { CompletionProvider } from '../ai-provider.types';
import { AIProviderDto } from '../dto/ai-provider.dto';
import { FooBarChatCompletionProvider } from './openai-chat-completion.provider';
import { FooBarResponseProvider } from './openai-response.provider';
import { FooBarAnthropicMessagesProvider } from './anthropic-messages.provider';

export type FooBarConnectionConfig = { apiKey: string };

@Injectable()
export class FooBarProvider implements CompletionProvider {
  provider: AIProviderDto;

  constructor(private readonly chatCompletionProvider: FooBarChatCompletionProvider, private readonly responseProvider: FooBarResponseProvider, private readonly anthropicMessagesProvider: FooBarAnthropicMessagesProvider) {
    this.provider = {
      id: 'foobar',
      name: 'FooBar',
      description: 'FooBar AI Provider',
      defaultModel: 'foobar-medium',
      config: {
        logo: { url: '/assets/logos/foobar.png' },
        connection: {
          form: {
            type: 'object',
            title: 'FooBar Properties',
            required: ['apiKey'],
            properties: {
              apiKey: {
                type: 'string',
                format: 'secret',
                title: 'FooBar API Key',
                placeholder: 'e.g. fb_…',
                description: 'Get a key at [FooBar Console](https://foobar.example.com/keys).',
              },
            },
            errorMessage: { required: { apiKey: 'API Key is required' } },
          },
        },
      },
    };
  }

  openAICompletion(req, conn, model, opts) {
    return this.chatCompletionProvider.handle(req, conn, model, opts);
  }
  openAIResponse(req, conn, model, opts) {
    return this.responseProvider.handle(req, conn, model, opts);
  }
  anthropicMessages(req, conn, model, opts) {
    return this.anthropicMessagesProvider.handle(req, conn, model, opts);
  }
}
```

### DI registration

`packages/api/src/ai-provider/ai-provider.module.ts`:

```ts
import { FooBarProvider } from './foobar';
import { FooBarChatCompletionProvider } from './foobar/openai-chat-completion.provider';
import { FooBarResponseProvider } from './foobar/openai-response.provider';
import { FooBarAnthropicMessagesProvider } from './foobar/anthropic-messages.provider';

@Module({
  providers: [
    /* existing */
    FooBarProvider,
    FooBarChatCompletionProvider,
    FooBarResponseProvider,
    FooBarAnthropicMessagesProvider,
    AIProviderService,
  ],
})
```

`packages/api/src/ai-provider/ai-provider.service.ts`:

```ts
constructor(
  /* existing constructor params */
  private readonly fooBarProvider: FooBarProvider,
) {
  /* existing registrations */
  this.providers[fooBarProvider.provider.id] = this.fooBarProvider;
}
```

### Logo asset

Add `packages/api/assets/logos/<provider-id>.png` (square, ≤ 200 KB).

### Test factory

`packages/api/src/__integration__/helpers/factories.ts`:

```ts
export const buildFooBarProvider = () => {
  const logger = makeStubLogger();
  const chat = new FooBarChatCompletionProvider(logger);
  const responses = new FooBarResponseProvider(logger);
  return new FooBarProvider(chat, responses, new FooBarAnthropicMessagesProvider(responses));
};
```

Then add the provider entry to `LIVE_PROVIDERS` in
`packages/api/src/__integration__/helpers/live-flow.ts` (env-key gate

- `buildConnection` + `buildModel` + `supportsTools`). The
  parametrised live-flow specs (`completion.spec.ts`,
  `responses.spec.ts`, `anthropic-messages.spec.ts`) pick it up
  automatically.

## Template B — Anthropic on the wire

Effort: ~7 files. Reference: `aws-bedrock-invoke/` (Anthropic + AWS
transport) or `anthropic/` (native Anthropic SDK).

- `<provider>/shared.ts` — the SDK client + `@Injectable` dispatcher
  with the SDK call, stream wrapper, error mapping. Extend
  `AWSBedrockBaseProvider` (in `ai-provider/aws-bedrock-base.ts`) if
  the transport is AWS.
- `<provider>/openai-chat-completion.provider.ts` — call
  `openAIRequestToAnthropic` from `adapters/anthropic-messages.adapter.ts`,
  then `dispatcher.dispatch(...)`.
- `<provider>/openai-response.provider.ts` — for now route through
  `responses/from-anthropic.ts` or the OpenAI Responses Anthropic
  adapter, then dispatch.
- `<provider>/anthropic-messages.provider.ts` — call
  `stripGatewayEnvelopes(...)` (re-exported from `anthropic/shared.ts`
  → ultimately `passthrough.helpers.ts`) and dispatch verbatim.
- `<provider>/index.ts` — composer + DTO.

Two pitfalls every Anthropic-on-the-wire provider hits:

1. **Strip the gateway envelope.** Anthropic's API rejects unknown
   top-level fields with `400: vmx — Extra inputs are not permitted`.
   `stripPassthroughEnvelope` (alias `stripGatewayEnvelopes`) in
   `ai-provider/passthrough.helpers.ts` is the canonical strip.
2. **Capture `providerRequestPayload`** on every path. See
   `iterateSdkStream` / `parseBedrockEventStream` for the mid-stream
   capture pattern.

## Template C — Custom wire shape

Effort: largest. Reference: `aws-bedrock-converse/shared.ts` (~1100 LOC of
OpenAI ↔ Converse conversion) or `gemini/shared.ts` (~620 LOC + per-surface
converters in the three `.provider.ts` files).

You write:

- `<provider>/shared.ts` — `@Injectable` dispatcher with full
  conversion-helper toolbox + SDK call + streaming wrapper + error
  mapping.
- Three per-surface `.provider.ts` files — each owns the cross-format
  conversion _for its input surface_ (e.g. Gemini's
  `openai-response.provider.ts` does Responses ↔ `@google/genai`
  directly, not via Chat Completions).
- `<provider>/index.ts` — composer with the rich DTO + connection JSON
  Schema (`oneOf` discriminators + `connection.uiComponents` are
  available — see `aws-bedrock-converse/index.ts`).

## What the gateway gives you for free

Handled by `GatewayOrchestratorService` + the per-surface service
**before** dispatch — your provider never sees them:

- **`vmx` envelope** stripped (`vmx.*` keys lifted off the body).
- **`vmx.providerArgs`** spread onto the parsed body after
  `defaultArgs`. Native provider knobs (`top_k`, `safetySettings`,
  `search_recency_filter`, etc.) just appear on `request` — converters
  can read or forward them.
- **`options.signal`** — controller's `aborted` signal. Forward to
  the SDK call so cancellation frees upstream tokens.
- **`options.timeoutMs`** — composed min of `vmx.timeoutMs` and per-model
  `timeoutMs` (capped at 10 min). Hand to the SDK's native `timeout`
  primitive (OpenAI / Anthropic) or compose via `composeAbortSignal`
  (Bedrock, Gemini).
- **`options.maxRetries`** — resolved per-model retry budget.
- **`options.forwardHeaders`** — allow-listed caller headers (only
  `authorization`, `openai-organization`, `openai-project`,
  `openai-beta`, `anthropic-version`, `anthropic-beta`,
  `x-goog-user-project` flow through). Attach to the SDK's
  `defaultHeaders` / `extraHeaders`.

## Tests

- **Unit specs** — sibling `.spec.ts` per `.provider.ts`. Mock the
  SDK; cover conversion edge cases.
- **Integration specs** — `packages/api/src/__integration__/providers/<provider>.spec.ts`.
  Live; `describe.skipIf(!hasKeys(...))` gates on the matching
  `*_API_KEY` env var. Use the `buildFooBarProvider` factory.
- **Parametrised live-flow specs** —
  `packages/api/src/__integration__/live-flow/{completion,responses,anthropic-messages}.spec.ts`.
  Hit every entry in `LIVE_PROVIDERS` (`helpers/live-flow.ts`).

Commands (run from the workspace root):

```bash
pnpm exec nx run api:test:unit          # unit specs (no network)
pnpm exec nx run api:test:integration   # mocked-DI orchestrator + features
pnpm exec nx run api:test:live          # live calls — needs *_API_KEY in .env.local
pnpm exec nx run api:test:all           # unit + integration + live
pnpm exec nx run api:lint
pnpm exec nx run api:typecheck
```

## Connection form schema

The `provider.config.connection.form` field is a JSON Schema fragment
the UI renders verbatim via `react-jsonschema-form`. Common patterns:

| Field type            | JSON Schema                                                             | UI widget               |
| --------------------- | ----------------------------------------------------------------------- | ----------------------- |
| API key               | `{ type: 'string', format: 'secret', title, placeholder, description }` | Password input + reveal |
| URL                   | `{ type: 'string', format: 'uri', title, placeholder }`                 | Plain text input        |
| Enum                  | `{ type: 'string', enum: ['a','b','c'], title }`                        | Dropdown                |
| Optional bool         | `{ type: 'boolean', title, default: false }`                            | Switch                  |
| Branching multi-field | nested `properties` + `oneOf` discriminator                             | Conditional sub-form    |

`description` accepts Markdown (rendered as helper text). For complex
auth (OAuth, AWS role assumption) see `aws-bedrock-converse/index.ts`
for a worked example with `oneOf` discriminator + extra
`connection.uiComponents`.

## Common gotchas

- **Strip `vmx` and `__vmx_passthrough`** before any wire call against
  a strict OpenAI-compat upstream (Groq, native Anthropic) — they 400
  on unknown top-level fields. `OpenAIChatCompletionProvider` calls
  `stripPassthroughEnvelope` for you; non-OpenAI dispatchers MUST
  strip both manually. See
  [`passthrough.helpers.ts`](../packages/api/src/ai-provider/passthrough.helpers.ts).
- **Tool-schema field omission.** Some upstreams reject `null` on
  optional fields (Groq rejects `tools[].function.strict: null`).
  Always _omit_ unset fields rather than passing `null`.
- **Image fetches need SSRF guards.** If your converter fetches
  `image_url` / `document.source.url` server-side, call
  `assertSafeOutboundUrl()` first — blocks RFC1918, AWS IMDS,
  loopback, IPv6 link-local. See
  [`url-safety.ts`](../packages/api/src/ai-provider/url-safety.ts).
- **Streaming-usage capture.** The orchestrator only counts the first
  chunk carrying `usage`. Your stream converter MUST forward the
  upstream's final usage event onto a chunk; otherwise the audit row
  records `null` cost.
- **CamelCase column collisions.** When adding an audit-row column,
  match the migration's snake_case to Kysely's `CamelCasePlugin`
  expectation — `cache_creation_ephemeral_5m_tokens` maps to
  `cacheCreationEphemeral5mTokens` (digit-adjacent underscore is
  dropped). Mis-match makes every audit flush fail silently.

## Reference: where to look

- 3-method interface → `packages/api/src/ai-provider/ai-provider.types.ts`
- Per-provider folders → `packages/api/src/ai-provider/{openai,gemini,groq,perplexity,anthropic,aws-bedrock-invoke,aws-bedrock-converse}/`
- DI module / registration → `packages/api/src/ai-provider/ai-provider.module.ts`, `ai-provider.service.ts`
- AWS base → `packages/api/src/ai-provider/aws-bedrock-base.ts`
- Cross-format adapters → `packages/api/src/ai-provider/adapters/`,
  `packages/api/src/ai-provider/openai/anthropic-via-responses.ts`,
  `packages/api/src/gateway/responses/from-{anthropic,chat-completions}.ts`
- Orchestrator → `packages/api/src/gateway/gateway-orchestrator.service.ts`
- Per-surface services → `packages/api/src/gateway/{chat-completions/chat-completions,responses/responses,anthropic/anthropic}.service.ts`
- Controllers → `packages/api/src/gateway/{chat-completions/chat-completions,responses/responses,anthropic/anthropic}.controller.ts`
- Live-flow specs → `packages/api/src/__integration__/live-flow/{completion,responses,anthropic-messages}.spec.ts`
- Per-provider live specs → `packages/api/src/__integration__/providers/<provider>.spec.ts`
- Cross-format support matrix → [`conversion-matrix.md`](./conversion-matrix.md)
