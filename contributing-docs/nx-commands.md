# Nx Commands Cheat Sheet

VM-X is an Nx monorepo. Project tasks (`build`, `serve`, `test`, etc.) are
run with `pnpm nx run <project>:<target>`.

> Always prefer `nx run` over invoking the underlying tool (e.g. `nest`,
> `next`, `tsc`) directly — Nx wires up the right configs, env files, and
> caching. See `CLAUDE.md` at the repo root.

## API targets (`packages/api`)

| Target                  | Command                                          | Notes                                                                                                      |
| ----------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `serve`                 | `pnpm nx run api:serve`                          | `nest start --watch` — picks up `.env.local`                                                               |
| `build`                 | `pnpm nx run api:build`                          | TSC + SWC build into `dist/`                                                                               |
| `test`                  | `pnpm nx run api:test`                           | Runs Vitest suites (offline tests + opt-in live tests, see [integration-tests.md](./integration-tests.md)) |
| `migrate`               | `pnpm nx run api:migrate`                        | Runs Kysely migrations against the configured DB                                                           |
| `migrate -- --reset`    | `pnpm nx run api:migrate -- --reset`             | Roll all migrations back (local/test only)                                                                 |
| `migrate -- --target=N` | `pnpm nx run api:migrate -- --reset --target=10` | Roll back to a specific migration                                                                          |
| `codegen`               | `pnpm nx run api:codegen`                        | Regenerates `entities.generated.ts` via kysely-codegen                                                     |
| `lint`                  | `pnpm nx run api:lint`                           | ESLint                                                                                                     |

## UI targets (`packages/ui`)

| Target       | Command                     | Notes                                                                                             |
| ------------ | --------------------------- | ------------------------------------------------------------------------------------------------- |
| `dev`        | `pnpm nx run ui:dev`        | `next dev` on :3001                                                                               |
| `build`      | `pnpm nx run ui:build`      | Next.js production build                                                                          |
| `start`      | `pnpm nx run ui:start`      | Serve a production build                                                                          |
| `lint`       | `pnpm nx run ui:lint`       | ESLint                                                                                            |
| `gen-client` | `pnpm nx run ui:gen-client` | Regenerate the typed API SDK from the running API. See [openapi-codegen.md](./openapi-codegen.md) |

## Workspace-wide

| Command                     | What it does                                               |
| --------------------------- | ---------------------------------------------------------- |
| `pnpm nx affected -t build` | Build only projects affected by your branch                |
| `pnpm nx affected -t test`  | Test only affected projects                                |
| `pnpm nx run-many -t build` | Build everything                                           |
| `pnpm nx graph`             | Open the project dependency graph in your browser          |
| `pnpm nx reset`             | Clear the Nx cache (use sparingly — recompiles everything) |

## Recipes

### After modifying a DB schema

```bash
# 1. Apply the new migration
pnpm nx run api:migrate
# 2. Refresh Kysely types
pnpm nx run api:codegen
# 3. Make sure typecheck passes
pnpm nx run api:build
```

### After modifying an API endpoint or DTO

```bash
# 1. Restart the API so it serves the latest OpenAPI doc
#    (or just leave api:serve running with --watch — it auto-reloads)
# 2. Refresh the UI SDK
pnpm nx run ui:gen-client
# 3. Run UI typecheck/build
pnpm nx run ui:build
```

### Running the live provider integration suite

```bash
# Opt in via env flag; needs provider keys in .env.local
RUN_LIVE_PROVIDER_TESTS=1 pnpm nx run api:test

# Single provider:
RUN_LIVE_PROVIDER_TESTS=1 pnpm nx run api:test -- src/__integration__/providers/openai.spec.ts
```

See [integration-tests.md](./integration-tests.md) for the full env-var
table.

## Nx Cloud

The repo is configured to use [Nx Cloud](https://nx.app) for task caching
and distribution. Cache hits show up as "Nx read the output from the cache"
in CLI output. To bypass the cache for a single run:

```bash
pnpm nx run api:build --skip-nx-cache
```
