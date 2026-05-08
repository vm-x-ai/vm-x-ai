import { Kysely, Migration, sql } from 'kysely';
import { DB } from '../storage/entities.generated';

export const migration: Migration = {
  async up(db: Kysely<DB>): Promise<void> {
    // The audit table records every request that flows through the gateway —
    // chat completions today, plus the OpenAI Responses API and (eventually)
    // embeddings, image, audio. Hence the generic `request_audit` name; the
    // `type` column distinguishes per-endpoint records.
    await sql`CREATE TYPE REQUEST_AUDIT_TYPE AS ENUM ('COMPLETION', 'COMPLETION_BATCH', 'RESPONSES')`.execute(
      db
    );

    await db.schema
      .createTable('request_audit')
      .addColumn('id', 'uuid', (col) =>
        col.primaryKey().defaultTo(sql`gen_random_uuid()`)
      )
      .addColumn('timestamp', 'timestamptz', (col) => col.notNull())
      .addColumn('workspace_id', 'uuid', (col) => col.notNull())
      .addColumn('environment_id', 'uuid', (col) => col.notNull())
      .addColumn('type', sql`REQUEST_AUDIT_TYPE`, (col) => col.notNull())
      .addColumn('status_code', 'integer', (col) => col.notNull())
      .addColumn('duration', 'integer', (col) => col.notNull())
      .addColumn('request_id', 'text', (col) => col.notNull())
      .addColumn('connection_id', 'uuid')
      .addColumn('events', 'jsonb')
      .addColumn('batch_id', 'uuid')
      .addColumn('correlation_id', 'text')
      .addColumn('resource_id', 'uuid')
      .addColumn('provider', 'text')
      .addColumn('model', 'text')
      .addColumn('source_ip', 'text')
      .addColumn('error_message', 'text')
      .addColumn('failure_reason', 'text')
      .addColumn('api_key_id', 'uuid')
      .addColumn('user_id', 'uuid')
      .addColumn('request_payload', 'jsonb')
      .addColumn('response_data', 'jsonb')
      .addColumn('response_headers', 'jsonb')
      // Token metrics
      .addColumn('prompt_tokens', 'integer')
      // Renamed from `completion_tokens` to mirror the OpenAI Responses
      // API + Anthropic Messages API, both of which expose
      // `output_tokens`. Reads naturally next to `prompt_tokens` /
      // `total_tokens`.
      .addColumn('output_tokens', 'integer')
      .addColumn('total_tokens', 'integer')
      .addColumn('cached_tokens', 'integer')
      .addColumn('reasoning_tokens', 'integer')
      // Anthropic prompt-cache write breakdown — bills at a higher
      // rate than regular input tokens (5m ephemeral 1.25×, 1h
      // ephemeral 2×). `cache_creation_input_tokens` is the total;
      // the per-TTL columns are the breakdown when reported.
      .addColumn('cache_creation_input_tokens', 'integer')
      // Naming: Kysely's CamelCasePlugin maps the entity field
      // `cacheCreationEphemeral5mTokens` to `cache_creation_ephemeral5m_tokens`
      // (no underscore between digit and adjacent letter), so the
      // physical column must match — `cache_creation_ephemeral_5m_tokens`
      // would silently fail every audit insert with `column does not
      // exist` on the cron flush.
      .addColumn('cache_creation_ephemeral5m_tokens', 'integer')
      .addColumn('cache_creation_ephemeral1h_tokens', 'integer')
      // Anthropic server-tool invocation counts (separate billing).
      .addColumn('server_tool_use_web_search_requests', 'integer')
      .addColumn('server_tool_use_code_execution_requests', 'integer')
      // OpenAI audio output + predicted-output billing.
      .addColumn('audio_tokens', 'integer')
      .addColumn('accepted_prediction_tokens', 'integer')
      .addColumn('rejected_prediction_tokens', 'integer')
      // Reproducibility / cost-reconciliation.
      .addColumn('system_fingerprint', 'text')
      .addColumn('service_tier', 'text')
      // Performance metrics
      .addColumn('tokens_per_second', 'double precision')
      .addColumn('time_to_first_token', 'integer')
      .addColumn('request_duration', 'integer')
      .addColumn('provider_duration', 'integer')
      .addColumn('gate_duration', 'integer')
      .addColumn('routing_duration', 'integer')
      // Computed counters for usage analytics
      .addColumn('error_count', 'integer', (col) => col.defaultTo(0))
      .addColumn('success_count', 'integer', (col) => col.defaultTo(0))
      // Provider message identifier (response id)
      .addColumn('message_id', 'text')
      // Extensibility
      .addColumn('metadata', 'jsonb')
      .addColumn('cost', 'jsonb')
      .execute();

    await db.schema
      .createIndex('idx_request_audit_timestamp')
      .on('request_audit')
      .column('timestamp')
      .execute();

    await db.schema
      .createIndex('idx_request_audit_workspace_id')
      .on('request_audit')
      .column('workspace_id')
      .execute();

    await db.schema
      .createIndex('idx_request_audit_workspace_id_environment_id')
      .on('request_audit')
      .column('workspace_id')
      .column('environment_id')
      .execute();

    await db.schema
      .createIndex('idx_request_audit_type')
      .on('request_audit')
      .column('type')
      .execute();

    await db.schema
      .createIndex('idx_request_audit_status_code')
      .on('request_audit')
      .column('status_code')
      .execute();

    await db.schema
      .createIndex('idx_request_audit_batch_id')
      .on('request_audit')
      .column('batch_id')
      .execute();

    await db.schema
      .createIndex('idx_request_audit_correlation_id')
      .on('request_audit')
      .column('correlation_id')
      .execute();

    await db.schema
      .createIndex('idx_request_audit_connection_id')
      .on('request_audit')
      .column('connection_id')
      .execute();

    await db.schema
      .createIndex('idx_request_audit_resource_id')
      .on('request_audit')
      .column('resource_id')
      .execute();

    await db.schema
      .createIndex('idx_request_audit_user_id')
      .on('request_audit')
      .column('user_id')
      .execute();

    await db.schema
      .createIndex('idx_request_audit_metadata')
      .on('request_audit')
      .using('GIN')
      .column('metadata')
      .execute();

    await db.schema
      .createIndex('idx_request_audit_timestamp_ws_env')
      .on('request_audit')
      .columns(['timestamp', 'workspace_id', 'environment_id'])
      .execute();

    await db.schema
      .createIndex('idx_request_audit_provider_model')
      .on('request_audit')
      .columns(['provider', 'model'])
      .execute();
  },

  async down(db: Kysely<unknown>): Promise<void> {
    // Drop indexes first
    await db.schema.dropIndex('idx_request_audit_provider_model').execute();
    await db.schema.dropIndex('idx_request_audit_timestamp_ws_env').execute();
    await db.schema.dropIndex('idx_request_audit_metadata').execute();
    await db.schema.dropIndex('idx_request_audit_timestamp').execute();
    await db.schema.dropIndex('idx_request_audit_workspace_id').execute();
    await db.schema
      .dropIndex('idx_request_audit_workspace_id_environment_id')
      .execute();
    await db.schema.dropIndex('idx_request_audit_type').execute();
    await db.schema.dropIndex('idx_request_audit_status_code').execute();
    await db.schema.dropIndex('idx_request_audit_batch_id').execute();
    await db.schema.dropIndex('idx_request_audit_correlation_id').execute();
    await db.schema.dropIndex('idx_request_audit_connection_id').execute();
    await db.schema.dropIndex('idx_request_audit_resource_id').execute();
    await db.schema.dropIndex('idx_request_audit_user_id').execute();
    await db.schema.dropTable('request_audit').execute();
    await sql`DROP TYPE REQUEST_AUDIT_TYPE`.execute(db);
  },
};
