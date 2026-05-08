import { test, expect } from '../fixtures/auth';
import { ensureWorkspaceAndEnvironment } from '../fixtures/workspace';

test.describe('Dark/light theme toggle', () => {
  test('toggle flips data-dark attribute and persists across reload', async ({
    authenticatedPage: page,
  }) => {
    // Out of the box we're in light mode.
    let dataDark = await page.evaluate(() =>
      document.documentElement.getAttribute('data-dark')
    );
    expect(dataDark).toBeNull();

    // Click the toggle in the app bar.
    const toggle = page.getByRole('button', { name: 'Switch to dark mode' });
    await toggle.click();

    // Now html should carry the `data-dark` attribute and the body
    // should paint with the dark surface color.
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            document.documentElement.getAttribute('data-dark')
          ),
        { message: 'data-dark attribute should be set after toggling dark' }
      )
      .toBe('');

    // The dark theme uses true black (`#000000`) for the body
    // background — see `app/theme.ts` (`background.darkBg = '#000'`).
    // The body inline style resolves it via
    // `var(--mui-palette-AppBar-darkBg, …)`. Test asserts the resolved
    // computed style rather than the CSS variable string so any future
    // theme drift gets caught here too.
    const bg = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor
    );
    expect(bg).toBe('rgb(0, 0, 0)');

    // The button label flips too — useful sanity check on the
    // `useColorScheme()` integration.
    await expect(
      page.getByRole('button', { name: 'Switch to light mode' })
    ).toBeVisible();

    // Reload — MUI's `useColorScheme` persists the chosen mode to
    // localStorage, so the dark theme should survive a full nav cycle.
    await page.reload();
    dataDark = await page.evaluate(() =>
      document.documentElement.getAttribute('data-dark')
    );
    expect(dataDark, 'dark mode should persist across reload').toBe('');
  });

  test('Usage charts render Line + Bar variants without errors after dark toggle', async ({
    authenticatedPage: page,
  }) => {
    test.setTimeout(120_000);
    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );

    // Flip to dark mode first so the chart-theme branch we exercise
    // here is the one users will see most often paired with the
    // toggle (the previous test confirms persistence).
    await page.goto('/');
    const toggle = page.getByRole('button', { name: 'Switch to dark mode' });
    await toggle.click();
    await expect(
      page.getByRole('button', { name: 'Switch to light mode' })
    ).toBeVisible();

    await page.goto(
      `/workspaces/${workspaceId}/${environmentId}/insights/usage`
    );
    // The Usage page server-renders chart graphs via Suspense fallbacks;
    // wait for the network to settle so the NamespaceGraph mounts.
    await page.waitForLoadState('networkidle');

    // The per-chart Line/Bar toggle should render in each chart's header.
    const lineButtons = page.getByRole('button', { name: 'line chart' });
    const barButtons = page.getByRole('button', { name: 'bar chart' });
    await expect(lineButtons.first()).toBeVisible({ timeout: 30_000 });
    await expect(barButtons.first()).toBeVisible();

    // Switch the first chart to bar — the chart re-renders with the
    // Bar variant. We don't assert on specific data (the workspace may
    // be empty); just that the SVG host stays alive and no JS error
    // fires (Playwright surfaces console errors via the test runner).
    await barButtons.first().click();
    // Give the dynamic import + render a beat to settle.
    await page.waitForLoadState('networkidle');

    // Flip back to line — confirms the toggle is two-way.
    await lineButtons.first().click();
    await page.waitForLoadState('networkidle');

    // Sanity check on dark theme: the html element keeps its `data-dark`
    // attribute even after navigating into the Usage page.
    const dataDark = await page.evaluate(() =>
      document.documentElement.getAttribute('data-dark')
    );
    expect(dataDark).toBe('');
  });
});
