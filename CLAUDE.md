<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- You have access to the Nx MCP server and its tools, use them to help the user
- When answering questions about the repository, use the `nx_workspace` tool first to gain an understanding of the workspace architecture where applicable.
- When working in individual projects, use the `nx_project_details` mcp tool to analyze and understand the specific project structure and dependencies
- For questions around nx configuration, best practices or if you're unsure, use the `nx_docs` tool to get relevant, up-to-date docs. Always use this instead of assuming things about nx configuration
- If the user needs help with an Nx configuration or project graph error, use the `nx_workspace` tool to get any errors

<!-- nx configuration end-->

---

# Project commands

Quick reference for the two main packages — `api` (NestJS gateway) and `ui` (Next.js frontend). Run all commands via `pnpm exec nx` from the workspace root. The Nx CLI auto-loads `.env` and `.env.local` from both the workspace root and the project root, so test/dev secrets just need to be in either file — no manual `dotenv` step.

## Infrastructure (Docker Compose)

The compose file at the workspace root defines Postgres, a 3-node Redis cluster, OTel collector + Jaeger + Prometheus + Loki + Grafana. The `api` and `ui` services are gated behind the `e2e` profile so they only start when explicitly requested.

```bash
# Bring up infra only (Postgres + Redis cluster + observability stack):
docker compose up -d postgres redis redis2 redis3 redis-cluster-init otel-collector jaeger prometheus loki grafana

# Quick subset for unit/dev work — DB + Redis only:
docker compose up -d postgres redis redis2 redis3 redis-cluster-init

# Full e2e stack (also builds + starts api and ui containers):
docker compose --profile e2e up -d

# Tear down:
docker compose down
docker compose down -v   # also wipes volumes (Postgres data resets)
```

Ports: Postgres `5440`, Redis `7001`/`7002`/`7003`, api `3000`, ui `3001`, Jaeger UI `16686`, Grafana `3010`.

## Database migrations + cost seed

Migrations live in `packages/api/src/migrations/` and run via `pnpm exec nx run api:migrate`. The model-pricing seed (per-token costs for every supported model) is part of migration `17-create-model-pricing-table.ts` — it inserts on first run and is idempotent on subsequent runs, so there is no separate "seed" command.

```bash
# Run pending migrations (includes cost/pricing seed on fresh DBs):
pnpm exec nx run api:migrate

# Reset all migrations (drops + reruns everything):
pnpm exec nx run api:migrate:reset

# Reset to a specific migration (e.g. roll back past 03):
pnpm exec nx run api:migrate -- --reset --target=03
```

Make sure Postgres is up first (`docker compose up -d postgres`).

## Running api + ui in dev

```bash
# api — NestJS in watch mode (port 3000):
pnpm exec nx run api:serve

# ui — Next.js dev server (port 3001):
pnpm exec nx run ui:dev

# Both in parallel via Nx (terminal-multiplexed output):
pnpm exec nx run-many -t serve dev --projects=api,ui --parallel
```

The api needs Postgres + Redis cluster up and migrations applied. The ui depends on the api being up at `http://localhost:3000`.

## Tests

The api test suite is split into three vitest projects (`unit`, `integration`, `live`) plus combined `all` and `coverage` configurations. See `packages/api/vite.config.ts` for the project definitions and `nx.json` `targetDefaults.test.configurations` for the matching Nx target configs. The bare `api:test` target defaults to the `unit` configuration (`packages/api/package.json` `nx.targets.test.defaultConfiguration`), so `nx affected -t test` on PRs only runs unit tests — integration/live/coverage need an explicit configuration suffix.

```bash
# Pure-function / single-service unit tests — no network, no DB. Cached. ~1s.
# `nx run api:test` (no suffix) also runs this, since it's the default configuration.
pnpm exec nx run api:test:unit

# Multi-service mocked-DI orchestrator + resource-feature specs. No network. ~5s.
pnpm exec nx run api:test:integration

# Live tests against real upstream APIs. Per-spec `describe.skipIf(!hasKeys(...))`
# means cells without the matching `*_API_KEY` env var skip gracefully.
# Requires keys in `.env.local` at workspace or project root.
pnpm exec nx run api:test:live

# All three projects in a single vitest invocation (no coverage).
pnpm exec nx run api:test:all

# Combined coverage across all three projects (single vitest invocation so v8
# coverage merges into one report). Open `packages/api/test-output/vitest/coverage/index.html`.
pnpm exec nx run api:test:coverage
```

Live tests use vitest's native `retry: 2` for transient network blips. The required env vars are `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `PERPLEXITY_API_KEY`, plus `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_REGION` for the two Bedrock cells.

## E2E tests (Playwright)

The ui's Playwright suite hits a running api + ui pair. Bring infra up, run migrations, then start both servers before running e2e.

```bash
# Run all e2e specs (assumes api and ui are already running):
pnpm exec nx run ui:e2e

# Run a specific spec:
pnpm exec nx run ui:e2e --grep "playground"

# CI mode (parallel sharded runs) — see `e2e-ci-*` targets on the ui project.
pnpm exec nx run ui:e2e-ci
```

Cold-start sequence:

```bash
docker compose up -d postgres redis redis2 redis3 redis-cluster-init
pnpm exec nx run api:migrate
pnpm exec nx run api:serve &
pnpm exec nx run ui:dev &
# wait for both to come up, then:
pnpm exec nx run ui:e2e
```

## Codegen

Two generators kept in sync with the running api: a Kysely DB schema generator (api side) and an `@hey-api/openapi-ts` REST client generator (ui side). Re-run after schema changes (DB migration, OpenAPI shape change).

```bash
# Kysely DB types — reads the live Postgres schema and emits TS types
# into `packages/api/src/storage/entities.generated.ts`. Requires Postgres
# up + migrations applied.
pnpm exec nx run api:codegen

# UI REST client — reads the api's OpenAPI document and regenerates the
# typed client used by the frontend. Requires `nx run api:serve` running
# (or any environment serving the OpenAPI spec at the configured URL —
# see `packages/ui/openapi-ts.api.config.ts`).
pnpm exec nx run ui:gen-client
```

## Lint + typecheck

```bash
pnpm exec nx run api:lint
pnpm exec nx run api:typecheck
pnpm exec nx run ui:lint

# Lint everything in the workspace:
pnpm exec nx run-many -t lint
```

## Common pitfalls

- **Postgres port is `5440`, not `5432`** — the compose file remaps it to avoid clashing with a local Postgres.
- **Redis runs as a 3-node cluster** (`redis`/`redis2`/`redis3` + `redis-cluster-init`) on `7001`/`7002`/`7003` with `network_mode: host`. The init container creates the cluster on first boot — wait a few seconds after `docker compose up` before starting the api.
- **`api:serve` does not auto-run migrations.** Run `nx run api:migrate` after `docker compose down -v` (which resets the DB volume).
- **Live tests need keys in `.env.local`**, not `.env` — the local file is gitignored. Setting an env var in your shell also works (Nx exposes the parent shell's env to the test command).
