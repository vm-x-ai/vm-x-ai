# Provider Integration Tests

The API package ships a live integration suite that hits real provider APIs
through the VM-X provider classes. It's opt-in so default `nx run api:test`
stays free and offline.

Source: [`packages/api/src/__integration__/`](../packages/api/src/__integration__/README.md)
(the suite has its own README with the coverage matrix).

## Master switch

Without `RUN_LIVE_PROVIDER_TESTS=1`, every provider spec is skipped. The
offline converter test (`responses/converter.spec.ts`) always runs.

```bash
pnpm nx run api:test                        # converter test only
RUN_LIVE_PROVIDER_TESTS=1 pnpm nx run api:test   # full live suite
```

## Required env vars

Place these in the workspace-root `.env.local` (the suite reads it
automatically):

| Provider               | Required keys                        |
| ---------------------- | ------------------------------------ |
| OpenAI                 | `OPENAI_API_KEY`                     |
| Anthropic              | `ANTHROPIC_API_KEY`                  |
| Groq                   | `GROQ_API_KEY`                       |
| Gemini                 | `GEMINI_API_KEY`                     |
| Perplexity             | `PERPLEXITY_API_KEY`                 |
| AWS Bedrock (Converse) | `AWS_BEDROCK_ROLE_ARN`, `AWS_REGION` |
| AWS Bedrock (Invoke)   | `AWS_BEDROCK_ROLE_ARN`, `AWS_REGION` |

Provider keys are independent — each provider's specs auto-skip when its key
is missing. Bedrock additionally needs AWS credentials in the shell (e.g.
`aws-vault exec my-profile -- pnpm nx run api:test`).

## Optional model overrides

Each test uses a "cheap, deterministic" default model. Override via env:

| Env var                        | Default                                       |
| ------------------------------ | --------------------------------------------- |
| `OPENAI_TEST_MODEL`            | `gpt-4o-mini`                                 |
| `OPENAI_SEARCH_TEST_MODEL`     | `gpt-4o-mini-search-preview`                  |
| `OPENAI_REASONING_TEST_MODEL`  | `o4-mini`                                     |
| `ANTHROPIC_TEST_MODEL`         | `claude-haiku-4-5`                            |
| `GROQ_TEST_MODEL`              | `llama-3.3-70b-versatile`                     |
| `GEMINI_TEST_MODEL`            | `gemini-2.5-flash`                            |
| `PERPLEXITY_TEST_MODEL`        | `sonar`                                       |
| `PERPLEXITY_SEARCH_TEST_MODEL` | `sonar-pro`                                   |
| `BEDROCK_TEST_MODEL`           | `us.anthropic.claude-haiku-4-5-20251001-v1:0` |
| `BEDROCK_INVOKE_TEST_MODEL`    | `us.anthropic.claude-haiku-4-5-20251001-v1:0` |

## Running a single provider

```bash
RUN_LIVE_PROVIDER_TESTS=1 pnpm nx run api:test -- \
  src/__integration__/providers/openai.spec.ts
```

## What the suite does NOT cover

Read [`packages/api/src/__integration__/README.md`](../packages/api/src/__integration__/README.md)
for the full coverage matrix. Notably, this suite tests provider classes
**directly** — it doesn't go through HTTP, routing, fallback, audit writes,
or cost calculation. End-to-end HTTP tests are tracked separately.
