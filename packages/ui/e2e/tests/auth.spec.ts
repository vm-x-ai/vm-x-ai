import { test, expect } from '../fixtures/auth';

test.describe('Authentication', () => {
  test('redirects unauthenticated traffic to the OIDC login screen', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForURL(/\/api\/interaction\//);
    await expect(
      page.getByRole('heading', { name: 'Welcome to VM-X AI' })
    ).toBeVisible();
    await expect(
      page.getByRole('textbox', { name: 'Username or Email' })
    ).toBeVisible();
  });

  test('seed admin can complete OIDC login and reach the dashboard', async ({
    authenticatedPage: page,
  }) => {
    // Reaching here means the auth fixture walked the login flow.
    // Just confirm we landed inside the dashboard shell.
    await expect(
      page.locator('button[aria-label="Account settings"]')
    ).toBeVisible();
  });
});
