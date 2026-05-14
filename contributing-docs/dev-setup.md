# Development Setup

How to get a local VM-X AI stack running on your machine.

## Prerequisites

- Node.js 24 (the workspace pins `24` in [`.nvmrc`](../.nvmrc); pnpm 11 requires Node 22.13+, so anything older will fail)
- pnpm 11 (pinned via `packageManager` in the root [`package.json`](../package.json) — `corepack enable` will install the exact version)
- Docker + Docker Compose
- AWS credentials in your shell if you plan to exercise the Bedrock providers locally

### Recommended Node setup

```bash
nvm install        # picks up .nvmrc -> Node 24
nvm use
corepack enable    # activates the pinned pnpm 11 from package.json
```

## 1. Install dependencies

```bash
pnpm install
```

## 2. Start backing services

The compose file at the workspace root defines Postgres, a 3-node Redis cluster,
and the observability stack (OTel collector + Jaeger + Prometheus + Loki +
Grafana). The `api` and `ui` services are gated behind the `e2e` profile, so
they are not started by the default `docker compose up`.

```bash
# Minimum subset for API + UI dev work (DB + Redis cluster only):
docker compose up -d postgres redis redis2 redis3 redis-cluster-init

# Add observability (Jaeger, Prometheus, Loki, Grafana):
docker compose up -d postgres redis redis2 redis3 redis-cluster-init \
  otel-collector jaeger prometheus loki grafana

# Full e2e stack (builds + starts api and ui containers too):
docker compose --profile e2e up -d

# Tear down (add -v to also drop the Postgres volume):
docker compose down
```

Ports:

- PostgreSQL on `localhost:5440` (remapped from the container's `5432` to avoid clashing with a local Postgres)
- Redis cluster on `localhost:7001` / `7002` / `7003` (network_mode: host)
- Jaeger UI on `localhost:16686`, Grafana on `localhost:3010`

> The Redis `redis-cluster-init` container forms the cluster on first boot;
> wait a few seconds after `docker compose up` before starting the API.

## 3. Configure env files

Nx auto-loads `.env` and `.env.local` from both the workspace root and each
project root — no manual `dotenv` step is needed.

### `packages/api/.env.local`

```env
LOCAL=true
PORT=3030
BASE_URL=http://localhost:3030
BASE_PATH=/api

# PG
DATABASE_HOST=localhost
DATABASE_RO_HOST=localhost
DATABASE_PORT=5440
DATABASE_USER=admin
DATABASE_PASSWORD=password
DATABASE_DB_NAME=vmxai

# Redis (cluster mode matches docker-compose)
REDIS_HOST=localhost
REDIS_PORT=7001
REDIS_MODE=cluster

# Vault
ENCRYPTION_PROVIDER=libsodium
LIBSODIUM_ENCRYPTION_KEY=mPpddUYSuhIkuLq6MqeARZSEBZiwWm0HwEGQD5YSMFc=

# UI
UI_BASE_URL=http://localhost:3001
```

> The API defaults to `PORT=3000` inside containers; locally we use `3030` to
> stay clear of common port conflicts. If you change it, update the UI env
> file to match.

### `packages/ui/.env.local`

```env
AUTH_SECRET="iK0aiF1Hc57/P4Jym7Dz51sjlleE6onQXcAFBG7uvss="
AUTH_OIDC_ISSUER=http://localhost:3030/api/oauth2
AUTH_OIDC_CLIENT_ID=ui
AUTH_OIDC_CLIENT_SECRET=ui

API_BASE_URL=http://localhost:3030
```

`packages/ui/.env` already sets `PORT=3001` for the Next.js dev server.

### Workspace-root `.env.local` (provider keys for live tests)

The `live` vitest project (see [Tests](#tests) below) reads provider API keys
from the workspace-root `.env.local`. Each provider spec uses
`describe.skipIf(!hasKeys(...))`, so missing keys skip gracefully:

```env
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
GROQ_API_KEY=...
PERPLEXITY_API_KEY=...

# Bedrock (Converse + Invoke)
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
```

See [integration-tests.md](./integration-tests.md) for the full matrix and
optional model-override env vars.

## 4. Run migrations

```bash
pnpm exec nx run api:migrate
```

The model-pricing seed lives inside migration `17-create-model-pricing-table.ts`
and is idempotent, so there is no separate seed step. After migrations finish,
regenerate the Kysely types from the live schema:

```bash
pnpm exec nx run api:codegen
```

See [database.md](./database.md) for more on migrations and codegen.

## 5. Start the dev servers

In two terminals:

```bash
pnpm exec nx run api:serve   # API on :3030 (BASE_URL=http://localhost:3030, BASE_PATH=/api)
pnpm exec nx run ui:dev      # UI on :3001
```

Or in parallel via Nx:

```bash
pnpm exec nx run-many -t serve dev --projects=api,ui --parallel
```

Open <http://localhost:3001> for the dashboard, <http://localhost:3030/api/docs>
for the Scalar API reference.

## Cold-start sequence

After `docker compose down -v` (which resets the Postgres volume) you must
re-run migrations before serving:

```bash
docker compose up -d postgres redis redis2 redis3 redis-cluster-init
pnpm exec nx run api:migrate
pnpm exec nx run api:serve &
pnpm exec nx run ui:dev &
```

## Tests

The API suite is split into three vitest projects — see
[`packages/api/vite.config.ts`](../packages/api/vite.config.ts) for the project
definitions and `nx.json` `targetDefaults.test.configurations` for the matching
Nx target configurations.

```bash
# Pure-function / single-service unit tests. No network, no DB. ~1s.
# `nx run api:test` (no suffix) also runs this — it's the default configuration.
pnpm exec nx run api:test:unit

# Multi-service mocked-DI orchestrator + resource-feature specs. No network.
pnpm exec nx run api:test:integration

# Live tests against real upstream APIs. Needs keys in workspace-root .env.local.
pnpm exec nx run api:test:live

# All three projects in a single vitest invocation:
pnpm exec nx run api:test:all

# Combined coverage across all three projects:
pnpm exec nx run api:test:coverage
```

The bare `nx run api:test` target only runs `unit`, so `nx affected -t test`
on PRs stays offline. Live tests use vitest's native `retry: 2` to absorb
transient upstream blips.

## Useful URLs

| URL                                    | What it is                             |
| -------------------------------------- | -------------------------------------- |
| `http://localhost:3001`                | Next.js UI                             |
| `http://localhost:3030/api/docs`       | Scalar API reference (interactive)     |
| `http://localhost:3030/api/docs-json`  | OpenAPI spec (used by `ui:gen-client`) |
| `http://localhost:3030/api/oauth2/...` | OIDC provider endpoints                |
| `http://localhost:16686`               | Jaeger UI (tracing)                    |
| `http://localhost:3010`                | Grafana                                |
| `localhost:5440`                       | Postgres (admin / password)            |
| `localhost:7001` / `7002` / `7003`     | Redis cluster nodes                    |
