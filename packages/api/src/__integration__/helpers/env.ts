/**
 * Tiny env-var helpers for the live-provider suite.
 *
 * Env vars are loaded by Nx automatically from `.env.local` at both
 * the workspace root and the project root before the matching
 * `test:*` target invokes vitest — no custom loader needed.
 *
 * Per-spec gates use `describe.skipIf(!hasKeys('OPENAI_API_KEY'))` so
 * `nx run api:test:live` degrades gracefully when only some
 * providers' keys are present (e.g. a contributor with only an
 * OpenAI key still gets the OpenAI cells).
 */

/** True when every listed env var is set. */
export function hasKeys(...keys: string[]): boolean {
  return keys.every((k) => !!process.env[k] && process.env[k]!.length > 0);
}

export function requiredEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}
