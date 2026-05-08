import path from 'node:path';
import fs from 'node:fs';

/**
 * Live-mode helpers for the Playwright suite.
 *
 * The e2e suite always runs against real provider APIs — there's no
 * opt-in flag. Provider keys are read from the workspace-root
 * `.env.local` (the same file the API integration tests use) so a
 * single edit covers both suites. Specs that need a key short-circuit
 * to `test.skip` when that specific key is missing.
 *
 * To override which key/model an individual spec uses, set the env
 * var inline:
 *
 *   OPENAI_TEST_MODEL=gpt-4o-mini pnpm exec nx run ui:e2e
 */

let loaded = false;

/**
 * Load `.env.local` from the workspace root (where the Docker stack
 * and API integration suite already look) so e2e specs see the same
 * keys. Idempotent — first call wins.
 *
 * The format is the standard dotenv shape (`KEY=value`, `#` comments,
 * optional quotes). We parse it inline to avoid pulling in `dotenv` as
 * a `packages/ui` dependency.
 */
export function loadLiveEnv(): void {
  if (loaded) return;
  loaded = true;

  const candidates = [
    path.resolve(__dirname, '../../../../.env.local'),
    path.resolve(__dirname, '../../../.env.local'),
    path.resolve(__dirname, '../../.env.local'),
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), '../../.env.local'),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const content = fs.readFileSync(p, 'utf8');
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      // Strip surrounding double or single quotes.
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      // Don't override values already in the environment (lets the
      // shell win, e.g. `OPENAI_TEST_MODEL=... pnpm exec nx run`).
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
    break;
  }
}

/**
 * Returns true when every env var in `keys` is present. Use as the
 * predicate for `test.skip(!hasLiveKeys(...))` so missing-key
 * environments still pass the rest of the suite.
 */
export function hasLiveKeys(...keys: string[]): boolean {
  loadLiveEnv();
  return keys.every((k) => (process.env[k] ?? '').length > 0);
}

export function liveEnv(key: string): string {
  loadLiveEnv();
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var for live e2e: ${key}`);
  return v;
}
