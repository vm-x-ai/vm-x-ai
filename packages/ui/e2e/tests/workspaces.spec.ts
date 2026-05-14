import { test, expect } from '../fixtures/auth';
import {
  createWorkspace,
  ensureWorkspaceAndEnvironment,
} from '../fixtures/workspace';

/**
 * Workspaces / environments CRUD via the dashboard.
 *
 * The auth seed admin starts with no workspaces, so the first thing the
 * dashboard does is bounce them to /getting-started. The
 * `ensureWorkspaceAndEnvironment` helper walks that flow once and returns
 * the resulting IDs, which the rest of the suite relies on. We piggy-back
 * on it here for create-coverage and add explicit edit/list tests.
 */
test.describe('Workspaces & environments', () => {
  test('fixture resolves to a workspace + environment id pair', async ({
    authenticatedPage: page,
  }) => {
    // The fixture either picks the existing workspace's ids out of the
    // post-login redirect target, or — if the seed admin has none —
    // walks the getting-started form once. Either way we expect both
    // ids to be non-empty strings on return.
    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );
    expect(workspaceId).toBeTruthy();
    expect(environmentId).toBeTruthy();
  });

  test('workspaces list renders at least one workspace row + add CTA', async ({
    authenticatedPage: page,
  }) => {
    const { workspaceId } = await ensureWorkspaceAndEnvironment(page);
    await page.goto('/workspaces');

    // The fixture returns whichever workspace the seed admin already
    // has (or one it just created on the empty-DB path), so we can't
    // assert on a hard-coded row name. What we *can* assert is that
    // the resolved workspace's Edit link is in the table — every data
    // row exposes one with href `/workspaces/<id>/edit`.
    await expect(
      page.locator(`a[href="/workspaces/${workspaceId}/edit"]`)
    ).toBeVisible();
    // The toolbar exposes the "Add new Workspace" CTA (links to
    // /getting-started).
    await expect(
      page.getByRole('link', { name: 'Add new Workspace' })
    ).toBeVisible();
  });

  test('workspace edit page renders the form', async ({
    authenticatedPage: page,
  }) => {
    const { workspaceId } = await ensureWorkspaceAndEnvironment(page);
    await page.goto(`/workspaces/${workspaceId}/edit`);

    await expect(
      page.getByRole('heading', { name: 'Edit Workspace' })
    ).toBeVisible();
    // Don't assert on the value — multiple "my workspace" rows pile up
    // across e2e runs and the fixture may return any of them.
    await expect(
      page.getByRole('textbox', { name: 'Workspace Name' })
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
  });

  test('environment edit page renders the form', async ({
    authenticatedPage: page,
  }) => {
    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );
    await page.goto(`/workspaces/${workspaceId}/${environmentId}/edit`);

    await expect(
      page.getByRole('textbox', { name: 'Environment Name' })
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
  });

  test('delete workspace via the table row action', async ({
    authenticatedPage: page,
  }) => {
    // Create a unique throwaway workspace so we don't clobber the
    // shared one the rest of the suite uses.
    const name = `e2e-delete-${Date.now()}`;
    await createWorkspace(page, name);

    await page.goto('/workspaces');
    const row = page.getByRole('row').filter({
      has: page.getByRole('cell', { name, exact: true }),
    });
    await expect(row).toBeVisible({ timeout: 15_000 });

    // Each row has an Edit + Delete IconButton. The Delete button is
    // the only `color="error"` icon in the row.
    await row.getByRole('button', { name: 'Delete' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete' }).click();

    // Toast confirms, then the row vanishes from the table.
    await expect(page.getByRole('cell', { name, exact: true })).toHaveCount(0, {
      timeout: 15_000,
    });
  });
});
