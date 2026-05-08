import nx from '@nx/eslint-plugin';
import jsoncParser from 'jsonc-eslint-parser';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: [
      '**/dist',
      '**/out-tsc',
      '**/vite.config.*.timestamp*',
      '**/vitest.config.*.timestamp*',
      '**/test-output',
      '**/playwright-report',
      '**/playwright/.cache',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            {
              sourceTag: '*',
              onlyDependOnLibsWithTags: ['*'],
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    // Override or add rules here
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          ignoreRestSiblings: true,
          argsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['**/*.json'],
    languageOptions: {
      parser: jsoncParser,
    },
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          ignoredFiles: [
            '**/vite.config.ts',
            '**/next.config.js',
            '**/eslint.config.mjs',
            '**/openapi-ts.*.config.ts',
            '**/postcss.config.mjs',
          ],
          ignoredDependencies: [
            'class-transformer',
            'pino-pretty',
            'pino-http',
            '@fastify/static',
            'tailwindcss',
            'tw-animate-css',
            '@docusaurus/theme-mermaid',
            // Test-only deps used in `__integration__/*.spec.ts` files —
            // already declared as devDependencies on the package, but the
            // dep-checks rule walks application source + tests together
            // and only inspects `dependencies`.
            'vitest',
            '@playwright/test',
            '@nx/playwright',
            '@nx/devkit',
            // HTTP-level integration tests use the NestJS testing
            // module + the SWC transform plugin to wire DI inside
            // tests. Both are devDependencies on the api package.
            '@nestjs/testing',
            'unplugin-swc',
          ],
        },
      ],
    },
  },
  // Playwright e2e tests use a few patterns the default lint rules
  // flag but we accept intentionally:
  //  - `networkidle` is the most reliable signal that our SPA's
  //    React-Query revalidations have settled before assertions run.
  //  - Fixture functions accept a `use` parameter; the `react-hooks`
  //    plugin sees the name and false-positive flags it as a React Hook.
  //  - Fixture-internal `isVisible().catch()` probes are treated as
  //    standalone expectations even though they're inside `await use(...)`.
  //  - `waitForTimeout` is necessary in a few places to let CSS
  //    transitions / debounce settle when there's no observable DOM
  //    change to wait for.
  //  - `no-conditional-in-test` flags branches in fixtures that handle
  //    optional state (e.g. if seed-admin already changed password).
  //  - `no-skipped-test` flags `test.skip()` markers we use intentionally
  //    when a test is gated on env credentials (live providers) or
  //    blocked on an upstream regression we're tracking.
  //  - `expect-expect` flags multi-step live-provider tests where each
  //    step is its own `test()` and the assertions live inside the
  //    helpers it calls.
  // Scope the relax to the e2e tree so application code stays strict.
  {
    files: ['**/e2e/**/*.ts', '**/e2e/**/*.tsx'],
    rules: {
      'playwright/no-networkidle': 'off',
      'playwright/prefer-web-first-assertions': 'off',
      'playwright/no-standalone-expect': 'off',
      'playwright/no-wait-for-timeout': 'off',
      'playwright/no-conditional-in-test': 'off',
      'playwright/no-skipped-test': 'off',
      'playwright/expect-expect': 'off',
      'react-hooks/rules-of-hooks': 'off',
    },
  },
  // Test specs assert post-setup invariants and use `!` to narrow types
  // after fixture/factory steps that always return data. Relaxing the
  // non-null-assertion rule keeps tests readable without sprinkling
  // unnecessary `?? throw new Error(...)` boilerplate. Application
  // code keeps the strict rule.
  {
    files: ['**/*.spec.ts', '**/__integration__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
];
