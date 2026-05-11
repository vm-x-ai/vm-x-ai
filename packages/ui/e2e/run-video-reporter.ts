import type { Reporter } from '@playwright/test/reporter';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Custom reporter that produces a single consolidated `run.webm` and
 * surfaces it inside the Playwright HTML report.
 *
 * Why a reporter (and not `globalTeardown`):
 * Playwright runs `globalTeardown` *before* the built-in HTML reporter
 * writes its bundle, so anything teardown drops into `playwright-report/`
 * is overwritten/missed. Reporters' `onEnd` hook fires after the run is
 * fully accounted for, and Playwright invokes them in the order listed
 * in `reporter:` — declaring this one *after* `['html', ...]` guarantees
 * the report exists by the time we patch it.
 */
export default class RunVideoReporter implements Reporter {
  async onEnd(): Promise<void> {
    if (process.env.PWVIDEO === 'off') return;

    const outputRoot = path.resolve(__dirname, '../test-output/playwright');
    const clipsRoot = path.resolve(outputRoot, 'output');
    const reportRoot = path.resolve(__dirname, '../playwright-report');
    if (!fs.existsSync(clipsRoot)) return;

    const clips = collectClips(clipsRoot).sort();
    if (clips.length === 0) return;

    if (!hasFfmpeg()) {
      console.warn(
        '[e2e run-video] ffmpeg not found — skipping consolidated video. Per-test clips remain under test-output/playwright/output/.'
      );
      return;
    }

    const listFile = path.resolve(outputRoot, 'concat-list.txt');
    fs.writeFileSync(
      listFile,
      clips.map((c) => `file '${c.replace(/'/g, "'\\''")}'`).join('\n'),
      'utf8'
    );

    const outFile = path.resolve(outputRoot, 'run.webm');
    const result = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-loglevel',
        'error',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        listFile,
        '-c',
        'copy',
        outFile,
      ],
      { encoding: 'utf8' }
    );

    if (result.status !== 0) {
      console.warn(
        '[e2e run-video] ffmpeg concat failed — see stderr below. Per-test clips remain available.\n',
        result.stderr
      );
      return;
    }

    console.log(
      `[e2e run-video] consolidated ${clips.length} clip(s) → ${path.relative(
        process.cwd(),
        outFile
      )}`
    );

    if (fs.existsSync(reportRoot)) {
      fs.copyFileSync(outFile, path.resolve(reportRoot, 'run.webm'));
      injectBanner(reportRoot, clips.length);
    }
  }
}

/**
 * Inject a sticky top banner above the report content with a link to
 * the consolidated run video. We touch the file as little as possible —
 * one `<div>` after `<body>` plus a tiny inline stylesheet.
 */
function injectBanner(reportRoot: string, clipCount: number): void {
  const indexFile = path.resolve(reportRoot, 'index.html');
  if (!fs.existsSync(indexFile)) return;

  const html = fs.readFileSync(indexFile, 'utf8');
  // Idempotent — bail if we've already injected on a previous teardown
  // (e.g. running the reporter twice during local debugging).
  if (html.includes('id="vmx-run-video-banner"')) return;

  const banner = `
<style>
  #vmx-run-video-banner {
    position: sticky; top: 0; z-index: 9999;
    background: #1976d2; color: #fff;
    padding: .5rem 1rem; font: 14px system-ui, sans-serif;
    box-shadow: 0 1px 2px rgba(0,0,0,.2);
  }
  #vmx-run-video-banner a { color: #fff; text-decoration: underline; }
  #vmx-run-video-banner summary { cursor: pointer; user-select: none; }
  #vmx-run-video-banner video {
    width: 100%; max-width: 960px; margin-top: .75rem; display: block;
  }
</style>
<div id="vmx-run-video-banner">
  📼 Consolidated run video — ${clipCount} clip(s) —
  <a href="./run.webm" download>download <code>run.webm</code></a>
  <details>
    <summary style="display:inline">▸ inline preview</summary>
    <video src="./run.webm" controls preload="metadata"></video>
  </details>
</div>
`;

  const next = html.replace('<body>', `<body>\n${banner}`);
  fs.writeFileSync(indexFile, next, 'utf8');
}

function collectClips(root: string): string[] {
  const result: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name === 'video.webm') {
        result.push(full);
      }
    }
  }
  walk(root);
  return result;
}

function hasFfmpeg(): boolean {
  try {
    const r = spawnSync('ffmpeg', ['-version'], {
      stdio: 'ignore',
      timeout: 3_000,
    });
    return r.status === 0;
  } catch {
    return false;
  }
}
