# Database & Kysely Codegen

How database schema changes flow through the codebase.

## Schema overview

The gateway is **Postgres-only**. Earlier revisions experimented with a split
between an OLTP store (Postgres) and a time-series store (QuestDB / AWS
Timestream) for high-cardinality request audit data, but that bifurcation was
removed in the multi-surface gateway rewrite. Every persisted concern —
workspaces, environments, AI connections, resources, API keys, batch jobs,
RBAC, secrets, request audit, model pricing — lives in a single Postgres
instance under the `vmxai` schema.

Locally, Postgres runs in Docker on port **5440** (mapped from the container's 5432) — see [`docker-compose.yml`](../docker-compose.yml). The schema name is
read from `DATABASE_SCHEMA` and applied through `db.withSchema(...)` on both
the migrator and runtime Kysely instances (see
[`packages/api/src/migrations/base.ts`](../packages/api/src/migrations/base.ts)
and
[`packages/api/src/storage/database.service.ts`](../packages/api/src/storage/database.service.ts)).
`DatabaseService` exposes paired writer/reader Kysely clients (each with a
`raw*` sibling that skips the `CamelCasePlugin`) backed by `DATABASE_HOST`
and `DATABASE_RO_HOST`.

## TL;DR workflow

```bash
# 1. Write a new migration in packages/api/src/migrations/
# 2. Register it in packages/api/src/migrations/migrations.service.ts
# 3. Apply it
pnpm exec nx run api:migrate
# 4. Regenerate the typed schema from the live DB
pnpm exec nx run api:codegen
```

## Adding a migration

Create a new file in
[`packages/api/src/migrations/`](../packages/api/src/migrations/) with a
sequential number prefix, e.g. `20-add-feature-flags-table.ts`. The
file must export a `Migration` named `migration`:

```typescript
import { Kysely, Migration, sql } from 'kysely';
import { DB } from '../storage/entities.generated';

export const migration: Migration = {
  async up(db: Kysely<DB>): Promise<void> {
    await db.schema
      .createTable('feature_flags')
      .addColumn('flag_id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
      .addColumn('name', 'text', (col) => col.notNull().unique())
      .addColumn('enabled', 'boolean', (col) => col.notNull().defaultTo(false))
      .execute();

    await db.schema.createIndex('idx_feature_flags_name').on('feature_flags').column('name').execute();
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropIndex('idx_feature_flags_name').execute();
    await db.schema.dropTable('feature_flags').execute();
  },
};
```

Migrations whose `up` depends on a runtime service (e.g. the password hasher
for the initial users seed) can instead export a factory — see
[`1-create-users.ts`](../packages/api/src/migrations/1-create-users.ts) — and
register the invocation in the service.

Make migrations re-runnable from an empty DB: data seeds should use
`onConflict(...).doNothing()` (or equivalent) so a `migrate:reset` + `migrate`
cycle is safe.

### Schema-aware index creation

The `Migrator` runs against `db.withSchema('vmxai')`. **Use the Kysely DSL
(`db.schema.createIndex(...)`) — not raw `sql\`CREATE INDEX...\`** — because
raw SQL doesn't pick up the schema from `withSchema()`. For index types not
exposed by the DSL (e.g. GIN), use:

```typescript
await db.schema.createIndex('idx_my_table_metadata').on('my_table').using('GIN').column('metadata').execute();
```

### Register the migration

In
[`packages/api/src/migrations/migrations.service.ts`](../packages/api/src/migrations/migrations.service.ts):

```typescript
import { migration as migration20 } from './20-add-feature-flags-table';
// ...
provider: new ListMigrationProvider({
  // ...
  '18': migration18,
  '19': migration19,
  '20': migration20,
});
```

The keys are sortable strings; pad with leading zeros only if you have ≥100
migrations. The leading zeros on `'01'`–`'09'` exist because `migration01`
co-sorts with `'10'`+ as plain strings — keep that pattern.

## Running migrations

```bash
pnpm exec nx run api:migrate
```

The API also runs migrations automatically on startup via
`DatabaseService.onModuleInit` (see
[`packages/api/src/storage/database.service.ts`](../packages/api/src/storage/database.service.ts)).
Running them once manually before bringing the API up is faster when
iterating, and it's required after a `docker compose down -v` (which wipes
the Postgres volume).

## Resetting (local-only)

```bash
pnpm exec nx run api:migrate:reset                  # roll all the way back, then re-apply
pnpm exec nx run api:migrate -- --reset             # equivalent (explicit flag)
pnpm exec nx run api:migrate -- --reset --target=10 # roll back to migration 10
```

Both `--reset` and `--target` are parsed by
[`packages/api/src/migrate.ts`](../packages/api/src/migrate.ts) and forwarded
to `BaseMigrationsService.resetMigrations`. The reset path is gated to
`NODE_ENV=local|test` **and** a localhost-containing `DATABASE_HOST`, so it
will refuse to run against a remote DB even if you fat-finger the env.

## Seed data

Seed rows are inserted from inside the migration that owns the corresponding
table — there is no separate "seed" step. The largest seed is the per-token
model-pricing table:
[`17-create-model-pricing-table.ts`](../packages/api/src/migrations/17-create-model-pricing-table.ts)
creates the `model_pricing` table, then inserts every row from
`packages/api/src/data/pricing-fallback.json` with `source = 'SYSTEM'` and
`onConflict(['provider','model']).doNothing()`. The `PricingSyncService`
overwrites `SYSTEM` rows on its next remote sync; `USER` rows (operator
overrides from the Pricing UI) are never touched. The seed exists so the
cost-calc path is functional the instant the API boots, before any sync tick.

## Kysely codegen

[`packages/api/src/storage/entities.generated.ts`](../packages/api/src/storage/entities.generated.ts)
is **generated** — never hand-edit it. The generator (`kysely-codegen`) reads
the live `vmxai` schema and emits typed `DB`, per-table interfaces, and
runtime enums.

```bash
pnpm exec nx run api:codegen
```

Configuration:
[`packages/api/.kysely-codegenrc.ts`](../packages/api/.kysely-codegenrc.ts).
Key knobs:

- `defaultSchemas: ['vmxai']` + `includePattern: 'vmxai.*'` — only the
  gateway's tables are emitted.
- `camelCase: true` — matches the `CamelCasePlugin` used at runtime.
- `singularize: true` — `model_pricing` → `ModelPricing` interface.
- `runtimeEnums: true` — Postgres enums (e.g. `MODEL_PRICING_SOURCE`,
  `REQUEST_AUDIT_TYPE`) emit as real TS enums you can import and reference.
- `customImports` — pull in hand-authored types (e.g. `CapacityEntity`).
- `overrides.columns` — narrow `jsonb` / array columns where Kysely's
  inference is too loose:

```typescript
overrides: {
  columns: {
    'completion_audit.metadata':
      'ColumnType<any | null, string | null, string | null>',
  },
},
```

The codegen requires the database to be running and migrations to be applied
(it reads the live schema). Connection params come from
`DATABASE_USER` / `DATABASE_PASSWORD` / `DATABASE_HOST` / `DATABASE_PORT` /
`DATABASE_DB_NAME` — typically loaded from `.env.local`.

### Entity patterns

- All physical columns are `snake_case`; the runtime `CamelCasePlugin`
  (configured with `maintainNestedObjectKeys: true` in `DatabaseService`)
  converts to/from camelCase at query time, while leaving keys _inside_
  JSONB payloads untouched.
- Mind digit-adjacent casing: `cacheCreationEphemeral5mTokens` maps to
  `cache_creation_ephemeral5m_tokens` (no underscore between digit and
  letter). The physical column name must match the plugin's output exactly,
  or every insert silently fails with "column does not exist".
- Most rows carry `created_at` / `updated_at` (timestamptz, default
  `CURRENT_TIMESTAMP`) and `created_by` / `updated_by` (user id).
  `DatabaseService.includeEntityControlUsers(table)` and `withUser(...)` are
  helpers that join the `users` row inline as `createdByUser` / `updatedByUser`.

## When to regenerate

After **any** migration that touches a column type, table, constraint, or
enum value — otherwise TypeScript will lag behind the schema and you'll get
runtime mismatches. Commit `entities.generated.ts` alongside the migration
that caused the change.
