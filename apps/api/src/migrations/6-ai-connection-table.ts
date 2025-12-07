import { Kysely, Migration, sql } from 'kysely';
import { DB } from '../storage/entities.generated';

export const migration: Migration = {
  async up(db: Kysely<DB>): Promise<void> {
    await db.schema
      .createTable('ai_connections')
      .addColumn('workspace_id', 'uuid', (col) => col.notNull())
      .addColumn('environment_id', 'uuid', (col) => col.notNull())
      .addColumn('connection_id', 'uuid', (col) =>
        col.notNull().defaultTo(sql`gen_random_uuid()`)
      )
      .addColumn('name', 'text', (col) => col.notNull())
      .addColumn('description', 'text')
      .addColumn('provider', 'text', (col) => col.notNull())
      .addColumn('allowed_models', 'jsonb')
      .addColumn('capacity', 'jsonb')
      .addColumn('discovered_capacity', 'jsonb')
      .addColumn('config', 'jsonb')
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
        'fk_ai_connections_environment',
        ['workspace_id', 'environment_id'],
        'environments',
        ['workspace_id', 'environment_id'],
        (eb) => eb.onDelete('cascade')
      )
      .addPrimaryKeyConstraint('pk_ai_connections', [
        'connection_id',
        'workspace_id',
        'environment_id',
      ])
      .execute();

    await db.schema
      .createIndex('idx_ai_connections_workspace_id')
      .on('ai_connections')
      .column('workspace_id')
      .execute();

    await db.schema
      .createIndex('idx_ai_connections_workspace_id_environment_id')
      .on('ai_connections')
      .column('workspace_id')
      .column('environment_id')
      .execute();

    await db.schema
      .createIndex('idx_ai_connections_created_by')
      .on('ai_connections')
      .column('created_by')
      .execute();

    await db.schema
      .createIndex('idx_ai_connections_updated_by')
      .on('ai_connections')
      .column('updated_by')
      .execute();
  },

  async down(db: Kysely<unknown>): Promise<void> {
    // Drop indexes first
    await db.schema.dropIndex('idx_ai_connections_created_by').execute();
    await db.schema.dropIndex('idx_ai_connections_updated_by').execute();
    await db.schema.dropIndex('idx_ai_connections_workspace_id').execute();
    await db.schema
      .dropIndex('idx_ai_connections_workspace_id_environment_id')
      .execute();
    await db.schema.dropTable('ai_connections').execute();
  },
};
