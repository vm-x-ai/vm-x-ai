#!/usr/bin/env node
/**
 * Emit `dist/pnpm-workspace.yaml` for the pruned Docker payload.
 *
 * Why: pnpm 10/11 enforces an explicit allow-list before any package
 * post-install script runs. The root `pnpm-workspace.yaml` carries
 * the workspace's `allowBuilds` map, but the prune step only emits
 * `dist/package.json` + `dist/pnpm-lock.yaml`; without a matching
 * workspace yaml in the image, `pnpm install` inside the Docker
 * build trips `ERR_PNPM_IGNORED_BUILDS` on argon2, esbuild, etc.
 * Tried `pnpm.allowBuilds` in `dist/package.json` — pnpm 11 does
 * not read it from there; only the workspace yaml works.
 *
 * Source of truth is `packages/api/package.json` →
 * `pnpm.onlyBuiltDependencies`; this script mirrors that list into
 * both `allowBuilds` (the map pnpm 11 actually checks) and
 * `onlyBuiltDependencies` (the gate list) in the emitted yaml.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, '..');
const pkg = JSON.parse(readFileSync(resolve(apiRoot, 'package.json'), 'utf8'));
const builds = pkg.pnpm?.onlyBuiltDependencies ?? [];
if (!Array.isArray(builds) || builds.length === 0) {
  console.warn(
    '[emit-prune-workspace-yaml] package.json has no pnpm.onlyBuiltDependencies — emitting empty allow-list.'
  );
}

const yaml = [
  'allowBuilds:',
  ...builds.map((p) => `  '${p}': true`),
  '',
  'onlyBuiltDependencies:',
  ...builds.map((p) => `  - '${p}'`),
  '',
].join('\n');

const out = resolve(apiRoot, 'dist/pnpm-workspace.yaml');
writeFileSync(out, yaml);
console.log(
  `[emit-prune-workspace-yaml] wrote ${out} (${builds.length} pkg(s))`
);
