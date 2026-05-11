import { test, expect } from '../fixtures/auth';
import { ensureWorkspaceAndEnvironment } from '../fixtures/workspace';

/**
 * Insights = Audit + Usage. These are the two highest-leverage pages for
 * the LiteLLM Gateway parity story (audit log w/ metadata filters,
 * cost/token/latency dashboards). We can't drive real traffic without a
 * working AI Connection, so the assertions concentrate on the controls
 * being present and the page layout being correct.
 */
test.describe('Insights — Audit', () => {
  test('renders the date range, resource, connection, status, metadata and group-by filters', async ({
    authenticatedPage: page,
  }) => {
    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );
    await page.goto(
      `/workspaces/${workspaceId}/${environmentId}/insights/audit`
    );

    // Date range editor is always rendered.
    await expect(
      page.getByRole('textbox', { name: 'Date Range' })
    ).toBeVisible();
    // The five autocomplete filters.
    await expect(
      page.getByRole('combobox', { name: 'AI Resource' })
    ).toBeVisible();
    await expect(
      page.getByRole('combobox', { name: 'AI Connection' })
    ).toBeVisible();
    await expect(
      page.getByRole('combobox', { name: 'Status Code' })
    ).toBeVisible();
    await expect(
      page.getByRole('combobox', { name: 'Filter By Metadata' })
    ).toBeVisible();
    // Note: the Metadata Value picker only renders after a key is
    // chosen. The screenshots spec exercises the key→value→Enter flow
    // end-to-end; here we only check the idle filter row.
    await expect(
      page.getByRole('combobox', { name: 'Group By' })
    ).toBeVisible();

    // We don't assert on emptiness — the live-openai spec drives real
    // chat traffic that lands in the audit table.
  });

  test('Status Code dropdown lists the canonical 200/400/401/429/500', async ({
    authenticatedPage: page,
  }) => {
    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );
    await page.goto(
      `/workspaces/${workspaceId}/${environmentId}/insights/audit`
    );

    await page.getByRole('combobox', { name: 'Status Code' }).click();
    for (const code of ['200', '400', '401', '429', '500']) {
      await expect(page.getByRole('option', { name: code })).toBeVisible();
    }
    await page.keyboard.press('Escape');
  });

  test('Group By options always include correlationId', async ({
    authenticatedPage: page,
  }) => {
    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );
    await page.goto(
      `/workspaces/${workspaceId}/${environmentId}/insights/audit`
    );

    await page.getByRole('combobox', { name: 'Group By' }).click();
    await expect(
      page.getByRole('option', { name: 'correlationId' })
    ).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('renders multi-pair metadata chips when metadataFilters is in the URL', async ({
    authenticatedPage: page,
  }) => {
    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );

    // Pre-load the audit page with two metadata filter pairs in the URL —
    // the multi-pair Header.tsx UI should pick them up and render two
    // remove-chips. This validates the URL → UI direction without
    // depending on live audit data.
    const filters = encodeURIComponent(
      JSON.stringify({ team: 'growth', env: 'prod' })
    );
    await page.goto(
      `/workspaces/${workspaceId}/${environmentId}/insights/audit?metadataFilters=${filters}`
    );

    await expect(
      page.getByRole('button', {
        name: 'Remove metadata filter team=growth',
        exact: true,
      })
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole('button', {
        name: 'Remove metadata filter env=prod',
        exact: true,
      })
    ).toBeVisible();

    // Clicking a chip removes that pair (and preserves the other one).
    await page
      .getByRole('button', {
        name: 'Remove metadata filter env=prod',
        exact: true,
      })
      .click();
    await expect(
      page.getByRole('button', {
        name: 'Remove metadata filter env=prod',
        exact: true,
      })
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', {
        name: 'Remove metadata filter team=growth',
        exact: true,
      })
    ).toBeVisible();
  });
});

test.describe('Insights — Usage', () => {
  test('renders Cost section above Token Usage with correct legend', async ({
    authenticatedPage: page,
  }) => {
    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );
    await page.goto(
      `/workspaces/${workspaceId}/${environmentId}/insights/usage`
    );

    const costHeader = page.getByRole('heading', { name: 'Cost', exact: true });
    const tokenHeader = page.getByRole('heading', { name: 'Token Usage' });
    await expect(costHeader).toBeVisible();
    await expect(tokenHeader).toBeVisible();

    // Cost should appear above Token Usage.
    const costBox = await costHeader.boundingBox();
    const tokenBox = await tokenHeader.boundingBox();
    expect(costBox && tokenBox && costBox.y < tokenBox.y).toBe(true);

    // Cost legend uses the new CURRENCY MetricFormat.
    await expect(page.getByText('cost (USD)')).toBeVisible();
  });

  test('header exposes filter, group-by metadata, and granularity controls', async ({
    authenticatedPage: page,
  }) => {
    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );
    await page.goto(
      `/workspaces/${workspaceId}/${environmentId}/insights/usage`
    );

    // Filter widgets defined in Usage/Header.tsx. "Filter By Role" is
    // an Autocomplete that surfaces *both* `Filter By Role` and
    // `Filter By Role Groups` to the same accessible name root, so we
    // disambiguate with `exact: true`.
    await expect(
      page.getByRole('combobox', { name: 'Filter By Role', exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('combobox', { name: 'Filter By Role Groups' })
    ).toBeVisible();
    // Filter By / Group By Metadata only render once at least one
    // metadata key has been observed (the dropdown is gated on the
    // /metadata-keys API). The empty-workspace assertion stops at the
    // role filters; the metadata pair is exercised by the Audit spec
    // which uses freeSolo and renders unconditionally.

    // Granularity ToggleButtonGroup — match by aria-label on the wrapper.
    await expect(
      page.getByRole('group', { name: 'Granularity' })
    ).toBeVisible();
  });

  test('each chart card has a Line/Bar toggle and switching survives a render cycle', async ({
    authenticatedPage: page,
  }) => {
    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );
    await page.goto(
      `/workspaces/${workspaceId}/${environmentId}/insights/usage`
    );
    await page.waitForLoadState('networkidle');

    // The toggle is rendered above every NamespaceGraph regardless of
    // whether there's data, so the assertion holds on a fresh workspace.
    const lineButtons = page.getByRole('button', { name: 'line chart' });
    const barButtons = page.getByRole('button', { name: 'bar chart' });
    await expect(lineButtons.first()).toBeVisible({ timeout: 15_000 });
    await expect(barButtons.first()).toBeVisible();

    // The toggle starts on Line (default). Flipping to Bar marks the
    // bar button as pressed.
    await barButtons.first().click();
    await expect(barButtons.first()).toHaveAttribute('aria-pressed', 'true', {
      timeout: 5_000,
    });

    // Flip back — the line button is now pressed.
    await lineButtons.first().click();
    await expect(lineButtons.first()).toHaveAttribute('aria-pressed', 'true');
  });

  test('renders the four standard sections: cost, tokens, requests, latency', async ({
    authenticatedPage: page,
  }) => {
    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );
    await page.goto(
      `/workspaces/${workspaceId}/${environmentId}/insights/usage`
    );

    // Each section name appears as an h6 heading produced by LLMUsage.
    // Just guard that none of them got dropped after the recent reshuffle.
    await expect(
      page.getByRole('heading', { name: 'Cost', exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Token Usage' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Request details' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Request Latency', exact: true })
    ).toBeVisible();
  });
});
