import { Kysely, Migration, sql } from 'kysely';
import { DB } from '../storage/entities.generated';

export const migration: Migration = {
  async up(db: Kysely<DB>): Promise<void> {
    await db.schema
      .createTable('auth_oidc_state')
      .addColumn('state', 'text', (col) => col.primaryKey().notNull())
      .addColumn('code_verifier', 'text', (col) => col.notNull())
      .addColumn('redirect_uri', 'text', (col) => col.notNull())
      .addColumn('created_at', 'timestamp', (col) =>
        col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull()
      )
      .execute();
  },

  async down(db: Kysely<unknown>): Promise<void> {
    // Drop indexes first
    await db.schema.dropTable('auth_oidc_state').execute();
  },
};
