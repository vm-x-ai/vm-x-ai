# Development Setup

How to get a local VM-X AI stack running on your machine.

## Prerequisites

- Node.js 20+
- pnpm
- Docker + Docker Compose
- An AWS profile if you plan to exercise the Bedrock providers locally

## 1. Install dependencies

```bash
pnpm install
```

## 2. Start backing services

```bash
docker compose up -d postgres redis redis2 redis3 redis-cluster-init
```

This starts:

- PostgreSQL on `localhost:5440`
- Redis cluster on `localhost:7001-7003`

> The full `docker compose up` also starts OTEL, Jaeger, Prometheus, Loki and
> Grafana — useful for observability work but not required to run the API/UI.

## 3. Configure env files

### `packages/api/.env.local`

```env
LOCAL=true
PORT=3030                       # change if 3000 or 3030 is occupied
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

### `packages/ui/.env.local`

```env
AUTH_SECRET="iK0aiF1Hc57/P4Jym7Dz51sjlleE6onQXcAFBG7uvss="
AUTH_OIDC_ISSUER=http://localhost:3030/api/oauth2
AUTH_OIDC_CLIENT_ID=ui
AUTH_OIDC_CLIENT_SECRET=ui

API_BASE_URL=http://localhost:3030/api
```

> The OIDC issuer and `API_BASE_URL` must match the API's `BASE_URL` +
> `BASE_PATH`. If you change `PORT` on the API side, update both.

### Workspace-root `.env.local` (provider keys for integration tests)

See [integration-tests.md](./integration-tests.md). This is the file the
live test suite reads from.

## 4. Run migrations

```bash
pnpm nx run api:migrate
```

After this completes, regenerate the Kysely types:

```bash
pnpm nx run api:codegen
```

See [database.md](./database.md) for more on migrations and codegen.

## 5. Start the dev servers

In two terminals:

```bash
pnpm nx run api:serve   # API on :3030 (or whatever PORT you set)
pnpm nx run ui:dev      # UI on :3001
```

Open <http://localhost:3001> for the dashboard, <http://localhost:3030/api/docs>
for the Scalar API reference.

## Useful URLs

| URL                                    | What it is                             |
| -------------------------------------- | -------------------------------------- |
| `http://localhost:3001`                | Next.js UI                             |
| `http://localhost:3030/api/docs`       | Scalar API reference (interactive)     |
| `http://localhost:3030/api/docs-json`  | OpenAPI spec (used by `ui:gen-client`) |
| `http://localhost:3030/api/oauth2/...` | OIDC provider endpoints                |
| `http://localhost:5440`                | Postgres (admin / password)            |
