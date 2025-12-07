import { Kysely, Migration, sql } from 'kysely';
import { DB } from '../storage/entities.generated';

export const migration: Migration = {
  async up(db: Kysely<DB>): Promise<void> {
    await db.schema
      .createTable('api_keys')
      .addColumn('workspace_id', 'uuid', (col) => col.notNull())
      .addColumn('environment_id', 'uuid', (col) => col.notNull())
      .addColumn('api_key_id', 'uuid', (col) =>
        col.notNull().defaultTo(sql`gen_random_uuid()`)
      )
      .addColumn('name', 'text', (col) => col.notNull())
      .addColumn('description', 'text')
      .addColumn('enabled', 'boolean', (col) => col.notNull().defaultTo(true))
      .addColumn('resources', 'jsonb', (col) => col.notNull())
      .addColumn('labels', 'jsonb')
      .addColumn('enforce_capacity', 'boolean', (col) =>
        col.notNull().defaultTo(false)
      )
      .addColumn('capacity', 'jsonb')
      .addColumn('hash', 'text', (col) => col.notNull())
      .addColumn('masked_key', 'text', (col) => col.notNull())
      .addColumn('created_at', 'timestamp', (col) =>
        col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull()
      )
      .addColumn('created_by', 'uuid', (col) =>
        col.notNull().references('users.id')
      )
      .addColumn('updated_at', 'timestamp', (col) =>
        col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull()
      )
      .addColumn('updated_by', 'uuid', (col) =>
        col.notNull().references('users.id')
      )
      .addForeignKeyConstraint(
        'fk_api_keys_environment',
        ['workspace_id', 'environment_id'],
        'environments',
        ['workspace_id', 'environment_id'],
        (eb) => eb.onDelete('cascade')
      )
      .addPrimaryKeyConstraint('pk_api_keys', [
        'api_key_id',
        'workspace_id',
        'environment_id',
      ])
      .execute();

    await db.schema
      .createIndex('idx_api_keys_workspace_id')
      .on('api_keys')
      .column('workspace_id')
      .execute();

    await db.schema
      .createIndex('idx_api_keys_created_by')
      .on('api_keys')
      .column('created_by')
      .execute();

    await db.schema
      .createIndex('idx_api_keys_updated_by')
      .on('api_keys')
      .column('updated_by')
      .execute();

    await db.schema
      .createIndex('idx_api_keys_hash')
      .on('api_keys')
      .column('hash')
      .execute();
  },

  async down(db: Kysely<unknown>): Promise<void> {
    // Drop indexes first
    await db.schema.dropIndex('idx_api_keys_created_by').execute();
    await db.schema.dropIndex('idx_api_keys_updated_by').execute();
    await db.schema.dropIndex('idx_api_keys_workspace_id').execute();
    await db.schema.dropIndex('idx_api_keys_hash').execute();
    await db.schema.dropTable('api_keys').execute();
  },
};
