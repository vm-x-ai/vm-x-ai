import { Kysely, Migration, sql } from 'kysely';
import { DB } from '../storage/entities.generated';

export const migration: Migration = {
  async up(db: Kysely<DB>): Promise<void> {
    await db.schema
      .createTable('ai_resources')
      .addColumn('workspace_id', 'uuid', (col) => col.notNull())
      .addColumn('environment_id', 'uuid', (col) => col.notNull())
      .addColumn('resource_id', 'uuid', (col) =>
        col.notNull().defaultTo(sql`gen_random_uuid()`)
      )
      .addColumn('name', 'text', (col) => col.notNull())
      .addColumn('description', 'text')
      .addColumn('model', 'jsonb', (col) => col.notNull())
      .addColumn('routing', 'jsonb')
      .addColumn('secondary_models', 'jsonb')
      .addColumn('use_fallback', 'boolean', (col) =>
        col.notNull().defaultTo(false)
      )
      .addColumn('fallback_models', 'jsonb')
      .addColumn('enforce_capacity', 'boolean', (col) =>
        col.notNull().defaultTo(false)
      )
      .addColumn('capacity', 'jsonb')
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
        'fk_ai_resources_environment',
        ['workspace_id', 'environment_id'],
        'environments',
        ['workspace_id', 'environment_id'],
        (eb) => eb.onDelete('cascade')
      )
      .addPrimaryKeyConstraint('pk_ai_resources', [
        'resource_id',
        'workspace_id',
        'environment_id',
      ])
      .addUniqueConstraint('uq_ai_resources_workspace_id_environment_id_name', [
        'workspace_id',
        'environment_id',
        'name',
      ])
      .execute();

    await db.schema
      .createIndex('idx_ai_resources_workspace_id')
      .on('ai_resources')
      .column('workspace_id')
      .execute();

    await db.schema
      .createIndex('idx_ai_resources_workspace_id_environment_id')
      .on('ai_resources')
      .column('workspace_id')
      .column('environment_id')
      .execute();

    await db.schema
      .createIndex('idx_ai_resources_workspace_id_environment_id_name')
      .on('ai_resources')
      .column('workspace_id')
      .column('environment_id')
      .column('name')
      .execute();

    await db.schema
      .createIndex('idx_ai_resources_created_by')
      .on('ai_resources')
      .column('created_by')
      .execute();

    await db.schema
      .createIndex('idx_ai_resources_updated_by')
      .on('ai_resources')
      .column('updated_by')
      .execute();
  },

  async down(db: Kysely<unknown>): Promise<void> {
    // Drop indexes first
    await db.schema.dropIndex('idx_ai_resources_created_by').execute();
    await db.schema.dropIndex('idx_ai_resources_updated_by').execute();
    await db.schema.dropIndex('idx_ai_resources_workspace_id').execute();
    await db.schema
      .dropIndex('idx_ai_resources_workspace_id_environment_id')
      .execute();
    await db.schema
      .dropIndex('idx_ai_resources_workspace_id_environment_id_name')
      .execute();
    await db.schema.dropTable('ai_resources').execute();
  },
};
