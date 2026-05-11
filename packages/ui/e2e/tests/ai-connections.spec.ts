import { test, expect } from '../fixtures/auth';
import { ensureWorkspaceAndEnvironment } from '../fixtures/workspace';

/**
 * AI Connections — list page, the create-form (Quick / Advanced toggle),
 * and the edit page's three sub-tabs (General / Provider / Capacity).
 *
 * We can render and walk the whole UI without ever submitting a real
 * connection, which is good — submitting one would require a working
 * provider API key. That gap is filled by the API integration tests.
 */
test.describe('AI Connections', () => {
  test('overview shows the empty state and "Add new AI Connection" CTA', async ({
    authenticatedPage: page,
  }) => {
    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );
    await page.goto(
      `/workspaces/${workspaceId}/${environmentId}/ai-connections/overview`
    );

    // The page renders one of two surfaces depending on whether prior
    // suites have seeded connections in this workspace:
    //   - Empty: `<EmptyState>` with the "Add new AI Connection" CTA link.
    //   - Populated: MRT table with column headers + the same CTA link.
    // Both share the CTA link, so we assert that and accept either
    // surface for the secondary signal.
    await expect(
      page.getByRole('link', { name: 'Add new AI Connection' })
    ).toBeVisible({ timeout: 15_000 });
    const emptyHeading = page.getByRole('heading', {
      name: 'No AI Connections yet',
    });
    const tableHeader = page.getByRole('columnheader', {
      name: 'AI Connection',
    });
    // Race them — whichever wins, the page rendered correctly.
    await expect(emptyHeading.or(tableHeader)).toBeVisible({
      timeout: 15_000,
    });
  });

  test('create form exposes Quick / Advanced toggle and the providers list', async ({
    authenticatedPage: page,
  }) => {
    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );
    await page.goto(
      `/workspaces/${workspaceId}/${environmentId}/ai-connections/new`
    );

    // Form-type toggle
    const quick = page.getByRole('button', { name: 'Quick Add' });
    const advanced = page.getByRole('button', { name: 'Advanced Add' });
    await expect(quick).toBeVisible();
    await expect(advanced).toBeVisible();

    // Quick mode lists every registered provider's name in the heading
    // ("Batch add AI connections"). Each provider row has a description
    // pulled from the provider entity.
    await expect(
      page.getByRole('heading', { name: 'Batch add AI connections' })
    ).toBeVisible();
    // OpenAI is one of the seeded providers; its label should always
    // appear in the Quick list.
    await expect(
      page.getByText('OpenAI', { exact: false }).first()
    ).toBeVisible();

    // Switching to Advanced reveals the per-provider config UI and a
    // single "Connection Name" field.
    await advanced.click();
    await expect(
      page.getByRole('textbox', { name: 'Connection Name' })
    ).toBeVisible();

    // Save button is always present in both modes.
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
  });
});
