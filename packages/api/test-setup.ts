import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Vite reserves `BASE_URL` (and a few other names) for `import.meta.env`
// and silently overrides them with its own defaults — `BASE_URL` becomes
// `'/'` regardless of what `.env.local` says. That breaks the API's Joi
// config validator (`BASE_URL: Joi.string().uri().required()`) for any
// live HTTP test that boots `AppModule`. Load the `.env.local` files
// ourselves and re-assert their values on `process.env` after vitest /
// vite have finished their env initialisation.
//
// Two files are considered, last-wins:
//   1. workspace-root `.env.local` (shared API keys, AWS creds)
//   2. project-root `packages/api/.env.local` (DB, Redis, BASE_URL)

function parseDotEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const parsed = parseDotEnv(readFileSync(path, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    // Force-override even if the key already exists: Vite's BASE_URL
    // injection happens first and we explicitly want our .env.local
    // value to win.
    process.env[key] = value;
  }
}

loadEnvFile(resolve(__dirname, '../../.env.local'));
loadEnvFile(resolve(__dirname, '.env.local'));
