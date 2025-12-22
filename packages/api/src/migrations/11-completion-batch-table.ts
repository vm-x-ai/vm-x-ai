import { Kysely, Migration, sql } from 'kysely';
import { DB } from '../storage/entities.generated';

export const migration: Migration = {
  async up(db: Kysely<DB>): Promise<void> {
    await sql`CREATE TYPE COMPLETION_BATCH_REQUEST_TYPE AS ENUM ('ASYNC', 'SYNC', 'CALLBACK')`.execute(
      db
    );

    await sql`CREATE TYPE COMPLETION_BATCH_REQUEST_STATUS AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')`.execute(
      db
    );

    await db.schema
      .createTable('completion_batch')
      .addColumn('workspace_id', 'uuid', (col) => col.notNull())
      .addColumn('environment_id', 'uuid', (col) => col.notNull())
      .addColumn('batch_id', 'uuid', (col) =>
        col.notNull().defaultTo(sql`gen_random_uuid()`)
      )
      .addColumn('timestamp', 'timestamptz', (col) => col.notNull())
      .addColumn('type', sql`COMPLETION_BATCH_REQUEST_TYPE`, (col) =>
        col.notNull()
      )
      .addColumn('status', sql`COMPLETION_BATCH_REQUEST_STATUS`, (col) =>
        col.notNull()
      )
      .addColumn('callback_options', 'jsonb')
      .addColumn('completed', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('failed', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('running', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('pending', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('total_items', 'integer', (col) => col.notNull().defaultTo(0))
      .addColumn('total_estimated_prompt_tokens', 'integer', (col) =>
        col.notNull().defaultTo(0)
      )
      .addColumn('total_prompt_tokens', 'integer', (col) =>
        col.notNull().defaultTo(0)
      )
      .addColumn('total_completion_tokens', 'integer', (col) =>
        col.notNull().defaultTo(0)
      )
      .addColumn('capacity', 'jsonb')
      .addColumn('error_message', 'text')
      .addColumn('created_at', 'timestamp', (col) =>
        col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull()
      )
      .addColumn('completed_at', 'timestamp')
      .addColumn('created_by_user_id', 'uuid', (col) =>
        col.references('users.id')
      )
      .addColumn('created_by_api_key_id', 'uuid')
      .addColumn('updated_at', 'timestamp', (col) =>
        col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull()
      )
      .addForeignKeyConstraint(
        'fk_completion_batch_created_by_api_key_id',
        ['workspace_id', 'environment_id', 'created_by_api_key_id'],
        'api_keys',
        ['workspace_id', 'environment_id', 'api_key_id']
      )
      .addForeignKeyConstraint(
        'fk_completion_batch_environment',
        ['workspace_id', 'environment_id'],
        'environments',
        ['workspace_id', 'environment_id']
      )
      .addPrimaryKeyConstraint('pk_completion_batch', [
        'batch_id',
        'workspace_id',
        'environment_id',
      ])
      .execute();

    await db.schema
      .createIndex('idx_completion_batch_workspace_id')
      .on('completion_batch')
      .column('workspace_id')
      .execute();

    await db.schema
      .createIndex('idx_completion_batch_workspace_id_environment_id')
      .on('completion_batch')
      .column('workspace_id')
      .column('environment_id')
      .execute();

    await db.schema
      .createIndex('idx_completion_batch_status')
      .on('completion_batch')
      .column('status')
      .execute();

    await db.schema
      .createIndex('idx_completion_batch_created_by_user_id')
      .on('completion_batch')
      .column('created_by_user_id')
      .execute();

    await db.schema
      .createIndex('idx_completion_batch_created_by_api_key_id')
      .on('completion_batch')
      .column('created_by_api_key_id')
      .execute();
  },

  async down(db: Kysely<unknown>): Promise<void> {
    // Drop indexes first
    await db.schema.dropIndex('idx_completion_batch_workspace_id').execute();
    await db.schema
      .dropIndex('idx_completion_batch_workspace_id_environment_id')
      .execute();
    await db.schema.dropIndex('idx_completion_batch_status').execute();
    await db.schema
      .dropIndex('idx_completion_batch_created_by_user_id')
      .execute();
    await db.schema
      .dropIndex('idx_completion_batch_created_by_api_key_id')
      .execute();
    await db.schema.dropTable('completion_batch').execute();
    await sql`DROP TYPE COMPLETION_BATCH_REQUEST_TYPE`.execute(db);
    await sql`DROP TYPE COMPLETION_BATCH_REQUEST_STATUS`.execute(db);
  },
};
