import { Kysely, Migration } from 'kysely';
import { DB } from '../storage/entities.generated';

/**
 * Adds `format` to `request_audit`. Records which input wire format
 * the request landed on — `chat-completions`, `responses`, or
 * `anthropic` — so the Audit Drawer can surface a per-row badge and
 * cost dashboards can break down spend by endpoint.
 *
 * Why a real column instead of stuffing this into `metadata`: the
 * format is gateway-set (not caller-set) and we want it indexable for
 * future per-format aggregations. A free-form metadata key would mix
 * caller-supplied tags with the gateway's own discriminator.
 *
 * Nullable because pre-migration rows have no recorded format; the
 * orchestrator writes the field on every new row going forward.
 */
export const migration: Migration = {
  async up(db: Kysely<DB>): Promise<void> {
    await db.schema
      .alterTable('request_audit')
      .addColumn('format', 'text')
      .execute();
  },
  async down(db: Kysely<DB>): Promise<void> {
    await db.schema.alterTable('request_audit').dropColumn('format').execute();
  },
};
