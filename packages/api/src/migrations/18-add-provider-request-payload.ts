import { Kysely, Migration } from 'kysely';
import { DB } from '../storage/entities.generated';

/**
 * Adds `provider_request_payload` to `request_audit`. Stores what each
 * provider's SDK actually saw on the wire — pre-flight conversion (or
 * the verbatim body when the provider passed-through the input format).
 *
 * Why: the existing `request_payload` column captures only what the
 * client sent. When we route an Anthropic-shape request to AWS Bedrock-
 * Invoke (passthrough) or convert OpenAI-shape to Bedrock-Converse
 * internally, debugging downstream parsing issues required digging
 * through provider logs. Storing both shapes side-by-side on the audit
 * row makes it a one-screen investigation.
 *
 * Nullable + JSONB to match the existing `request_payload`. The
 * audit-row sanitiser walks both columns to strip multimodal bytes.
 */
export const migration: Migration = {
  async up(db: Kysely<DB>): Promise<void> {
    await db.schema
      .alterTable('request_audit')
      .addColumn('provider_request_payload', 'jsonb')
      .execute();
  },
  async down(db: Kysely<DB>): Promise<void> {
    await db.schema
      .alterTable('request_audit')
      .dropColumn('provider_request_payload')
      .execute();
  },
};
