import { spawnSync } from 'node:child_process';

/**
 * Post-run housekeeping. Two jobs:
 *
 * 1. Reset Postgres to seed state (rollback + re-apply migrations) so
 *    the next run starts with no leftover connections, audit rows, or
 *    custom admin passwords.
 * 2. Flush Redis. Several gateway services cache by stable
 *    keys — most importantly `usersService.getByUsername('admin')` —
 *    so without a flush the new run hits a stale `password_hash` for
 *    the rebuilt admin user and every authenticated test fails with
 *    `invalid_credentials`.
 *
 * Video consolidation lives in `run-video-reporter.ts` instead — it
 * has to fire *after* the HTML reporter writes its bundle, which is
 * after `globalTeardown` has already returned.
 *
 * Best-effort: a failed reset emits a warning but never fails the
 * suite (the actual tests already finished by the time teardown runs).
 *
 * Skip via `PWNO_DB_RESET=1` for ad-hoc runs that want to keep
 * accumulated state for debugging.
 */
export default async function globalTeardown(): Promise<void> {
  if (process.env.PWNO_DB_RESET === '1') return;
  resetDatabase();
  flushRedis();
}

/** Flush every node of the local Redis cluster (ports 7001-7003). */
function flushRedis(): void {
  for (const port of [7001, 7002, 7003]) {
    const r = spawnSync('redis-cli', ['-p', String(port), 'FLUSHALL'], {
      encoding: 'utf8',
    });
    if (r.status !== 0) {
      console.warn(
        `[e2e teardown] redis FLUSHALL on :${port} failed — next run may see stale cached entities. Stderr:\n`,
        r.stderr ?? ''
      );
      return;
    }
  }
  console.log('[e2e teardown] redis cluster flushed');
}

/**
 * Reset the local Postgres schema by rolling every Kysely migration
 * back to zero, then re-applying them. Kysely's `migrate:reset` target
 * is gated to `localhost` + NODE_ENV=local|test on the API side, so
 * this is safe to call from the e2e harness without further plumbing.
 */
function resetDatabase(): void {
  const env = {
    ...process.env,
    NX_TUI: '0',
    NX_INTERACTIVE: 'false',
  };
  const reset = spawnSync('pnpm', ['exec', 'nx', 'run', 'api:migrate:reset'], {
    encoding: 'utf8',
    env,
  });
  if (reset.status !== 0) {
    console.warn(
      '[e2e teardown] migrate:reset failed — DB may have residual state. Stderr:\n',
      reset.stderr ?? ''
    );
    return;
  }
  const apply = spawnSync('pnpm', ['exec', 'nx', 'run', 'api:migrate'], {
    encoding: 'utf8',
    env,
  });
  if (apply.status !== 0) {
    console.warn(
      '[e2e teardown] migrate (re-apply) failed — DB is at zero state. Run `pnpm exec nx run api:migrate` manually before the next e2e run. Stderr:\n',
      apply.stderr ?? ''
    );
    return;
  }
  console.log('[e2e teardown] database reset (rolled back + re-applied)');
}
