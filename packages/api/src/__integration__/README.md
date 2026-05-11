# Provider Integration Tests

Live tests that hit real provider APIs through the VM-X provider classes,
plus offline converter tests for the Responses API.

## What runs without keys

- `responses/converter.spec.ts` — runs unconditionally, tests the
  Chat-Completions ↔ Responses-API converter with synthetic streams.

## What runs with keys

Per-provider specs under `providers/` are gated by:

- `RUN_LIVE_PROVIDER_TESTS=1` — master switch. Without this, every
  provider spec is skipped.
- The provider's specific env var(s):

| Provider               | Required env vars                    |
| ---------------------- | ------------------------------------ |
| OpenAI                 | `OPENAI_API_KEY`                     |
| Anthropic              | `ANTHROPIC_API_KEY`                  |
| Groq                   | `GROQ_API_KEY`                       |
| Gemini                 | `GEMINI_API_KEY`                     |
| Perplexity             | `PERPLEXITY_API_KEY`                 |
| AWS Bedrock (Converse) | `AWS_BEDROCK_ROLE_ARN`, `AWS_REGION` |
| AWS Bedrock (Invoke)   | `AWS_BEDROCK_ROLE_ARN`, `AWS_REGION` |

Optional model overrides:

- `OPENAI_TEST_MODEL` (default `gpt-4o-mini`)
- `OPENAI_SEARCH_TEST_MODEL` (default `gpt-4o-mini-search-preview`)
- `ANTHROPIC_TEST_MODEL` (default `claude-haiku-4-5`)
- `GROQ_TEST_MODEL` (default `llama-3.3-70b-versatile`)
- `GEMINI_TEST_MODEL` (default `gemini-2.5-flash`)
- `PERPLEXITY_TEST_MODEL` (default `sonar`)
- `PERPLEXITY_SEARCH_TEST_MODEL` (default `sonar-pro`)
- `BEDROCK_TEST_MODEL` (default `us.anthropic.claude-haiku-4-5-20251001-v1:0`)
- `BEDROCK_INVOKE_TEST_MODEL` (default `us.anthropic.claude-haiku-4-5-20251001-v1:0`)

## Running

```bash
# Default test run — only the converter test fires; provider specs are skipped.
pnpm exec nx run api:test

# Live provider suite — opt in.
RUN_LIVE_PROVIDER_TESTS=1 pnpm exec nx run api:test

# Single provider:
RUN_LIVE_PROVIDER_TESTS=1 pnpm exec nx run api:test -- providers/openai

# Bedrock requires AWS credentials in your shell (e.g. via aws-vault).
```

Keys can be placed in a workspace-root `.env.local`; the suite reads it
automatically before consulting `process.env`.

## Coverage matrix

|                  | simple | tool-call | follow-up | structured      | web-search                         | reasoning     |
| ---------------- | ------ | --------- | --------- | --------------- | ---------------------------------- | ------------- |
| OpenAI           | ✅     | ✅        | ✅        | ✅              | ✅ (annotations HA)                | ✅ (o-series) |
| Anthropic        | ✅     | ✅        | ✅        | ✅              | —                                  |               |
| Groq             | ✅     | ✅ (NS)   |           |                 | —                                  |               |
| Gemini           | ✅     | ✅        |           |                 | ✅ (grounding HA)                  |               |
| Perplexity       | ✅     | —         |           | ✅              | ✅ (citations + search_results HA) |               |
| Bedrock Converse | ✅     | ✅        |           |                 | —                                  |               |
| Bedrock Invoke   | ✅     | ✅        | ✅        | ⚠ skipped (gap) | —                                  |               |

NS = non-streaming only. HA = hard assertion (test fails if the field is missing).
Each cell that supports streaming runs both streaming and non-streaming variants.

## Responses API end-to-end (`responses/end-to-end.spec.ts`)

Drives a real provider's chat completion through the Responses-API
converter (request-side and response-side) and asserts the events that
downstream agent loops rely on:

- OpenAI: non-streaming with usage details, streaming text+usage,
  streaming tool-call argument deltas → done → completed
- Bedrock Invoke (Claude on Anthropic Messages wire): streaming text +
  `response.completed` with input/output_tokens

Skipped without `RUN_LIVE_PROVIDER_TESTS=1` and the relevant keys.

## Known gaps (tracked, not yet covered)

- `aws-bedrock-invoke.spec.ts` "structured output" test is `it.skip` —
  AWSBedrockInvokeProvider does not currently translate
  `response_format: json_schema` into Anthropic's structured-output
  mechanism. Callers hit this via the Responses API
  (`text.format: json_schema` → response_format → silently dropped).
  Unskip when the provider learns to forward this.
- Image input round-trip (`input_image` content parts) — none of the
  providers are tested with images yet.
- `phase: 'final_answer'` passthrough on Anthropic via Responses API — not tested.
- Param-passthrough sanity (frequency_penalty, presence_penalty, stop) — not asserted.

## Why test providers directly (not the HTTP endpoint)

The integration suite calls each provider class _directly_ rather than
booting the full Nest app. That avoids the Postgres / Redis / OIDC stack
and keeps the suite fast, but it does mean we don't exercise routing,
fallback, audit writes, gating, or cost calculation. Those are covered
by separate unit/integration specs (todo) — this suite specifically
verifies the provider classes' request shaping and response parsing
against real APIs.
