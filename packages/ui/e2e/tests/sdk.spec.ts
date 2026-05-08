import { test, expect } from '../fixtures/auth';
import { ensureWorkspaceAndEnvironment } from '../fixtures/workspace';

test.describe('SDK page', () => {
  test('shows the environment IDs and the OpenAI adapter language tabs', async ({
    authenticatedPage: page,
  }) => {
    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );
    await page.goto(`/workspaces/${workspaceId}/${environmentId}/sdk`);

    // Environment Details section contains the workspace + environment ids
    // verbatim — useful for users wiring up the OpenAI adapter. We
    // narrow to the `<p>` rendering so we don't collide with the
    // breadcrumb's titleized link of the same id.
    await expect(
      page.getByRole('heading', { name: 'Environment Details' })
    ).toBeVisible();
    await expect(page.locator('p', { hasText: workspaceId })).toBeVisible();
    await expect(page.locator('p', { hasText: environmentId })).toBeVisible();

    // Adapter section + per-language tabs (Node.js / Python / cURL).
    // The page heading was renamed when the SDK section grew to cover
    // multiple request shapes (Chat Completions / Responses / Anthropic
    // Messages) so the suffix went plural.
    await expect(
      page.getByRole('heading', { name: 'Completion API Adapters' })
    ).toBeVisible();
    await expect(
      page.getByRole('tab', { name: 'Node.js' }).first()
    ).toBeVisible();
    await expect(
      page.getByRole('tab', { name: 'Python' }).first()
    ).toBeVisible();
    await expect(page.getByRole('tab', { name: 'cURL' }).first()).toBeVisible();

    // Switching the active language tab re-renders the snippet — the
    // editor mounts once per tab so this is just a smoke check that
    // the click does not throw.
    await page.getByRole('tab', { name: 'Python' }).first().click();
    await expect(
      page.getByRole('tab', { name: 'Python', selected: true }).first()
    ).toBeVisible();
  });
});
