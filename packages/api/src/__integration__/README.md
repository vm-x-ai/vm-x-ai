# Integration & Live Tests

This folder hosts two of the three vitest projects that make up the API
test suite. The split is defined in
[`packages/api/vite.config.ts`](../../vite.config.ts) and surfaced as Nx
configurations in [`nx.json`](../../../../nx.json).

| Project       | Scope                                                                                 | Network |
| ------------- | ------------------------------------------------------------------------------------- | ------- |
| `unit`        | Pure-function and single-service tests under `src/**/*.spec.ts` (NOT in this folder). | No      |
| `integration` | Multi-service mocked-DI specs under `__integration__/` excluding `providers/`.        | No      |
| `live`        | Per-provider specs under `__integration__/providers/<provider>.spec.ts`.              | Yes     |

`api:test` with no configuration suffix runs the `unit` project (the
default in `packages/api/package.json`).

## Running

```bash
# Unit only (CI default for `nx affected -t test`):
pnpm exec nx run api:test:unit

# Mocked integration:
pnpm exec nx run api:test:integration

# Live (real upstream APIs; skips per-cell when keys are absent):
pnpm exec nx run api:test:live

# All three in a single vitest invocation:
pnpm exec nx run api:test:all

# Combined coverage:
pnpm exec nx run api:test:coverage
```

Filter inside a project with `-t` (test name) or a file path:

```bash
pnpm exec nx run api:test:live -- providers/openai
pnpm exec nx run api:test:live -- -t "tool call"
```

## Live test gating

Live specs use vitest's `describe.skipIf(!hasKeys(...))` (see
`__integration__/providers/_keys.ts`) so each cell skips gracefully when
its provider's env var isn't set. There is no master env switch —
unsetting keys is the way to skip live cells.

Live tests use vitest's `retry: 2` to absorb transient network blips.

### Required env vars

| Provider               | Required env vars                                          |
| ---------------------- | ---------------------------------------------------------- |
| OpenAI                 | `OPENAI_API_KEY`                                           |
| Anthropic              | `ANTHROPIC_API_KEY`                                        |
| Groq                   | `GROQ_API_KEY`                                             |
| Gemini                 | `GEMINI_API_KEY`                                           |
| Perplexity             | `PERPLEXITY_API_KEY`                                       |
| AWS Bedrock (Converse) | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` |
| AWS Bedrock (Invoke)   | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` |

Put keys in a workspace-root or `packages/api/`-local `.env.local`. Nx
auto-loads both. Setting them in your shell also works.

### Optional model overrides

| Variable                       | Default                                       |
| ------------------------------ | --------------------------------------------- |
| `OPENAI_TEST_MODEL`            | `gpt-4o-mini`                                 |
| `OPENAI_SEARCH_TEST_MODEL`     | `gpt-4o-mini-search-preview`                  |
| `ANTHROPIC_TEST_MODEL`         | `claude-haiku-4-5`                            |
| `GROQ_TEST_MODEL`              | `llama-3.3-70b-versatile`                     |
| `GEMINI_TEST_MODEL`            | `gemini-2.5-flash-lite`                       |
| `PERPLEXITY_TEST_MODEL`        | `sonar`                                       |
| `PERPLEXITY_SEARCH_TEST_MODEL` | `sonar-pro`                                   |
| `BEDROCK_TEST_MODEL`           | `us.anthropic.claude-haiku-4-5-20251001-v1:0` |
| `BEDROCK_INVOKE_TEST_MODEL`    | `us.anthropic.claude-haiku-4-5-20251001-v1:0` |

## Where to put new tests

| Path                                           | Project       |
| ---------------------------------------------- | ------------- |
| `src/**/*.spec.ts` (next to source)            | `unit`        |
| `__integration__/resource-features/*.spec.ts`  | `integration` |
| `__integration__/providers/<provider>.spec.ts` | `live`        |
| `__integration__/responses/*.spec.ts`          | `integration` |

## Why test providers directly (not the HTTP endpoint)

The live suite calls each provider class directly rather than booting
the full Nest app. That avoids needing Postgres, Redis, and OIDC up,
which keeps the suite fast — but it also means routing, fallback,
audit, gating, and cost calculation are NOT exercised here. Those are
covered by the mocked-DI specs in `resource-features/`.
