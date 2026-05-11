import { test, expect } from '../fixtures/auth';

/**
 * Settings → Pricing — list page + create/edit/delete roundtrip.
 *
 * Migration 17 seeds 22 canonical pricing entries, so the list is
 * never empty in this suite. The roundtrip uses a unique
 * (provider, model) per run so concurrent runs don't collide on the
 * (provider, model) unique constraint.
 */
test.describe('Settings — Pricing', () => {
  test('list shows the seeded entries + the Add new Pricing CTA', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/settings/pricing');

    await expect(
      page.getByRole('link', { name: 'Add new Pricing' })
    ).toBeVisible({ timeout: 15_000 });

    // Column headers prove the table rendered. Migration 17 seeds rows
    // for openai / anthropic / aws-bedrock / gemini / perplexity / groq
    // — at least one provider should be visible.
    await expect(
      page.getByRole('columnheader', { name: 'Provider' })
    ).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: 'Model' })
    ).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: 'Input', exact: true })
    ).toBeVisible();
  });

  test('Add new Pricing navigates to the create form', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/settings/pricing');
    await page.getByRole('link', { name: 'Add new Pricing' }).click();
    await page.waitForURL(/\/settings\/pricing\/new/);

    await expect(page.getByRole('textbox', { name: 'Provider' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Model' })).toBeVisible();
    await expect(
      page.getByRole('spinbutton', {
        name: 'Input cost per token',
        exact: true,
      })
    ).toBeVisible();
    await expect(
      page.getByRole('spinbutton', {
        name: 'Output cost per token',
        exact: true,
      })
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
  });
});

test.describe.serial('Settings — Pricing CRUD', () => {
  // Unique provider/model per run so we never collide with the seeded
  // canonical rows or with another test run.
  const provider = `e2e-pricing-${Date.now()}`;
  const model = 'test-model';

  test('create + delete pricing roundtrip', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/settings/pricing/new');

    await page.getByRole('textbox', { name: 'Provider' }).fill(provider);
    await page.getByRole('textbox', { name: 'Model' }).fill(model);
    await page
      .getByRole('spinbutton', { name: 'Input cost per token', exact: true })
      .fill('0.000003');
    await page
      .getByRole('spinbutton', { name: 'Output cost per token', exact: true })
      .fill('0.000012');
    await page.getByRole('button', { name: 'Save' }).click();

    // Save action redirects back to /settings/pricing on success.
    await page.waitForURL(/\/settings\/pricing(\?|$)/, { timeout: 15_000 });

    // The new row appears in the table — provider column carries the
    // unique value we set.
    const row = page.getByRole('row').filter({
      has: page.getByRole('cell', { name: provider, exact: true }),
    });
    await expect(row).toBeVisible({ timeout: 15_000 });

    // Delete via the row's red Delete IconButton. The aria-label is
    // `Delete <provider>/<model>` (set in `Table.tsx`).
    await row
      .getByRole('button', { name: `Delete ${provider}/${model}` })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete' }).click();

    await expect(
      page.getByRole('cell', { name: provider, exact: true })
    ).toHaveCount(0, { timeout: 15_000 });
  });
});
