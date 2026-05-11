import { Kysely, Migration, sql } from 'kysely';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DB, PublicModelPricingSource } from '../storage/entities.generated';

type FallbackModel = {
  provider: string;
  model: string;
  inputCostPerToken: number;
  outputCostPerToken: number;
  cachedInputCostPerToken?: number;
  reasoningCostPerToken?: number;
};

type FallbackSnapshot = { version: string; models: FallbackModel[] };

export const migration: Migration = {
  async up(db: Kysely<DB>): Promise<void> {
    // 'SYSTEM' rows are managed by PricingSyncService (overwritten on
    // every sync). 'USER' rows are operator overrides via the Pricing
    // UI and are never touched by the sync.
    await sql`CREATE TYPE MODEL_PRICING_SOURCE AS ENUM ('SYSTEM', 'USER')`.execute(
      db
    );

    await db.schema
      .createTable('model_pricing')
      .addColumn('pricing_id', 'uuid', (col) =>
        col.primaryKey().defaultTo(sql`gen_random_uuid()`)
      )
      .addColumn('provider', 'varchar(255)', (col) => col.notNull())
      .addColumn('model', 'varchar(255)', (col) => col.notNull())
      .addColumn('input_cost_per_token', 'double precision', (col) =>
        col.notNull()
      )
      .addColumn('output_cost_per_token', 'double precision', (col) =>
        col.notNull()
      )
      .addColumn('cached_input_cost_per_token', 'double precision', (col) =>
        col.defaultTo(0)
      )
      .addColumn('reasoning_cost_per_token', 'double precision', (col) =>
        col.defaultTo(0)
      )
      .addColumn('source', sql`MODEL_PRICING_SOURCE`, (col) =>
        col.notNull().defaultTo('SYSTEM')
      )
      .addColumn('created_at', 'timestamptz', (col) =>
        col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull()
      )
      .addColumn('updated_at', 'timestamptz', (col) =>
        col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull()
      )
      .addColumn('created_by', 'varchar(255)', (col) => col.notNull())
      .addColumn('updated_by', 'varchar(255)', (col) => col.notNull())
      .addUniqueConstraint('model_pricing_provider_model_unique', [
        'provider',
        'model',
      ])
      .execute();

    await db.schema
      .createIndex('idx_model_pricing_provider')
      .on('model_pricing')
      .column('provider')
      .execute();

    // Seed SYSTEM rows from the bundled fallback snapshot so a fresh
    // install (or any `migrate:reset` + `migrate` cycle) leaves the
    // table populated immediately. `PricingSyncService` will overwrite
    // these on its next remote sync — the seed exists so the cost-calc
    // path works the moment the api boots, before any cron tick.
    const fallbackPath = join(__dirname, '..', 'data', 'pricing-fallback.json');
    const fallback = JSON.parse(
      readFileSync(fallbackPath, 'utf8')
    ) as FallbackSnapshot;
    const rows = fallback.models.map((m) => ({
      provider: m.provider,
      model: m.model,
      inputCostPerToken: m.inputCostPerToken,
      outputCostPerToken: m.outputCostPerToken,
      cachedInputCostPerToken: m.cachedInputCostPerToken ?? 0,
      reasoningCostPerToken: m.reasoningCostPerToken ?? 0,
      source: PublicModelPricingSource.SYSTEM,
      createdBy: 'pricing-seed',
      updatedBy: 'pricing-seed',
    }));
    if (rows.length > 0) {
      await db
        .insertInto('modelPricing')
        .values(rows)
        .onConflict((oc) => oc.columns(['provider', 'model']).doNothing())
        .execute();
    }
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropIndex('idx_model_pricing_provider').execute();
    await db.schema.dropTable('model_pricing').execute();
    await sql`DROP TYPE IF EXISTS MODEL_PRICING_SOURCE`.execute(db);
  },
};
