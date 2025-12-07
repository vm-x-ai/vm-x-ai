import { Kysely, Migration, sql } from 'kysely';
import { DB } from '../storage/entities.generated';

export const migration: Migration = {
  async up(db: Kysely<DB>): Promise<void> {
    await db.schema
      .createTable('pool_definitions')
      .addColumn('workspace_id', 'uuid', (col) => col.notNull())
      .addColumn('environment_id', 'uuid', (col) => col.notNull())
      .addColumn('definition', 'jsonb', (col) => col.notNull())
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
        'fk_pool_definitions_environment',
        ['workspace_id', 'environment_id'],
        'environments',
        ['workspace_id', 'environment_id'],
        (eb) => eb.onDelete('cascade')
      )
      .addPrimaryKeyConstraint('pk_pool_definitions', [
        'workspace_id',
        'environment_id',
      ])
      .execute();

    await db.schema
      .createIndex('idx_pool_definitions_workspace_id')
      .on('pool_definitions')
      .column('workspace_id')
      .execute();

    await db.schema
      .createIndex('idx_pool_definitions_created_by')
      .on('pool_definitions')
      .column('created_by')
      .execute();

    await db.schema
      .createIndex('idx_pool_definitions_updated_by')
      .on('pool_definitions')
      .column('updated_by')
      .execute();
  },

  async down(db: Kysely<unknown>): Promise<void> {
    // Drop indexes first
    await db.schema.dropIndex('idx_pool_definitions_created_by').execute();
    await db.schema.dropIndex('idx_pool_definitions_updated_by').execute();
    await db.schema.dropIndex('idx_pool_definitions_workspace_id').execute();
    await db.schema.dropTable('pool_definitions').execute();
  },
};
