import { expect, type Page } from '@playwright/test';

/**
 * Drive the Security → Add Role flow to provision a fresh API key
 * for direct gateway calls (the playground uses the OIDC session;
 * for /v1/completion calls we want a real API key the way SDK
 * users would).
 *
 * Returns the secret value, which the dashboard only displays once
 * inside an APIKeyDialog right after submit. The dialog renders the
 * value in a `<pre>` element ("API Key:" label preceding it).
 */
export async function createApiKeyViaUI(
  page: Page,
  workspaceId: string,
  environmentId: string,
  name = `e2e-key-${Date.now()}`
): Promise<{ apiKeyValue: string; apiKeyName: string }> {
  await page.goto(
    `/workspaces/${workspaceId}/${environmentId}/security/auth/role/new`
  );

  await page.getByRole('textbox', { name: 'Role Name' }).fill(name);
  await page.getByRole('textbox', { name: 'Description' }).fill('e2e test key');
  await page.getByRole('button', { name: 'Save' }).click();

  // The success dialog announces the new role and shows the secret in a
  // <pre> tag. Wait for the dialog to mount before scraping.
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  // The `<pre>` directly under the dialog body contains the value.
  const apiKeyValue = (
    await dialog.locator('pre').first().textContent()
  )?.trim();
  if (!apiKeyValue) {
    throw new Error('Failed to scrape the API key value from the dialog');
  }

  await dialog.getByRole('button', { name: 'Acknowledged' }).click();

  return { apiKeyValue, apiKeyName: name };
}
