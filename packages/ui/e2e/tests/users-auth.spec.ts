import { test, expect, type Browser } from '@playwright/test';
import { test as authedTest } from '../fixtures/auth';

/**
 * Create-user-then-authenticate flows. Two variants:
 *
 *   1. **Require password change OFF** — admin creates the user with the
 *      "Require password change on next login" checkbox unchecked. The
 *      created user authenticates directly with the initial password.
 *
 *   2. **Require password change ON** (default in the form) — admin
 *      creates the user, leaves the checkbox checked. The new user
 *      authenticates with the initial password and is forced through
 *      the OIDC `change-password` interaction before reaching the
 *      console.
 *
 * Both variants reuse the seed admin's authenticated session for the
 * create step and a fresh isolated browser context for the new user's
 * login (so cookies don't bleed between identities).
 */

const STRONG_PASSWORD = 'TempPass1234!';
const ROTATED_PASSWORD = 'Rotated567!';

async function fillNewUserForm(
  page: import('@playwright/test').Page,
  data: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    requirePasswordChange: boolean;
  }
) {
  await page.goto('/settings/users/new');
  await page.getByRole('textbox', { name: 'First Name' }).fill(data.firstName);
  await page.getByRole('textbox', { name: 'Last Name' }).fill(data.lastName);
  await page.getByRole('textbox', { name: 'Email' }).fill(data.email);
  // The label is "Initial Password" when require-change is on,
  // "Password" when off — both match the partial label we use here.
  await page
    .getByLabel(/Password$/i)
    .first()
    .fill(data.password);
  await page
    .getByLabel(/Confirm.*Password$/i)
    .first()
    .fill(data.password);

  // The checkbox defaults to checked (require-change ON). Toggle off
  // when the test wants the direct-login flow.
  const checkbox = page.getByRole('checkbox', {
    name: 'Require password change on next login',
  });
  const isChecked = await checkbox.isChecked();
  if (data.requirePasswordChange && !isChecked) await checkbox.click();
  if (!data.requirePasswordChange && isChecked) await checkbox.click();

  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForURL(/\/settings\/users(\?|$)/, { timeout: 15_000 });
  await expect(page.getByText(data.email)).toBeVisible({ timeout: 15_000 });
}

async function loginAsUser(
  browser: Browser,
  email: string,
  password: string
): Promise<{
  page: import('@playwright/test').Page;
  ctx: Awaited<ReturnType<Browser['newContext']>>;
}> {
  const ctx = await browser.newContext({ storageState: undefined });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.waitForURL(/\/api\/interaction\//);
  await page.getByRole('textbox', { name: 'Username or Email' }).fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
  return { page, ctx };
}

authedTest.describe('Users — create + login', () => {
  authedTest(
    'create user with require-password-change OFF, login lands on the console',
    async ({ authenticatedPage: adminPage, browser }) => {
      const ts = Date.now();
      const email = `e2e-user-direct-${ts}@example.com`;

      await fillNewUserForm(adminPage, {
        firstName: 'Direct',
        lastName: 'Login',
        email,
        password: STRONG_PASSWORD,
        requirePasswordChange: false,
      });

      const { page, ctx } = await loginAsUser(browser, email, STRONG_PASSWORD);
      try {
        // Skip OIDC consent if it shows up.
        const allow = page.getByRole('button', { name: 'Allow' });
        if (await allow.isVisible({ timeout: 5_000 }).catch(() => false)) {
          await allow.click();
        }

        // Direct user lands either on /getting-started (no workspaces)
        // or /workspaces (had previous access). No change-password prompt.
        await page.waitForURL(/\/(getting-started|workspaces)/, {
          timeout: 30_000,
        });
        await expect(
          page.getByRole('button', { name: 'Change Password' })
        ).toHaveCount(0);
      } finally {
        await ctx.close();
      }
    }
  );

  authedTest(
    'create user with require-password-change ON, login forces change-password prompt',
    async ({ authenticatedPage: adminPage, browser }) => {
      const ts = Date.now();
      const email = `e2e-user-rotate-${ts}@example.com`;

      await fillNewUserForm(adminPage, {
        firstName: 'Rotate',
        lastName: 'Login',
        email,
        password: STRONG_PASSWORD,
        requirePasswordChange: true,
      });

      const { page, ctx } = await loginAsUser(browser, email, STRONG_PASSWORD);
      try {
        // The OIDC interaction surfaces the change-password form before
        // releasing the token to the UI.
        const changePwButton = page.getByRole('button', {
          name: 'Change Password',
        });
        await expect(changePwButton).toBeVisible({ timeout: 30_000 });

        await page
          .getByRole('textbox', { name: 'New Password' })
          .fill(ROTATED_PASSWORD);
        await page
          .getByRole('textbox', { name: 'Confirm Password' })
          .fill(ROTATED_PASSWORD);
        await changePwButton.click();

        const allow = page.getByRole('button', { name: 'Allow' });
        if (await allow.isVisible({ timeout: 5_000 }).catch(() => false)) {
          await allow.click();
        }
        await page.waitForURL(/\/(getting-started|workspaces)/, {
          timeout: 30_000,
        });
      } finally {
        await ctx.close();
      }
    }
  );
});

// Re-export expect so the spec module pattern is consistent.
export { expect, test };
