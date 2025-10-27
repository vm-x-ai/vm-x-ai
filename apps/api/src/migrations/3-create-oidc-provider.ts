import { Kysely, Migration } from 'kysely';
import { DB } from '../storage/entities.generated';

export const migration: Migration = {
  async up(db: Kysely<DB>): Promise<void> {
    await db.schema
      .createTable('oidc_provider')
      .addColumn('id', 'text', (col) => col.primaryKey().notNull())
      .addColumn('payload', 'jsonb', (col) => col.notNull())
      .addColumn('grant_id', 'text')
      .addColumn('uid', 'text')
      .addColumn('user_code', 'text')
      .addColumn('expires_at', 'timestamp')
      .addColumn('consumed', 'boolean', (col) => col.notNull().defaultTo(false))
      .execute();

    await db.schema
      .createIndex('idx_oidc_provider_grant_id')
      .on('oidc_provider')
      .column('grant_id')
      .execute();

    await db.schema
      .createIndex('idx_oidc_provider_expires_at')
      .on('oidc_provider')
      .column('expires_at')
      .execute();
    
    await db.schema
      .createIndex('idx_oidc_provider_uid')
      .on('oidc_provider')
      .column('uid')
      .execute();

    await db.schema
      .createIndex('idx_oidc_provider_user_code')
      .on('oidc_provider')
      .column('user_code')
      .execute();
  },

  async down(db: Kysely<unknown>): Promise<void> {
    // Drop indexes first
    await db.schema.dropIndex('idx_oidc_provider_grant_id').execute();
    await db.schema.dropIndex('idx_oidc_provider_expires_at').execute();
    await db.schema.dropIndex('idx_oidc_provider_uid').execute();
    await db.schema.dropIndex('idx_oidc_provider_user_code').execute();
    await db.schema.dropTable('oidc_provider').execute();
  },
};
