# Contributing to VM-X AI

Thanks for your interest in contributing! This file is the index — the
detailed guides live under [`contributing-docs/`](./contributing-docs/).

## Project structure

VM-X AI is an Nx monorepo:

- **`packages/api`** — NestJS backend (REST + Responses API + provider plugins)
- **`packages/ui`** — Next.js dashboard
- **`packages/libs`** — shared TS packages
- **`docs`** — Docusaurus user-facing documentation site

## Guides

| Guide                                                                                   | When to read it                                                              |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [Development setup](./contributing-docs/dev-setup.md)                                   | First time running the stack locally — env files, docker, ports              |
| [Database & Kysely codegen](./contributing-docs/database.md)                            | Adding a migration, regenerating `entities.generated.ts`                     |
| [OpenAPI / UI SDK codegen](./contributing-docs/openapi-codegen.md)                      | Adding/changing an API endpoint, regenerating the UI client                  |
| [Nx commands cheat sheet](./contributing-docs/nx-commands.md)                           | Looking up the right `nx run ...` invocation                                 |
| [Provider integration tests](./contributing-docs/integration-tests.md)                  | Running the live multi-provider test suite                                   |
| [AI provider architecture & adding a new provider](./contributing-docs/ai-providers.md) | Format passthrough, audit invariants, step-by-step recipe for a new provider |

## Quick reference

```bash
# Bring up backing services
docker compose up -d postgres redis redis2 redis3 redis-cluster-init

# Apply migrations + regenerate Kysely types
pnpm nx run api:migrate
pnpm nx run api:codegen

# Start the API and UI
pnpm nx run api:serve   # http://localhost:3030/api
pnpm nx run ui:dev      # http://localhost:3001

# After API DTO/endpoint changes — regenerate the UI SDK
pnpm nx run ui:gen-client
```

## Code style

- TypeScript everywhere
- Existing code style is the source of truth — follow neighboring files
- Run `pnpm nx run <project>:lint` before opening a PR

## Submitting changes

1. Branch from `main` (`git checkout -b feature/your-change`)
2. Make changes following the guides above
3. Run lint, typecheck and tests
4. Open a PR with a clear description; reference any related issues

## Questions

- [Documentation](https://vm-x-ai.github.io/)
- [GitHub Issues](https://github.com/vm-x-ai/vm-x-ai/issues)

Thanks for contributing! 🚀
