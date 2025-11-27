import { Kysely, Migration, sql } from 'kysely';
import { DB } from '../storage/entities.generated';

export const migration: Migration = {
  async up(db: Kysely<DB>): Promise<void> {
    await sql`CREATE TYPE COMPLETION_AUDIT_TYPE AS ENUM ('COMPLETION', 'COMPLETION_BATCH')`.execute(
      db
    );

    await db.schema
      .createTable('completion_audit')
      .addColumn('id', 'uuid', (col) =>
        col.primaryKey().defaultTo(sql`gen_random_uuid()`)
      )
      .addColumn('timestamp', 'timestamptz', (col) => col.notNull())
      .addColumn('workspace_id', 'uuid', (col) => col.notNull())
      .addColumn('environment_id', 'uuid', (col) => col.notNull())
      .addColumn('type', sql`COMPLETION_AUDIT_TYPE`, (col) => col.notNull())
      .addColumn('status_code', 'integer', (col) => col.notNull())
      .addColumn('duration', 'integer', (col) => col.notNull())
      .addColumn('request_id', 'text', (col) => col.notNull())
      .addColumn('connection_id', 'uuid')
      .addColumn('events', 'jsonb')
      .addColumn('batch_id', 'uuid')
      .addColumn('correlation_id', 'text')
      .addColumn('resource', 'text')
      .addColumn('provider', 'text')
      .addColumn('model', 'text')
      .addColumn('source_ip', 'text')
      .addColumn('error_message', 'text')
      .addColumn('failure_reason', 'text')
      .addColumn('api_key_id', 'uuid')
      .addColumn('request_payload', 'jsonb')
      .addColumn('response_data', 'jsonb')
      .addColumn('response_headers', 'jsonb')
      .execute();

    await db.schema
      .createIndex('idx_completion_audit_timestamp')
      .on('completion_audit')
      .column('timestamp')
      .execute();

    await db.schema
      .createIndex('idx_completion_audit_workspace_id')
      .on('completion_audit')
      .column('workspace_id')
      .execute();

    await db.schema
      .createIndex('idx_completion_audit_workspace_id_environment_id')
      .on('completion_audit')
      .column('workspace_id')
      .column('environment_id')
      .execute();

    await db.schema
      .createIndex('idx_completion_audit_type')
      .on('completion_audit')
      .column('type')
      .execute();

    await db.schema
      .createIndex('idx_completion_audit_status_code')
      .on('completion_audit')
      .column('status_code')
      .execute();

    await db.schema
      .createIndex('idx_completion_audit_batch_id')
      .on('completion_audit')
      .column('batch_id')
      .execute();

    await db.schema
      .createIndex('idx_completion_audit_correlation_id')
      .on('completion_audit')
      .column('correlation_id')
      .execute();

    await db.schema
      .createIndex('idx_completion_audit_connection_id')
      .on('completion_audit')
      .column('connection_id')
      .execute();

    await db.schema
      .createIndex('idx_completion_audit_resource')
      .on('completion_audit')
      .column('resource')
      .execute();
  },

  async down(db: Kysely<unknown>): Promise<void> {
    // Drop indexes first
    await db.schema.dropIndex('idx_completion_audit_timestamp').execute();
    await db.schema.dropIndex('idx_completion_audit_workspace_id').execute();
    await db.schema
      .dropIndex('idx_completion_audit_workspace_id_environment_id')
      .execute();
    await db.schema.dropIndex('idx_completion_audit_type').execute();
    await db.schema.dropIndex('idx_completion_audit_status_code').execute();
    await db.schema.dropIndex('idx_completion_audit_batch_id').execute();
    await db.schema.dropIndex('idx_completion_audit_correlation_id').execute();
    await db.schema.dropIndex('idx_completion_audit_connection_id').execute();
    await db.schema.dropIndex('idx_completion_audit_resource').execute();
    await db.schema.dropTable('completion_audit').execute();
    await sql`DROP TYPE COMPLETION_AUDIT_TYPE`.execute(db);
  },
};
