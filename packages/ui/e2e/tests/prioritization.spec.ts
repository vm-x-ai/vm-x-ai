import { test, expect } from '../fixtures/auth';
import { ensureWorkspaceAndEnvironment } from '../fixtures/workspace';

test.describe('Prioritization (pool definitions)', () => {
  test('renders the table with the Add Pool action and headers', async ({
    authenticatedPage: page,
  }) => {
    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );
    await page.goto(
      `/workspaces/${workspaceId}/${environmentId}/prioritization`
    );

    await expect(page.getByRole('button', { name: 'Add Pool' })).toBeVisible({
      timeout: 15_000,
    });
    // Column headers — pool name, min/max reservation, resources.
    await expect(
      page.getByRole('columnheader', { name: 'Pool Name' })
    ).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: 'Min (%)' })
    ).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: 'Max (%)' })
    ).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: 'Resources' })
    ).toBeVisible();
  });

  test('clicking Add Pool reveals an inline create row', async ({
    authenticatedPage: page,
  }) => {
    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );
    await page.goto(
      `/workspaces/${workspaceId}/${environmentId}/prioritization`
    );

    await page
      .getByRole('button', { name: 'Add Pool' })
      .click({ timeout: 15_000 });
    // MRT renders the inline create row with a "Pool Name" textbox.
    await expect(
      page.getByRole('textbox', { name: 'Pool Name' })
    ).toBeVisible();
  });
});
