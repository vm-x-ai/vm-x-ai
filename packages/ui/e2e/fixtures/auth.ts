import { test as base, expect, type Page } from '@playwright/test';

/**
 * Shared auth fixture for the e2e suite.
 *
 * The VM-X dashboard sits behind OIDC auth. Out of the box, migration
 * `1-create-users.ts` seeds an admin (`admin@example.com` / `admin`) in
 * the `CHANGE_PASSWORD` state. The first login forces a password change;
 * we accept that flow once and then reuse a saved storage state across
 * tests so each spec starts logged in.
 *
 * Override credentials via env if your local stack differs:
 *   E2E_USER_EMAIL, E2E_USER_PASSWORD, E2E_NEW_PASSWORD.
 */
export const SEED_EMAIL = process.env.E2E_USER_EMAIL ?? 'admin@example.com';
export const SEED_INITIAL_PASSWORD = process.env.E2E_USER_PASSWORD ?? 'admin';
export const SEED_NEW_PASSWORD = process.env.E2E_NEW_PASSWORD ?? 'Admin1234!';

/**
 * Drives the OIDC login flow on the given page. Idempotent: if the user
 * is already past the change-password step, the second login call will
 * be accepted with `SEED_NEW_PASSWORD`.
 */
export async function login(page: Page): Promise<void> {
  await page.goto('/');

  // The dashboard redirects unauthenticated traffic to /api/signin →
  // OIDC interaction page on the API side. We land on the username form.
  await page.waitForURL(/\/api\/interaction\//);

  // Try the new password first (case where the seed admin has already
  // gone through the CHANGE_PASSWORD step on a previous run).
  await page
    .getByRole('textbox', { name: 'Username or Email' })
    .fill(SEED_EMAIL);
  await page.getByRole('textbox', { name: 'Password' }).fill(SEED_NEW_PASSWORD);
  await page.getByRole('button', { name: 'Login' }).click();

  // If the new password didn't take, retry with the seed initial password
  // and walk through the change-password flow.
  const changePasswordVisible = await page
    .getByRole('button', { name: 'Change Password' })
    .isVisible()
    .catch(() => false);
  const stillOnLogin = await page
    .getByRole('textbox', { name: 'Username or Email' })
    .isVisible()
    .catch(() => false);

  if (stillOnLogin) {
    await page
      .getByRole('textbox', { name: 'Username or Email' })
      .fill(SEED_EMAIL);
    await page
      .getByRole('textbox', { name: 'Password' })
      .fill(SEED_INITIAL_PASSWORD);
    await page.getByRole('button', { name: 'Login' }).click();
  }

  if (
    changePasswordVisible ||
    (await page
      .getByRole('button', { name: 'Change Password' })
      .isVisible()
      .catch(() => false))
  ) {
    await page
      .getByRole('textbox', { name: 'New Password' })
      .fill(SEED_NEW_PASSWORD);
    await page
      .getByRole('textbox', { name: 'Confirm Password' })
      .fill(SEED_NEW_PASSWORD);
    await page.getByRole('button', { name: 'Change Password' }).click();
  }

  // OIDC consent screen — auto-accepted clients skip this entirely. When
  // it shows up we click Allow.
  const allowVisible = await page
    .getByRole('button', { name: 'Allow' })
    .isVisible({ timeout: 5_000 })
    .catch(() => false);
  if (allowVisible) {
    await page.getByRole('button', { name: 'Allow' }).click();
  }

  // We should land back on the UI, post-redirect. The home redirect bounces
  // to /getting-started for accounts with no workspaces, or /workspaces for
  // those that do. Either is a successful login signal.
  await page.waitForURL(/\/(getting-started|workspaces)/);
  await expect(page).toHaveTitle(/VM-X AI Console/);
}

/**
 * Test fixture that ensures the page is authenticated before the test body
 * runs. Use in specs as:
 *
 *   import { test, expect } from '../fixtures/auth';
 *   test('something', async ({ authenticatedPage: page }) => { ... });
 */
export const test = base.extend<{ authenticatedPage: Page }>({
  authenticatedPage: async ({ page }, use) => {
    await login(page);
    await use(page);
  },
});

export { expect };
