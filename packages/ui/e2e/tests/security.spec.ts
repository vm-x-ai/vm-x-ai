import { test, expect } from '../fixtures/auth';
import { ensureWorkspaceAndEnvironment } from '../fixtures/workspace';
import { createApiKeyViaUI } from '../fixtures/api-key';

/**
 * Security tab — environment-scoped API keys (a.k.a. roles in the URL)
 * and the create form. The getting-started flow auto-generates a
 * "Default" key, so the overview list is never empty in this suite.
 */
test.describe('Security / API keys', () => {
  test('overview lists the auto-generated Default API key + Add Role CTA', async ({
    authenticatedPage: page,
  }) => {
    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );
    await page.goto(
      `/workspaces/${workspaceId}/${environmentId}/security/auth/role/overview`
    );

    await expect(page.getByRole('link', { name: 'Add Role' })).toBeVisible({
      timeout: 15_000,
    });
    // The masked-key column header — confirms the table rendered (we
    // don't assert on a specific row because the seed admin may have
    // accumulated multiple keys across e2e runs).
    await expect(
      page.getByRole('columnheader', { name: /API Key/ })
    ).toBeVisible();
  });

  test('create role form renders required fields', async ({
    authenticatedPage: page,
  }) => {
    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );
    await page.goto(
      `/workspaces/${workspaceId}/${environmentId}/security/auth/role/new`
    );

    await expect(
      page.getByRole('textbox', { name: 'Role Name' })
    ).toBeVisible();
    await expect(
      page.getByRole('textbox', { name: 'Description' })
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
  });

  test('create + delete API key roundtrip', async ({
    authenticatedPage: page,
  }) => {
    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );

    // Create via the UI flow — capture the secret value (also exercised
    // by the live spec).
    const name = `e2e-key-${Date.now()}`;
    const { apiKeyValue } = await createApiKeyViaUI(
      page,
      workspaceId,
      environmentId,
      name
    );
    expect(apiKeyValue.length).toBeGreaterThanOrEqual(32);

    // Now delete it from the overview list. The row's Delete IconButton
    // opens a ConfirmDeleteAPIKeyDialog.
    await page.goto(
      `/workspaces/${workspaceId}/${environmentId}/security/auth/role/overview`
    );
    const row = page.getByRole('row').filter({
      has: page
        .getByRole('cell', { name, exact: true })
        .or(page.getByRole('link', { name, exact: true })),
    });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole('button', { name: 'Delete' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete' }).click();

    // Row should disappear from the table.
    await expect(page.getByRole('cell', { name, exact: true })).toHaveCount(0, {
      timeout: 15_000,
    });
  });
});
