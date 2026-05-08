import path from 'node:path';
import { test, expect } from '../fixtures/auth';
import { ensureWorkspaceAndEnvironment } from '../fixtures/workspace';
import { hasLiveKeys, liveEnv } from '../fixtures/live';
import { chatCompletion } from '../fixtures/gateway';

/**
 * Screenshot pass — drives every major page in the UI and writes a
 * full-page PNG to `/tmp/ui-screenshots/`. Run only on demand:
 *
 *   pnpm exec nx run ui:e2e -- screenshots
 *
 * Filenames are stable per-shot (no timestamps) so the snapshot
 * captures the *current* state of each page after this run completes.
 * Useful for visual reviews after a UI refactor.
 *
 * The "with-data" branch (live audit row, playground messages) requires
 * `OPENAI_API_KEY` in `.env.local`; without it those steps are skipped.
 */

const OUTPUT_DIR = process.env.UI_SCREENSHOTS_DIR ?? '/tmp/ui-screenshots';
const HAS_OPENAI = hasLiveKeys('OPENAI_API_KEY');
const TEST_TIMEOUT = 600_000;

// `test.setTimeout` inside the test body only governs the test
// body, not its fixtures — the auth fixture's login flow can stall
// past the default 30s when the dev server is still cold-compiling
// pages on first hit. Bumping the timeout at the describe level
// covers both fixture setup and test execution.
test.describe.configure({ timeout: 600_000 });

test.describe.serial('UI screenshots', () => {
  test('static pages — overview + create + edit', async ({
    authenticatedPage: page,
  }) => {
    test.setTimeout(TEST_TIMEOUT);

    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );

    // Viewport-only screenshots cap at 1280x900 so each image stays
    // well under the 2000px many-image limit. We keep `fullPage: false`
    // so long pages (Usage dashboard) don't blow past the limit either.
    await page.setViewportSize({ width: 1280, height: 900 });

    const shot = async (name: string) => {
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(800);
      await page.screenshot({
        path: path.join(OUTPUT_DIR, `${name}.png`),
        fullPage: false,
      });
    };

    const visit = async (slug: string, name: string) => {
      await page.goto(slug);
      await shot(name);
    };

    // ────────── Overview / shell pages ──────────
    await visit('/workspaces', '01-workspaces');
    await visit(`/workspaces/${workspaceId}/edit`, '02a-workspace-edit');
    await visit(
      `/workspaces/${workspaceId}/${environmentId}/edit`,
      '02b-environment-edit'
    );

    // ────────── AI Connections ──────────
    await visit(
      `/workspaces/${workspaceId}/${environmentId}/ai-connections/overview`,
      '03-ai-connections-overview'
    );
    await visit(
      `/workspaces/${workspaceId}/${environmentId}/ai-connections/new`,
      '04-ai-connections-new-quick'
    );
    await page
      .getByRole('button', { name: 'Advanced Add' })
      .click()
      .catch(() => undefined);
    await shot('05-ai-connections-new-advanced');

    // ────────── AI Resources (overview + create) ──────────
    await visit(
      `/workspaces/${workspaceId}/${environmentId}/ai-resources/overview`,
      '06-ai-resources-overview'
    );
    await visit(
      `/workspaces/${workspaceId}/${environmentId}/ai-resources/new`,
      '07-ai-resources-new'
    );

    // ────────── Other pages ──────────
    await visit(
      `/workspaces/${workspaceId}/${environmentId}/playground`,
      '10-playground-empty'
    );
    await visit(
      `/workspaces/${workspaceId}/${environmentId}/insights/audit`,
      '11-insights-audit-empty'
    );
    await visit(
      `/workspaces/${workspaceId}/${environmentId}/insights/usage`,
      '12-insights-usage-empty'
    );
    await visit(
      `/workspaces/${workspaceId}/${environmentId}/prioritization`,
      '14-prioritization'
    );
    await visit(`/workspaces/${workspaceId}/${environmentId}/sdk`, '15-sdk');
    await visit(
      `/workspaces/${workspaceId}/${environmentId}/security/auth/role/overview`,
      '16-security-auth-role-overview'
    );
    await visit(
      `/workspaces/${workspaceId}/${environmentId}/security/auth/role/new`,
      '17-security-auth-role-new'
    );

    // ────────── Settings (root + nested) ──────────
    await visit('/settings', '18-settings');
    await visit('/settings/pricing', '19-settings-pricing');

    expect(true).toBe(true);
  });

  test('dark mode — sample of pages with mode flipped', async ({
    authenticatedPage: page,
  }) => {
    test.setTimeout(TEST_TIMEOUT);

    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );

    await page.setViewportSize({ width: 1280, height: 900 });

    // Force dark mode by writing the storage key MUI's
    // `InitColorSchemeScript` reads from before any page renders.
    // Goes through the same path as the user clicking the theme
    // toggle, so the captured screens reflect production behaviour.
    // Passed as a source string rather than a function literal so the
    // e2e tsconfig (which excludes the DOM lib) doesn't flag
    // `localStorage`. The script runs in the page context.
    await page.addInitScript(
      "try { localStorage.setItem('mui-mode', 'dark'); } catch (_) {}"
    );

    const shot = async (name: string) => {
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(800);
      await page.screenshot({
        path: path.join(OUTPUT_DIR, `dark-${name}.png`),
        fullPage: false,
      });
    };

    const visit = async (slug: string, name: string) => {
      await page.goto(slug);
      await shot(name);
    };

    // Cover one screen from each major surface area so we can spot
    // any palette regression that only manifests in dark mode (text
    // contrast on muted surfaces, hairline borders disappearing, the
    // primary-blue still readable on near-black backgrounds, etc).
    await visit('/workspaces', '01-workspaces');
    await visit(
      `/workspaces/${workspaceId}/${environmentId}/ai-connections/overview`,
      '03-ai-connections-overview'
    );
    await visit(
      `/workspaces/${workspaceId}/${environmentId}/ai-connections/new`,
      '04-ai-connections-new-quick'
    );
    await visit(
      `/workspaces/${workspaceId}/${environmentId}/playground`,
      '10-playground-empty'
    );
    await visit(
      `/workspaces/${workspaceId}/${environmentId}/insights/audit`,
      '11-insights-audit'
    );
    await visit(
      `/workspaces/${workspaceId}/${environmentId}/insights/usage`,
      '12-insights-usage'
    );
    await visit(`/workspaces/${workspaceId}/${environmentId}/sdk`, '15-sdk');
    await visit('/settings/pricing', '19-settings-pricing');

    expect(true).toBe(true);
  });

  test('edit pages — connection + resource (sub-tabs) + role', async ({
    authenticatedPage: page,
  }) => {
    test.setTimeout(TEST_TIMEOUT);

    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );

    await page.setViewportSize({ width: 1280, height: 900 });

    const shot = async (name: string) => {
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(800);
      await page.screenshot({
        path: path.join(OUTPUT_DIR, `${name}.png`),
        fullPage: false,
      });
    };

    // Spin up a fresh OpenAI connection (real key when available — keeps
    // the same fixture viable for the chat-with-messages test below).
    const connName = `e2e-shot-${Date.now()}`;
    const resourceName = `${connName}-default`;

    await page.goto(
      `/workspaces/${workspaceId}/${environmentId}/ai-connections/new`
    );
    await page.getByRole('button', { name: 'Advanced Add' }).click();
    await page.getByRole('textbox', { name: 'Connection Name' }).fill(connName);
    const apiKey = HAS_OPENAI
      ? liveEnv('OPENAI_API_KEY')
      : 'sk-fake-placeholder-only';
    await page.getByLabel('OpenAI API Key').fill(apiKey);
    await page.getByRole('button', { name: 'Save' }).click();

    await page
      .getByRole('heading', { name: 'Quick Create Result' })
      .waitFor({ timeout: 30_000 });
    const resourceLink = page.getByRole('link', { name: resourceName });
    const resourceHref = await resourceLink.getAttribute('href');
    const resourceMatch = resourceHref?.match(/\/ai-resources\/edit\/([^/]+)/);
    const resourceId = resourceMatch?.[1] ?? '';
    const connectionLink = page.getByRole('link', {
      name: connName,
      exact: true,
    });
    const connectionHref = await connectionLink.getAttribute('href');
    const connectionMatch = connectionHref?.match(
      /\/ai-connections\/edit\/([^/]+)/
    );
    const connectionId = connectionMatch?.[1] ?? '';
    await page.getByRole('button', { name: 'Dismiss' }).click();

    // ────────── Connection edit ──────────
    await page.goto(
      `/workspaces/${workspaceId}/${environmentId}/ai-connections/edit/${connectionId}/general`
    );
    await shot('21-ai-connection-edit-general');

    // ────────── Resource edit — sub-tabs ──────────
    const resourceTabs = ['general', 'routing', 'fallback', 'capacity'];
    for (let i = 0; i < resourceTabs.length; i++) {
      const tab = resourceTabs[i];
      await page.goto(
        `/workspaces/${workspaceId}/${environmentId}/ai-resources/edit/${resourceId}/${tab}`
      );
      await shot(`22${String.fromCharCode(97 + i)}-ai-resource-edit-${tab}`);
    }

    // ────────── Role edit (default role) ──────────
    await page.goto(
      `/workspaces/${workspaceId}/${environmentId}/security/auth/role/overview`
    );
    // Click the first role's edit button to deep-link into its general tab.
    const roleLink = page.getByRole('link', { name: /default/i }).first();
    if (await roleLink.isVisible().catch(() => false)) {
      await roleLink.click();
      await shot('23-role-edit-general');
      // Capacity sub-tab.
      const capacityTab = page.getByRole('tab', { name: /capacity/i });
      if (await capacityTab.isVisible().catch(() => false)) {
        await capacityTab.click();
        await shot('24-role-edit-capacity');
      }
    }

    expect(true).toBe(true);
  });

  test('with-data — playground + audit drawer + metadata filter', async ({
    authenticatedPage: page,
  }) => {
    // Per-test skip — at describe scope this would skip the static /
    // edit / dark-mode tests above too, which don't need the OpenAI
    // key.
    test.skip(
      !HAS_OPENAI,
      'OPENAI_API_KEY not set — skipping live screenshots'
    );
    test.setTimeout(TEST_TIMEOUT);

    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );

    await page.setViewportSize({ width: 1280, height: 900 });

    const shot = async (name: string) => {
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(800);
      await page.screenshot({
        path: path.join(OUTPUT_DIR, `${name}.png`),
        fullPage: false,
      });
    };

    // The previous test created `e2e-shot-*-default`. Pick the most
    // recent one for live calls — fresh in case the ordering changes
    // we re-resolve from the resources list.
    await page.goto(
      `/workspaces/${workspaceId}/${environmentId}/ai-resources/overview`
    );
    const firstResourceCell = page
      .getByRole('cell', { name: /e2e-shot-.*-default/ })
      .first();
    await firstResourceCell.waitFor({ timeout: 15_000 });
    const resourceName = (await firstResourceCell.textContent())?.trim() ?? '';

    // ────────── Drive an audit row via the test BFF ──────────
    const correlationId = `corr-shots-${Date.now()}`;
    const metadataKey = 'team';
    const metadataValue = `shots-${Date.now()}`;
    const completion = await chatCompletion(page.request, {
      resourceName,
      workspaceId,
      environmentId,
      messages: [{ role: 'user', content: 'Reply with just "ok".' }],
      correlationId,
      metadata: { [metadataKey]: metadataValue, env: 'shots' },
    });
    expect(completion.status).toBe(200);

    // Audit writes are flushed every 10s; pause so the row is committed
    // before we screenshot the table.
    await page.waitForTimeout(13_000);

    // ────────── Audit page (with row + drawer) ──────────
    // SSR can race the cron flush — `page.goto` returns the snapshot
    // taken before the row is committed. Mirror live-openai step 6:
    // poll with a reload until the 200 cell appears.
    await page.goto(
      `/workspaces/${workspaceId}/${environmentId}/insights/audit`
    );
    const cell200 = page.getByRole('cell', { name: /200/ }).first();
    for (let attempt = 0; attempt < 6; attempt++) {
      if (await cell200.isVisible().catch(() => false)) break;
      await page.waitForTimeout(5_000);
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
    }
    await cell200.waitFor({ timeout: 15_000 });
    await shot('30-insights-audit-with-row');

    // Click into the first row to open the detail drawer.
    await page
      .getByRole('row')
      .filter({ has: page.getByRole('cell', { name: /200/ }) })
      .first()
      .click();
    // The drawer renders the request/response payloads (Phase 11
    // received vs provider-side). Give it a moment to mount.
    await page.waitForTimeout(1500);
    await shot('31-insights-audit-drawer');

    // Close the drawer for the next shot.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // ────────── Audit + metadata filter applied ──────────
    await page.getByRole('combobox', { name: 'Filter By Metadata' }).click();
    await page
      .getByRole('combobox', { name: 'Filter By Metadata' })
      .fill(metadataKey);
    await page.keyboard.press('Enter');
    // The value picker only renders after a key is selected; its
    // accessible name comes from the dynamic label
    // `Values for metadata.<key>`.
    await page
      .getByRole('combobox', { name: `Values for metadata.${metadataKey}` })
      .fill(metadataValue);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);
    await shot('32-insights-audit-with-metadata-filter');

    // ────────── Playground — empty, then send messages ──────────
    // The original deep-link attempt accidentally used the resource
    // *name* (cell text) as `?resourceId=`, which the playground
    // ignores. Just visit the bare playground; the autocomplete
    // defaults to the first available resource in the dropdown.
    await page.goto(`/workspaces/${workspaceId}/${environmentId}/playground`);
    await page.waitForTimeout(1500);
    await shot('40-playground-resource-mode');

    // Send the first message.
    const chatInput = page.getByPlaceholder(
      'Type a message... (Press Shift + Enter to break line)'
    );
    if (await chatInput.isVisible().catch(() => false)) {
      await chatInput.fill('Reply with the single word "hi".');
      await page.getByRole('button', { name: 'Send' }).click();
      // Wait for assistant text to start arriving.
      await page.waitForTimeout(8000);
      await shot('41-playground-one-message');

      // Send a follow-up message.
      await chatInput.fill('Now reply with the single word "bye".');
      await page.getByRole('button', { name: 'Send' }).click();
      await page.waitForTimeout(8000);
      await shot('42-playground-multiple-messages');
    }

    expect(true).toBe(true);
  });
});
