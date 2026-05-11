import { execSync } from 'node:child_process';
import { defineConfig, devices } from '@playwright/test';
import { nxE2EPreset } from '@nx/playwright/preset';
import { workspaceRoot } from '@nx/devkit';

const baseURL = process.env['BASE_URL'] || 'http://localhost:3001';

/**
 * If a dev server is already responding on the UI port, skip the
 * `webServer` block entirely — Playwright will then just wait for the
 * URL and reuse the existing server. This avoids racing against Next's
 * `.next/dev` lock when developers run `nx run ui:dev` in another shell.
 */
function isUIDevServerRunning(): boolean {
  try {
    execSync(`curl -sf ${baseURL} -o /dev/null`, {
      stdio: 'ignore',
      timeout: 3_000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * VM-X UI end-to-end test configuration.
 *
 * Notable choices:
 *
 * - **Video on**: every test records a `.webm` so failures can be reviewed
 *   visually (per-spec videos are saved under `test-results/`).
 *   Override with `PWVIDEO=off` for fast local iteration.
 *
 * - **Trace + screenshot on failure**: complementary to the video. Trace
 *   files open in `npx playwright show-trace` and capture every action.
 *
 * - **HTML report**: generated under `playwright-report/` after each run;
 *   includes embedded videos/traces. Open with
 *   `pnpm exec playwright show-report packages/ui/playwright-report`.
 *
 * - **Reuses an existing dev server** if one is already running on :3001
 *   (handy when iterating; avoids the 30s+ startup tax). CI launches its
 *   own via the `webServer` block.
 */
export default defineConfig({
  ...nxE2EPreset(__filename, { testDir: './e2e' }),
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  // 1 worker is the default both locally and in CI. Even at 2 workers
  // the Next.js dev server under turbopack gets saturated enough that
  // page-loading-state assertions start hitting `Loading environment
  // details…` placeholders — and once the SSR queue backs up far
  // enough, the dev server stops responding entirely and every
  // subsequent test times out at 50s. 1 worker keeps every spec on
  // the happy path. Override with `PLAYWRIGHT_WORKERS=N` if you've got
  // a beefier box and want to parallelise.
  workers: process.env.PLAYWRIGHT_WORKERS
    ? Number(process.env.PLAYWRIGHT_WORKERS)
    : 1,
  // After each run, stitch every per-test `.webm` into a single
  // `test-output/playwright/run.webm` reviewers can scrub through. See
  // `e2e/global-teardown.ts`.
  globalTeardown: require.resolve('./e2e/global-teardown'),
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    // Order matters — this reporter has to fire *after* the HTML
    // reporter so it can patch the freshly-written report. See
    // `e2e/run-video-reporter.ts`.
    ['./e2e/run-video-reporter.ts'],
  ],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Always record video; override via env when iterating locally.
    // The default Chromium viewport (1280x720) is too narrow to fit the
    // dashboard's two-pane layouts (e.g. Audit's filter row, Usage's
    // group-by chips), so we widen both the browser and the recorded
    // video to a 16:9 desktop size that mirrors what reviewers run with.
    video:
      process.env['PWVIDEO'] === 'off'
        ? 'off'
        : { mode: 'on', size: { width: 1920, height: 1080 } },
    viewport: { width: 1920, height: 1080 },
  },
  ...(isUIDevServerRunning()
    ? {}
    : {
        webServer: {
          // Go through Nx so the dev server is started the same way
          // every other invocation does — `pnpm nx run ui:dev` picks
          // up the workspace's project graph + plugin defaults
          // (turbopack flags, env loading, etc.). Bypassing Nx with
          // `pnpm --filter ui exec next dev` skips that wiring and
          // produced subtly different behaviour (different port
          // resolution, missing build deps).
          command: 'pnpm exec nx run ui:dev',
          cwd: workspaceRoot,
          url: 'http://localhost:3001',
          reuseExistingServer: false,
          timeout: 120_000,
        },
      }),
  projects: [
    {
      name: 'chromium',
      // Override the device viewport so the recorded video matches the
      // browser viewport — Desktop Chrome's default 1280x720 silently
      // clips the right edge of the dashboard's filter rows on Insights.
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
      },
    },
    // Firefox / WebKit are deliberately commented out for the initial CI
    // run — Chromium catches the vast majority of issues and tripling the
    // matrix triples the runtime. Re-enable when there's a multi-browser
    // bug worth guarding against.
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],
});
