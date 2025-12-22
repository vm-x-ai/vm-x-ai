import { Kysely, Migration, sql } from 'kysely';
import { DB } from '../storage/entities.generated';

export const migration: Migration = {
  async up(db: Kysely<DB>): Promise<void> {
    await db.schema
      .createTable('completion_batch_items')
      .addColumn('workspace_id', 'uuid', (col) => col.notNull())
      .addColumn('environment_id', 'uuid', (col) => col.notNull())
      .addColumn('item_id', 'uuid', (col) =>
        col.notNull().defaultTo(sql`gen_random_uuid()`)
      )
      .addColumn('batch_id', 'uuid', (col) => col.notNull())
      .addColumn('status', sql`COMPLETION_BATCH_REQUEST_STATUS`, (col) =>
        col.notNull()
      )
      .addColumn('resource_id', 'uuid', (col) => col.notNull())
      .addColumn('request', 'jsonb', (col) => col.notNull())
      .addColumn('response', 'jsonb')
      .addColumn('error_message', 'text')
      .addColumn('retry_count', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('estimated_prompt_tokens', 'integer', (col) =>
        col.notNull().defaultTo(0)
      )
      .addColumn('prompt_tokens', 'integer', (col) =>
        col.notNull().defaultTo(0)
      )
      .addColumn('completion_tokens', 'integer', (col) =>
        col.notNull().defaultTo(0)
      )
      .addColumn('total_tokens', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('created_at', 'timestamp', (col) =>
        col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
      )
      .addColumn('completed_at', 'timestamp')
      .addForeignKeyConstraint(
        'fk_completion_batch_items_environment',
        ['workspace_id', 'environment_id'],
        'environments',
        ['workspace_id', 'environment_id']
      )
      .addForeignKeyConstraint(
        'fk_completion_batch_items_batch_id',
        ['workspace_id', 'environment_id', 'batch_id'],
        'completion_batch',
        ['workspace_id', 'environment_id', 'batch_id']
      )
      .addPrimaryKeyConstraint('pk_completion_batch_items', [
        'item_id',
        'workspace_id',
        'environment_id',
        'batch_id',
      ])
      .execute();

    await db.schema
      .createIndex('idx_completion_batch_items_workspace_id')
      .on('completion_batch_items')
      .column('workspace_id')
      .execute();

    await db.schema
      .createIndex('idx_completion_batch_items_workspace_id_environment_id')
      .on('completion_batch_items')
      .column('workspace_id')
      .column('environment_id')
      .execute();

    await db.schema
      .createIndex('idx_completion_batch_items_resource_id')
      .on('completion_batch_items')
      .column('resource_id')
      .execute();

    await db.schema
      .createIndex('idx_completion_batch_items_batch_id')
      .on('completion_batch_items')
      .column('batch_id')
      .execute();

    await db.schema
      .createIndex('idx_completion_batch_items_status')
      .on('completion_batch_items')
      .column('status')
      .execute();
  },

  async down(db: Kysely<unknown>): Promise<void> {
    // Drop indexes first
    await db.schema
      .dropIndex('idx_completion_batch_items_workspace_id')
      .execute();
    await db.schema
      .dropIndex('idx_completion_batch_items_workspace_id_environment_id')
      .execute();
    await db.schema
      .dropIndex('idx_completion_batch_items_resource_id')
      .execute();
    await db.schema;
    await db.schema.dropIndex('idx_completion_batch_items_batch_id').execute();
    await db.schema.dropIndex('idx_completion_batch_items_status').execute();
    await db.schema.dropTable('completion_batch_items').execute();
  },
};
