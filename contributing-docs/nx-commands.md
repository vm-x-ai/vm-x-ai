# Nx Commands Cheat Sheet

VM-X is an Nx monorepo. Project tasks (`build`, `serve`, `test`, etc.) are
run with `pnpm exec nx run <project>:<target>`.

> Always prefer `nx run` over invoking the underlying tool (e.g. `nest`,
> `next`, `tsc`, `vitest`, `playwright`) directly — Nx wires up the right
> configs, env files, and caching. Nx auto-loads `.env` / `.env.local`
> from both the workspace root and the project root.
>
> The canonical command reference lives at the repo root in
> [`CLAUDE.md`](../CLAUDE.md). This page is a quick lookup; if anything
> here drifts, CLAUDE.md wins.

## Infra (Docker Compose)

The workspace `docker-compose.yml` defines Postgres, a 3-node Redis cluster,
and the OTel/Jaeger/Prometheus/Loki/Grafana observability stack. `api` and
`ui` services are gated behind the `e2e` compose profile.

```bash
# Dev infra — DB + Redis cluster only:
docker compose up -d postgres redis redis2 redis3 redis-cluster-init

# Dev infra + observability stack:
docker compose up -d postgres redis redis2 redis3 redis-cluster-init \
  otel-collector jaeger prometheus loki grafana

# Full e2e stack (builds and starts api + ui containers too):
docker compose --profile e2e up -d

# Tear down (add -v to also wipe the Postgres volume):
docker compose down
```

Ports: Postgres `5440` (remapped to avoid clashing with a local 5432),
Redis `7001`/`7002`/`7003`, api `3030` locally, ui `3001`, Jaeger UI
`16686`, Grafana `3010`, docs `3002`.

## API targets (`packages/api`)

| Target             | Command                                               | Notes                                                                       |
| ------------------ | ----------------------------------------------------- | --------------------------------------------------------------------------- |
| `serve`            | `pnpm exec nx run api:serve`                          | `nest start --watch`; port `3030` locally, `3000` in-container              |
| `build`            | `pnpm exec nx run api:build`                          | `nest build` into `dist/`                                                   |
| `typecheck`        | `pnpm exec nx run api:typecheck`                      | Inferred by `@nx/js/typescript` Nx plugin                                   |
| `lint`             | `pnpm exec nx run api:lint`                           | ESLint                                                                      |
| `test`             | `pnpm exec nx run api:test`                           | Defaults to the `unit` configuration (see below)                            |
| `test:unit`        | `pnpm exec nx run api:test:unit`                      | Pure-function / single-service specs; no network, no DB                     |
| `test:integration` | `pnpm exec nx run api:test:integration`               | Mocked-DI orchestrator + resource-feature specs; no network                 |
| `test:live`        | `pnpm exec nx run api:test:live`                      | Hits real upstream provider APIs; cells skip when their `*_API_KEY` missing |
| `test:all`         | `pnpm exec nx run api:test:all`                       | Runs unit + integration + live in one vitest invocation                     |
| `test:coverage`    | `pnpm exec nx run api:test:coverage`                  | All three projects with merged v8 coverage report                           |
| `migrate`          | `pnpm exec nx run api:migrate`                        | Runs Kysely migrations; includes the model-pricing seed                     |
| `migrate:reset`    | `pnpm exec nx run api:migrate:reset`                  | Roll all migrations back                                                    |
| `migrate --target` | `pnpm exec nx run api:migrate -- --reset --target=10` | Roll back to a specific migration                                           |
| `codegen`          | `pnpm exec nx run api:codegen`                        | Regenerates `src/storage/entities.generated.ts` via `kysely-codegen`        |
| `docker:build`     | `pnpm exec nx run api:docker:build`                   | Builds the api container image                                              |

Live tests use vitest's native `retry: 2`. Required env vars (in
`.env.local`): `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`,
`GROQ_API_KEY`, `PERPLEXITY_API_KEY`, plus `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY` / `AWS_REGION` for Bedrock. See
[`integration-tests.md`](./integration-tests.md).

## UI targets (`packages/ui`)

| Target       | Command                          | Notes                                                                                                                    |
| ------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `dev`        | `pnpm exec nx run ui:dev`        | `next dev` on `:3001`                                                                                                    |
| `build`      | `pnpm exec nx run ui:build`      | `next build` (cache disabled per `package.json`)                                                                         |
| `start`      | `pnpm exec nx run ui:start`      | Serve a production build                                                                                                 |
| `lint`       | `pnpm exec nx run ui:lint`       | ESLint                                                                                                                   |
| `e2e`        | `pnpm exec nx run ui:e2e`        | Playwright; assumes a running api + ui (see cold-start in [`CLAUDE.md`](../CLAUDE.md))                                   |
| `e2e-ci`     | `pnpm exec nx run ui:e2e-ci`     | Sharded parallel runs used in CI                                                                                         |
| `gen-client` | `pnpm exec nx run ui:gen-client` | Regenerates the typed REST SDK from the running api's OpenAPI document. See [`openapi-codegen.md`](./openapi-codegen.md) |

## Docs (`docs/`)

The docs site is a Docusaurus app. Nx infers a `typecheck` target via
`@nx/js/typescript`; the runnable scripts come from `docs/package.json`.

```bash
pnpm exec nx run docs:start       # docusaurus start --port 3002
pnpm exec nx run docs:build       # docusaurus build
pnpm exec nx run docs:serve       # serve a production build
pnpm exec nx run docs:typecheck   # tsc --noEmit
```

## Examples (`examples/*`)

Five runnable example projects share a common shape: TypeScript examples
expose `setup` + a per-snippet target; Python examples use the
[`@nxlv/python`](https://github.com/lucasvieirasilva/nx-plugins) executor
suite (`lock`, `sync`, `install`, `add`, `update`, `remove`, `build`,
`lint`, `format`, `setup`) plus per-snippet targets.

| Project                                                                | Language | Per-snippet targets                                                                                               |
| ---------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `api-completion-example` (`examples/api-completion`)                   | Python   | `chat-completions`, `responses`, `anthropic-messages`, `vmx-envelope`, `web-search`                               |
| `langchain-example` (`examples/langchain`)                             | Python   | `run`                                                                                                             |
| `claude-agent-sdk-python-example` (`examples/claude-agent-sdk-python`) | Python   | `quickstart`, `tools`, `vmx-envelope`                                                                             |
| `claude-agent-sdk-ts-example` (`examples/claude-agent-sdk-ts`)         | TS       | `quickstart`, `tools`, `vmx-envelope` (plus `typecheck`)                                                          |
| `vercel-ai-example` (`examples/vercel-ai`)                             | TS       | `openai-chat`, `openai-responses`, `anthropic`, `streaming`, `tools`, `object`, `vmx-envelope` (plus `typecheck`) |

```bash
# Bootstrap an example before its first run:
pnpm exec nx run vercel-ai-example:setup
pnpm exec nx run vercel-ai-example:openai-chat

pnpm exec nx run api-completion-example:setup
pnpm exec nx run api-completion-example:chat-completions
```

## Workspace-wide

| Command                                                           | What it does                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------- |
| `pnpm exec nx affected -t build`                                  | Build only projects affected by your branch             |
| `pnpm exec nx affected -t test`                                   | Test affected projects (runs the `unit` config for api) |
| `pnpm exec nx affected -t lint typecheck`                         | Lint + typecheck across affected projects               |
| `pnpm exec nx run-many -t lint`                                   | Lint everything                                         |
| `pnpm exec nx run-many -t serve dev --projects=api,ui --parallel` | Run api + ui together                                   |
| `pnpm exec nx graph`                                              | Open the project dependency graph in your browser       |
| `pnpm exec nx reset`                                              | Clear the Nx cache (use sparingly)                      |

### Affected workflow

CI uses `nx affected -t ...` based on the merge-base with `main`. Locally
you can preview the same set with:

```bash
pnpm exec nx show projects --affected
pnpm exec nx affected -t lint typecheck test build --parallel
```

Because `api:test` defaults to the `unit` configuration, `nx affected -t test`
on a PR only runs unit tests — request the `integration` / `live` /
`coverage` configurations explicitly when you need them.

## Caching notes

- Most targets are cached by Nx. Cache hits show as
  `Nx read the output from the cache` in CLI output.
- `ui:build` is intentionally **not** cached (`"cache": false` in
  `packages/ui/package.json`) because Next.js output depends on env vars
  the cache key doesn't see.
- Bypass the cache for a single run with `--skip-nx-cache`:
  ```bash
  pnpm exec nx run api:build --skip-nx-cache
  ```
- The `test` target `dependsOn: ["^build"]` (see `nx.json`), so test runs
  rebuild any changed library dependencies first.

## Recipes

### After modifying a DB schema

```bash
pnpm exec nx run api:migrate     # apply migrations (incl. pricing seed)
pnpm exec nx run api:codegen     # refresh Kysely types
pnpm exec nx run api:typecheck   # sanity check
```

### After modifying an API endpoint or DTO

```bash
# api:serve --watch picks up the change automatically; otherwise restart it.
pnpm exec nx run ui:gen-client   # refresh the typed SDK
pnpm exec nx run ui:build        # ensure the UI still typechecks
```

### Running a single live provider spec

```bash
# Keys must be in .env.local (gitignored). Cells without the matching key
# skip via `describe.skipIf(...)`.
pnpm exec nx run api:test:live -- src/__integration__/providers/openai.spec.ts
```

## Nx Cloud

The repo is configured to use [Nx Cloud](https://nx.app) for remote
caching and task distribution. See [`CLAUDE.md`](../CLAUDE.md) for the
full set of canonical commands and any pitfalls (Postgres port `5440`,
Redis cluster bootstrap, etc.).
