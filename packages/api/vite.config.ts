/// <reference types='vitest' />
import { defineConfig } from 'vite';
import swc from 'unplugin-swc';

/**
 * Three vitest test projects, all rooted in this package:
 *
 *  - `unit`        — pure functions, single-service tests, adapters,
 *                    detectors. No DI graph, no network. Default
 *                    PR-feedback gate (~1s).
 *  - `integration` — multi-service mocked-DI orchestrator tests +
 *                    feature specs (routing, fallback, capacity, etc.).
 *                    No network. Fast.
 *  - `live`        — real upstream-provider HTTP calls. Slow. Each
 *                    spec uses `describe.skipIf(!hasKeys(...))` to
 *                    self-skip when its provider's env var is unset,
 *                    so the target degrades gracefully.
 *
 * For the `live` project, env vars are loaded from `.env.local` at
 * workspace root (shared API keys) and project root (DB/Redis/encryption
 * config) by Nx before vitest is invoked.
 *
 * Run via the matching nx target configuration:
 *
 *   nx run api:test:unit
 *   nx run api:test:integration
 *   nx run api:test:live
 */
const sharedTestOptions = {
  watch: false,
  globals: true,
  environment: 'node' as const,
  passWithNoTests: true,
  reporters: ['default'] as const,
};

const integrationIncludes = [
  'src/__integration__/flow/**/*.{test,spec}.ts',
  'src/__integration__/resource-features/**/*.{test,spec}.ts',
];

const liveIncludes = [
  'src/__integration__/providers/**/*.{test,spec}.ts',
  'src/__integration__/live-flow/**/*.{test,spec}.ts',
  'src/__integration__/audit-payload-capture*.{test,spec}.ts',
  'src/__integration__/responses/end-to-end.{test,spec}.ts',
];

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/packages/api',
  // SWC plugin enables NestJS-style decorator metadata emission so
  // the HTTP-level integration harness's `Test.createTestingModule`
  // can DI-wire controllers (vite's default esbuild does not emit
  // `design:paramtypes`). Pure-function unit tests don't depend on
  // this; harmless overhead for them.
  // SWC plugin's typings haven't caught up to Vite 7's `PluginOption`,
  // but the plugin is a regular Vite plugin at runtime — cast to
  // satisfy the build.
  plugins: [
    swc.vite({
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }) as never,
  ],
  test: {
    ...sharedTestOptions,
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
      reporter: ['text', 'html', 'json-summary', 'lcov'],
      // Live tests have a few persistent model-behaviour failures
      // (Gemini-2.5-flash empty thinking output, Anthropic markdown
      // JSON, OpenAI citations on the test prompt). Coverage should
      // still emit when those fail so we can see what the rest of
      // the suite covered.
      reportOnFailure: true,
      // Coverage reflects what `unit` + `integration` exercise (the
      // `coverage` nx target configuration runs both). Live-only specs
      // are excluded — they hit real upstream APIs and aren't
      // deterministic, and what they exercise is mostly the
      // shared-with-integration provider classes anyway.
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.{spec,test}.ts',
        'src/__integration__/**',
        'src/storage/entities.generated.ts',
        'src/migrations/**',
        'src/main.ts',
        'src/instrumentation.ts',
        'src/migrate.ts',
        'src/**/*.module.ts',
        'src/**/*.dto.ts',
        'src/**/dto/**',
        'src/**/entities/**',
      ],
    },
    projects: [
      {
        extends: true,
        test: {
          ...sharedTestOptions,
          name: 'unit',
          include: ['src/**/*.{test,spec}.ts'],
          exclude: [...integrationIncludes, ...liveIncludes],
        },
      },
      {
        extends: true,
        test: {
          ...sharedTestOptions,
          name: 'integration',
          include: integrationIncludes,
        },
      },
      {
        extends: true,
        test: {
          ...sharedTestOptions,
          name: 'live',
          include: liveIncludes,
          // Live specs hit real upstream APIs whose responses depend on
          // model behaviour (empty completions on Gemini-2.5-flash
          // thinking models, JSON wrapped in markdown fences from
          // Anthropic, citations missing on the OpenAI web-search prompt,
          // 400s from Gemini's googleSearch compat shim). Retry up to
          // 2× before failing — vitest's native test-level retry is
          // the right tool here, not a custom skip-on-flake helper.
          retry: 2,
          // Real upstream calls + AppModule boot (~3s) routinely run
          // past vitest's 5s default. 60s covers the slowest providers
          // (Bedrock cold-start, Anthropic thinking models) with
          // headroom; per-test overrides aren't needed.
          testTimeout: 60_000,
          hookTimeout: 60_000,
          // Re-load `.env.local` files into `process.env` after Vite's
          // env initialisation. Vite reserves `BASE_URL` (and others)
          // and silently injects its own default (`'/'`), which fails
          // the API's Joi URI validator when live HTTP specs boot the
          // full AppModule. The setup file runs once per worker before
          // any test imports — see `test-setup.ts` for details.
          setupFiles: ['./test-setup.ts'],
        },
      },
    ],
  },
}));
