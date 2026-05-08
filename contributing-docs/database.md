# Database & Kysely Codegen

How database schema changes flow through the codebase.

## TL;DR workflow

```bash
# 1. Write a new migration in packages/api/src/migrations/
# 2. Register it in packages/api/src/migrations/migrations.service.ts
# 3. Apply it
pnpm nx run api:migrate
# 4. Regenerate the typed schema from the live DB
pnpm nx run api:codegen
```

## Adding a migration

Create a new file in `packages/api/src/migrations/` named with a sequential
number, e.g. `18-add-feature-flags-table.ts`:

```typescript
import { Kysely, Migration } from 'kysely';
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

### Schema-aware index creation

The `Migrator` runs against `db.withSchema('vmxai')`. **Use the Kysely DSL
(`db.schema.createIndex(...)`) — not raw `sql\`CREATE INDEX...\`** — because
raw SQL doesn't pick up the schema from `withSchema()`. For index types not
exposed by the DSL (e.g. GIN), use:

```typescript
await db.schema.createIndex('idx_my_table_metadata').on('my_table').using('GIN').column('metadata').execute();
```

### Register the migration

In `packages/api/src/migrations/migrations.service.ts`:

```typescript
import { migration as migration18 } from './18-add-feature-flags-table';
// ...
provider: new ListMigrationProvider({
  // ...
  '17': migration17,
  '18': migration18,
});
```

The keys are sortable strings; pad with leading zeros only if you have ≥100
migrations.

## Running migrations

```bash
pnpm nx run api:migrate
```

The API also runs migrations automatically on startup (see
`packages/api/src/migrations/migrations.module.ts`). Running them once
manually before bringing the API up is faster when iterating.

## Resetting (local-only)

```bash
pnpm nx run api:migrate -- --reset
pnpm nx run api:migrate -- --reset --target=10  # roll back to migration 10
```

The reset paths are gated to localhost + NODE_ENV=local|test.

## Kysely codegen

`packages/api/src/storage/entities.generated.ts` is **generated** — never
hand-edit it.

```bash
pnpm nx run api:codegen
```

Configuration lives in `packages/api/.kysely-codegenrc.ts`. To override
inferred column types (e.g. JSONB columns where Kysely's default is too
loose), add an entry under `overrides.columns`:

```typescript
overrides: {
  columns: {
    'completion_audit.metadata':
      'ColumnType<any | null, string | null, string | null>',
  },
},
```

The codegen requires the database to be running and migrations to be applied.

## When to regenerate

After **any** migration that touches a column type, table, or constraint —
otherwise TypeScript will lag behind the schema and you'll get runtime
mismatches. Commit `entities.generated.ts` alongside the migration that
caused the change.
