import type { Page } from '@playwright/test';

/**
 * Walk the Advanced Add flow to create an OpenAI connection + auto-resource
 * with a *fake* API key. Useful for tests that only need to render the
 * resource edit pages (sub-tabs, capacity, fallback, etc.) — no actual
 * gateway calls happen here, so the placeholder key is fine.
 *
 * Returns the resourceId so the caller can deep-link to a sub-tab.
 *
 * Why a placeholder key works: the create flow stores the credential
 * encrypted but never round-trips it to OpenAI at save time. The first
 * call against the resource would 401, but we don't drive a call.
 */
export async function ensureAiResource(
  page: Page,
  workspaceId: string,
  environmentId: string,
  connectionName: string
): Promise<{ connectionId: string; resourceId: string }> {
  const resourceName = `${connectionName}-default`;

  await page.goto(
    `/workspaces/${workspaceId}/${environmentId}/ai-connections/new`
  );
  await page.getByRole('button', { name: 'Advanced Add' }).click();

  await page
    .getByRole('textbox', { name: 'Connection Name' })
    .fill(connectionName);
  await page.getByLabel('OpenAI API Key').fill('sk-fake-placeholder-only');

  await page.getByRole('button', { name: 'Save' }).click();

  // Capture the connection + resource ids from the result dialog.
  const dialog = page.getByRole('heading', { name: 'Quick Create Result' });
  await dialog.waitFor({ state: 'visible', timeout: 30_000 });

  const resourceLink = page.getByRole('link', { name: resourceName });
  const resourceHref = await resourceLink.getAttribute('href');
  const resourceMatch = resourceHref?.match(/\/ai-resources\/edit\/([^/]+)/);
  if (!resourceMatch) throw new Error('resource link missing');
  const resourceId = resourceMatch[1];

  const connectionLink = page.getByRole('link', {
    name: connectionName,
    exact: true,
  });
  const connectionHref = await connectionLink.getAttribute('href');
  const connectionMatch = connectionHref?.match(
    /\/ai-connections\/edit\/([^/]+)/
  );
  if (!connectionMatch) throw new Error('connection link missing');
  const connectionId = connectionMatch[1];

  await page.getByRole('button', { name: 'Dismiss' }).click();

  return { connectionId, resourceId };
}
