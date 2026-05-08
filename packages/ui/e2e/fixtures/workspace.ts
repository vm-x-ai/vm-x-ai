import type { Page } from '@playwright/test';

/**
 * The dashboard's getting-started flow drops a user without a workspace
 * onto a guided form. Walk the form once so subsequent specs can reach
 * the workspace-scoped pages (audit, usage, ai-resources, etc).
 *
 * Returns the resolved workspaceId/environmentId so tests can build URLs.
 *
 * Order of operations:
 *
 *   1. If the current URL already encodes a `(workspaceId, environmentId)`
 *      pair (either via path segments or query params), return them.
 *   2. Otherwise navigate to "/" — the dashboard redirects to
 *      `/workspaces/<workspaceId>/<environmentId>/ai-connections/overview`
 *      when at least one workspace + environment exists. Parse the IDs
 *      out of the path.
 *   3. If no workspace exists yet, walk the getting-started form once.
 *
 * This avoids creating a fresh workspace on every test, which previously
 * piled up dozens of "my workspace" rows over time and broke list-based
 * assertions.
 */
export async function ensureWorkspaceAndEnvironment(page: Page): Promise<{
  workspaceId: string;
  environmentId: string;
}> {
  // Step 1: try the current URL.
  let resolved = parseIdsFromUrl(page.url());
  if (resolved) return resolved;

  // Step 2: bounce through "/" — the dashboard redirects to the first
  // workspace/environment pair if the seed admin has any.
  await page.goto('/');
  // Give the redirect chain a beat to settle.
  await page.waitForLoadState('domcontentloaded');
  resolved = parseIdsFromUrl(page.url());
  if (resolved) return resolved;

  // Step 3: walk the getting-started form. The user landed on
  // /getting-started because no workspace exists yet.
  if (!page.url().includes('/getting-started')) {
    await page.goto('/getting-started');
  }

  const createWorkspace = page.getByRole('button', {
    name: 'Create Workspace',
  });
  if (await createWorkspace.isVisible().catch(() => false)) {
    await createWorkspace.click();
  }
  await page.waitForURL(/workspaceId=/);
  const workspaceId = new URL(page.url()).searchParams.get('workspaceId');

  const createEnvironment = page.getByRole('button', {
    name: 'Create Environment',
  });
  if (await createEnvironment.isVisible().catch(() => false)) {
    await createEnvironment.click();
  }
  await page.waitForURL(/environmentId=/);
  const environmentId = new URL(page.url()).searchParams.get('environmentId');

  if (!workspaceId || !environmentId) {
    throw new Error(
      'Failed to resolve workspaceId/environmentId from the getting-started flow'
    );
  }

  // Step 3 of /getting-started auto-fires a `createApiKey` mutation as
  // soon as both ids are in the URL. Several specs (AI Resources create,
  // Security overview) assume at least one API key exists, so wait for
  // it to land before returning.
  await page
    .getByRole('link', { name: 'Finish' })
    .waitFor({ state: 'visible', timeout: 10_000 })
    .catch(() => {
      // Not fatal — the API key may already exist from a prior run.
    });

  return { workspaceId, environmentId };
}

/**
 * Walk the getting-started form to create a *fresh* workspace named
 * `name`, returning its workspaceId. Useful for destructive tests
 * (delete-workspace, delete-environment) that need a throwaway target
 * — the shared fixture's workspace is reused across the suite, so we
 * don't want delete tests touching it.
 *
 * The form lives at `/getting-started`. Step 1 has a "Workspace Name"
 * textbox pre-filled with "my workspace"; we overwrite it, click
 * "Create Workspace", then read the workspaceId from the URL.
 */
export async function createWorkspace(
  page: import('@playwright/test').Page,
  name: string
): Promise<string> {
  await page.goto('/getting-started');
  const nameField = page.getByRole('textbox', { name: 'Workspace Name' });
  await nameField.waitFor({ state: 'visible' });
  await nameField.fill(name);
  await page.getByRole('button', { name: 'Create Workspace' }).click();
  await page.waitForURL(/workspaceId=/);
  const workspaceId = new URL(page.url()).searchParams.get('workspaceId');
  if (!workspaceId) {
    throw new Error(`Failed to create workspace ${name}`);
  }
  return workspaceId;
}

/**
 * Pull `(workspaceId, environmentId)` out of the dashboard's URL shape:
 *
 *   - `/workspaces/<wid>/<eid>/...`           (path-style, post-redirect)
 *   - `/getting-started?workspaceId=<wid>&environmentId=<eid>`  (query-style)
 *
 * Returns `null` if both ids aren't present.
 */
function parseIdsFromUrl(
  href: string
): { workspaceId: string; environmentId: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return null;
  }

  // Path-style: /workspaces/<wid>/<eid>/...
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments[0] === 'workspaces' && segments[1] && segments[2]) {
    // Skip "edit" — that's /workspaces/<wid>/edit, not an environment.
    if (segments[2] !== 'edit') {
      return { workspaceId: segments[1], environmentId: segments[2] };
    }
  }

  // Query-style: ?workspaceId=...&environmentId=...
  const wid = parsed.searchParams.get('workspaceId');
  const eid = parsed.searchParams.get('environmentId');
  if (wid && eid) return { workspaceId: wid, environmentId: eid };
  return null;
}
