import { Kysely, Migration } from 'kysely';
import { DB } from '../storage/entities.generated';

export const migration: Migration = {
  async up(db: Kysely<DB>): Promise<void> {
    // Per-key projection of `request_audit.metadata` for fast filter/group-by
    // queries from the Audit + Usage UI. Foreign-keyed back to `request_audit`
    // so cleanup follows the parent on delete.
    await db.schema
      .createTable('request_audit_metadata')
      .addColumn('audit_id', 'uuid', (col) =>
        col.notNull().references('request_audit.id').onDelete('cascade')
      )
      .addColumn('key', 'varchar(255)', (col) => col.notNull())
      .addColumn('value', 'text', (col) => col.notNull())
      .addColumn('workspace_id', 'uuid', (col) => col.notNull())
      .addColumn('environment_id', 'uuid', (col) => col.notNull())
      .addColumn('timestamp', 'timestamptz', (col) => col.notNull())
      .addColumn('connection_id', 'uuid')
      .addColumn('resource_id', 'uuid')
      .addColumn('provider', 'varchar(255)')
      .addColumn('model', 'varchar(255)')
      .addColumn('prompt_tokens', 'integer')
      // Renamed from `completion_tokens` to mirror the OpenAI Responses
      // API + Anthropic Messages API. Matches the parent
      // `request_audit.output_tokens` column.
      .addColumn('output_tokens', 'integer')
      .addColumn('total_tokens', 'integer')
      .addColumn('cached_tokens', 'integer')
      .addColumn('reasoning_tokens', 'integer')
      .addColumn('request_duration', 'integer')
      .addColumn('total_cost', 'double precision')
      .addColumn('error_count', 'integer', (col) => col.defaultTo(0))
      .addColumn('success_count', 'integer', (col) => col.defaultTo(0))
      .addPrimaryKeyConstraint('request_audit_metadata_pk', ['audit_id', 'key'])
      .execute();

    await db.schema
      .createIndex('idx_ram_query')
      .on('request_audit_metadata')
      .columns(['workspace_id', 'environment_id', 'key', 'timestamp'])
      .execute();

    await db.schema
      .createIndex('idx_ram_value')
      .on('request_audit_metadata')
      .columns(['workspace_id', 'environment_id', 'key', 'value', 'timestamp'])
      .execute();
  },

  async down(db: Kysely<unknown>): Promise<void> {
    await db.schema.dropTable('request_audit_metadata').execute();
  },
};
