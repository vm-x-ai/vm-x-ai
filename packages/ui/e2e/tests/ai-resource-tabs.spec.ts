import { test, expect } from '../fixtures/auth';
import { ensureWorkspaceAndEnvironment } from '../fixtures/workspace';
import { ensureAiResource } from '../fixtures/ai-resource';

/**
 * AI Resource edit page sub-tabs. Phase-1 coverage of the five tabs:
 *
 *   /general       — primary model / connection / defaultArgs
 *   /routing       — Dynamic Routing builder
 *   /multi-answer  — Multi response toggle + secondary models
 *   /fallback      — Use fallback toggle + fallback model list
 *   /capacity      — Enforce capacity constraints toggle
 *
 * Each tab is asserted via its anchor heading + its toggle/Save button so
 * that re-themes or layout shifts can move things around without
 * breaking the suite.
 *
 * The connection here uses a placeholder API key — sub-tabs are pure UI
 * and don't fire upstream calls. Live gateway behavior is covered by
 * `live-openai.spec.ts`.
 */
test.describe.serial('AI Resource — sub-tabs', () => {
  let resourceId = '';
  const connectionName = `e2e-tabs-${Date.now()}`;

  test('setup — create a connection + auto-resource', async ({
    authenticatedPage: page,
  }) => {
    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );
    const ids = await ensureAiResource(
      page,
      workspaceId,
      environmentId,
      connectionName
    );
    resourceId = ids.resourceId;
    expect(resourceId).toBeTruthy();
  });

  test('General tab — renders primary-model selector + Save', async ({
    authenticatedPage: page,
  }) => {
    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );
    await page.goto(
      `/workspaces/${workspaceId}/${environmentId}/ai-resources/edit/${resourceId}/general`
    );
    // Save button is rendered with `opacity: 0` until the form is
    // dirty (see `Form/SubmitButton.tsx`) — Playwright's
    // `toBeVisible` treats opacity:0 as not-visible. We assert it's
    // attached to the DOM and the Name field renders, then dirty the
    // form to confirm the visibility transition fires.
    await expect(page.getByRole('button', { name: 'Save' })).toBeAttached({
      timeout: 15_000,
    });
    // Resource name field is the canonical anchor on the General page.
    const nameField = page.getByRole('textbox', { name: 'Name' }).first();
    await expect(nameField).toBeVisible();
    await nameField.fill('renamed-by-test');
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
  });

  test('Dynamic Routing tab — renders heading + Use dynamic routing toggle', async ({
    authenticatedPage: page,
  }) => {
    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );
    await page.goto(
      `/workspaces/${workspaceId}/${environmentId}/ai-resources/edit/${resourceId}/routing`
    );
    await expect(
      page.getByRole('heading', { name: 'Dynamic Routing' })
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole('switch', { name: 'Use dynamic routing' })
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
  });

  test('Multi-Answer tab — renders Use multi response toggle + Save', async ({
    authenticatedPage: page,
  }) => {
    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );
    await page.goto(
      `/workspaces/${workspaceId}/${environmentId}/ai-resources/edit/${resourceId}/multi-answer`
    );
    await expect(
      page.getByRole('switch', { name: 'Use multi response' })
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
  });

  test('Fallback tab — renders Use fallback toggle + Save', async ({
    authenticatedPage: page,
  }) => {
    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );
    await page.goto(
      `/workspaces/${workspaceId}/${environmentId}/ai-resources/edit/${resourceId}/fallback`
    );
    await expect(
      page.getByRole('switch', { name: 'Use fallback' })
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
  });

  test('Capacity tab — renders Enforce capacity constraints toggle + Save', async ({
    authenticatedPage: page,
  }) => {
    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );
    await page.goto(
      `/workspaces/${workspaceId}/${environmentId}/ai-resources/edit/${resourceId}/capacity`
    );
    await expect(
      page.getByRole('switch', { name: 'Enforce capacity constraints' })
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
  });

  test('Fallback tab — toggling Use fallback persists after save', async ({
    authenticatedPage: page,
  }) => {
    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );
    await page.goto(
      `/workspaces/${workspaceId}/${environmentId}/ai-resources/edit/${resourceId}/fallback`
    );
    const toggle = page.getByRole('switch', { name: 'Use fallback' });
    await toggle.waitFor({ state: 'visible', timeout: 15_000 });
    const wasChecked = await toggle.isChecked();
    await toggle.click();
    await page.getByRole('button', { name: 'Save' }).click();
    // The form action posts through Next's server action; wait for the
    // round-trip to settle before reloading.
    await page.waitForLoadState('networkidle');
    await page.reload();
    const nowChecked = await page
      .getByRole('switch', { name: 'Use fallback' })
      .isChecked();
    expect(nowChecked).toBe(!wasChecked);
  });
});
