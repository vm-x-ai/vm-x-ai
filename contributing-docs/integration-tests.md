# API Test Suite

The `api` package's vitest setup is split into three test **projects**
(declared in [`packages/api/vite.config.ts`](../packages/api/vite.config.ts))
and surfaced as nx target **configurations**
(declared in [`nx.json`](../nx.json) `targetDefaults.test.configurations`).

| nx configuration          | vitest project(s)                                 | Hits the network? | Typical runtime |
| ------------------------- | ------------------------------------------------- | ----------------- | --------------- |
| `api:test:unit` (default) | `unit`                                            | No                | ~1s             |
| `api:test:integration`    | `integration`                                     | No                | ~5s             |
| `api:test:live`           | `live`                                            | Yes               | minutes         |
| `api:test:all`            | `unit` + `integration` + `live`                   | Yes (live cells)  | minutes         |
| `api:test:coverage`       | `unit` + `integration` + `live` with `--coverage` | Yes               | minutes         |

The bare `api:test` target with no suffix runs the **`unit`** configuration
(see `nx.targets.test.defaultConfiguration` in
[`packages/api/package.json`](../packages/api/package.json)). That's what
`nx affected -t test` exercises on PRs, so CI is offline by default.

## What each project covers

- **`unit`** — pure functions, adapters, detectors, single-service tests.
  Everything under `src/**/*.{test,spec}.ts` _except_ the integration and
  live globs below. No DI graph, no network.
- **`integration`** — multi-service mocked-DI orchestrator specs and
  resource-feature tests. Globs:
  [`src/__integration__/flow/`](../packages/api/src/__integration__/flow/)
  and
  [`src/__integration__/resource-features/`](../packages/api/src/__integration__/resource-features/).
  No network.
- **`live`** — real upstream-provider HTTP calls. Globs:
  [`src/__integration__/providers/`](../packages/api/src/__integration__/providers/),
  [`src/__integration__/live-flow/`](../packages/api/src/__integration__/live-flow/),
  `src/__integration__/audit-payload-capture*.spec.ts`, and
  `src/__integration__/responses/end-to-end.spec.ts`.
  Each spec uses `describe.skipIf(!hasKeys(...))` (see
  [`helpers/env.ts`](../packages/api/src/__integration__/helpers/env.ts))
  to self-skip when its provider's env var is missing — contributors with
  only one provider key still get useful coverage. Configured with
  `retry: 2` so transient network blips and known model-behaviour flakes
  (Gemini-2.5-flash empty thinking output, Anthropic JSON wrapped in
  markdown fences, missing OpenAI web-search citations) don't fail the run.

## Running

```bash
# Offline, cached, default for CI / PRs. Same as `api:test`.
pnpm exec nx run api:test:unit

# Offline mocked-DI feature specs.
pnpm exec nx run api:test:integration

# Live upstream calls — needs provider keys in `.env.local`.
pnpm exec nx run api:test:live

# All three projects in one vitest invocation (no coverage).
pnpm exec nx run api:test:all

# Combined coverage across all three projects. Report at
# packages/api/test-output/vitest/coverage/index.html.
pnpm exec nx run api:test:coverage
```

### Filtering inside a project

Vitest's `-t` (pattern on test name) and positional path filters apply
inside whichever project you pick:

```bash
# Run only OpenAI live cells:
pnpm exec nx run api:test:live -- src/__integration__/providers/openai.spec.ts

# Run only tests whose name matches a regex:
pnpm exec nx run api:test:live -- -t "tool call"
```

## Env vars for the `live` project

Place keys in `.env.local` at the workspace root or in
`packages/api/.env.local`. Nx loads both before invoking vitest; the
project-root file additionally carries DB/Redis/`BASE_URL` config that
the live HTTP harness's AppModule boot depends on (see
[`packages/api/test-setup.ts`](../packages/api/test-setup.ts)).

| Provider               | Required keys                                              |
| ---------------------- | ---------------------------------------------------------- |
| OpenAI                 | `OPENAI_API_KEY`                                           |
| Anthropic              | `ANTHROPIC_API_KEY`                                        |
| Groq                   | `GROQ_API_KEY`                                             |
| Gemini                 | `GEMINI_API_KEY`                                           |
| Perplexity             | `PERPLEXITY_API_KEY`                                       |
| AWS Bedrock (Converse) | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` |
| AWS Bedrock (Invoke)   | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` |

Setting only a subset is fine — every other provider's cells skip via
`describe.skipIf(!hasKeys(...))`.

### Optional model overrides

Each live spec uses a "cheap, deterministic" default; override per
provider when you need to validate a different model:

| Env var                        | Default                                       |
| ------------------------------ | --------------------------------------------- |
| `OPENAI_TEST_MODEL`            | `gpt-4o-mini`                                 |
| `OPENAI_SEARCH_TEST_MODEL`     | `gpt-4o-mini-search-preview`                  |
| `OPENAI_REASONING_TEST_MODEL`  | `o4-mini`                                     |
| `ANTHROPIC_TEST_MODEL`         | `claude-haiku-4-5`                            |
| `GROQ_TEST_MODEL`              | `llama-3.3-70b-versatile`                     |
| `GEMINI_TEST_MODEL`            | `gemini-2.5-flash-lite`                       |
| `PERPLEXITY_TEST_MODEL`        | `sonar`                                       |
| `PERPLEXITY_SEARCH_TEST_MODEL` | `sonar-pro`                                   |
| `BEDROCK_TEST_MODEL`           | `us.anthropic.claude-haiku-4-5-20251001-v1:0` |
| `BEDROCK_INVOKE_TEST_MODEL`    | `us.anthropic.claude-haiku-4-5-20251001-v1:0` |

## Where to put new tests

- Pure function or single-class spec → colocate next to the source as
  `*.spec.ts`. Auto-picked up by the `unit` project as long as it isn't
  under `src/__integration__/flow/`, `resource-features/`, `providers/`,
  `live-flow/`, or one of the live-only path patterns.
- Multi-service orchestrator / feature spec that wires mocked DI but
  doesn't touch the network →
  [`src/__integration__/flow/`](../packages/api/src/__integration__/flow/)
  or
  [`src/__integration__/resource-features/`](../packages/api/src/__integration__/resource-features/).
  Joins the `integration` project automatically.
- Real upstream call →
  [`src/__integration__/providers/`](../packages/api/src/__integration__/providers/)
  for direct provider-class tests, or
  [`src/__integration__/live-flow/`](../packages/api/src/__integration__/live-flow/)
  for AppModule-boot HTTP harness tests. Gate every `describe` with
  `describe.skipIf(!hasKeys('<PROVIDER>_API_KEY'))`.

See
[`packages/api/src/__integration__/README.md`](../packages/api/src/__integration__/README.md)
for the live coverage matrix and known gaps.
