import { test, expect } from '../fixtures/auth';

/**
 * Account-level settings — Roles + User Management. These are owner-only
 * pages reachable from the sidebar. The seed admin always sees themself
 * here, plus any rows they create.
 */
test.describe('Settings — Roles', () => {
  test('lists existing roles and exposes Add new Role', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/settings/roles');
    await expect(
      page.getByRole('link', { name: 'Add new Role' })
    ).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: 'Role Name' })
    ).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: 'Members' })
    ).toBeVisible();
  });

  test('Add new Role navigates to the create form', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/settings/roles');
    await page.getByRole('link', { name: 'Add new Role' }).click();
    await page.waitForURL(/\/settings\/roles\/new/);

    await expect(
      page.getByRole('textbox', { name: 'Role Name' })
    ).toBeVisible();
    await expect(
      page.getByRole('textbox', { name: 'Description' })
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
  });
});

test.describe('Settings — Roles CRUD', () => {
  test('create + delete role roundtrip', async ({
    authenticatedPage: page,
  }) => {
    const name = `e2e-role-${Date.now()}`;

    await page.goto('/settings/roles/new');
    await page.getByRole('textbox', { name: 'Role Name' }).fill(name);
    await page.getByRole('textbox', { name: 'Description' }).fill('e2e role');
    await page.getByRole('button', { name: 'Save' }).click();

    // After save the form redirects to the edit page; navigate back to
    // the list to assert the row is there.
    await page.goto('/settings/roles');
    const row = page.getByRole('row').filter({
      has: page.getByRole('cell', { name, exact: true }),
    });
    await expect(row).toBeVisible({ timeout: 15_000 });

    // Delete via the row's red Delete IconButton.
    await row.getByRole('button', { name: 'Delete' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByRole('cell', { name, exact: true })).toHaveCount(0, {
      timeout: 15_000,
    });
  });
});

test.describe('Settings — Users', () => {
  test('lists existing users including the seed admin', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/settings/users');
    await expect(
      page.getByRole('link', { name: 'Add new User' })
    ).toBeVisible();
    // Seed admin email comes from migration 1. Target the Email-column
    // `<td>` specifically; a plain `getByText` collides with the
    // "Admin (admin@example.com)" labels other workspace/environment
    // tables print in their Created By columns once the test DB has
    // any history.
    await expect(
      page.getByRole('cell', { name: 'admin@example.com', exact: true })
    ).toBeVisible();
  });

  test('Add new User navigates to the create form with all required fields', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/settings/users');
    await page.getByRole('link', { name: 'Add new User' }).click();
    await page.waitForURL(/\/settings\/users\/new/);

    await expect(
      page.getByRole('textbox', { name: 'First Name' })
    ).toBeVisible();
    await expect(
      page.getByRole('textbox', { name: 'Last Name' })
    ).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Email' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
  });
});
