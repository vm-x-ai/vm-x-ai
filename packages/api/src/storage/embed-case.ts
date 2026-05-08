import { camelCase, isPlainObject } from 'lodash';

/**
 * Recursively camelCase the keys inside specified embed values of
 * a Kysely row.
 *
 * Why this exists: our `CamelCasePlugin` is configured with
 * `maintainNestedObjectKeys: true` so JSONB columns like
 * `request_audit.metadata` and `users.provider_metadata` round-trip
 * verbatim — operator-supplied `{user_id: ...}` payloads must not
 * silently flip to `userId`. The cost is that Postgres-aggregated
 * relation embeds (`jsonArrayFrom` / `jsonObjectFrom`) come back
 * with their column names as snake_case keys, since the plugin
 * skips ALL nested objects to keep its rule simple.
 *
 * We can't tell at the result layer which nested object is a
 * relation embed and which is operator data, so we let each
 * caller declare the embed keys explicitly.
 *
 * Usage:
 *   return rows.map((row) =>
 *     camelCaseEmbeds(row, ['environments', 'createdByUser'])
 *   );
 *
 * Caller responsibility: don't list an embed key whose value
 * contains a JSONB column you need preserved (e.g. an embedded
 * user's `providerMetadata`). The recursion is unconditional
 * inside each listed value.
 */
export function camelCaseEmbeds<T extends Record<string, unknown>>(
  row: T,
  embedKeys: readonly (keyof T & string)[]
): T {
  const out: Record<string, unknown> = { ...row };
  for (const key of embedKeys) {
    if (key in out) {
      out[key] = mapKeysDeep(out[key]);
    }
  }
  return out as T;
}

function mapKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(mapKeysDeep);
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[camelCase(k)] = mapKeysDeep(v);
    }
    return out;
  }
  return value;
}
