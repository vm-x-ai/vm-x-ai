import { test, expect } from '../fixtures/auth';
import { ensureWorkspaceAndEnvironment } from '../fixtures/workspace';

/**
 * App-shell tests — sidebar, app bar, account menu, workspace selector,
 * breadcrumbs. None of these require real provider data, so they run
 * cleanly against an empty seeded workspace.
 *
 * Locator notes: the sidebar nav is the persistent MUI drawer rendered
 * by `Sidebar.tsx`; we scope to the `<nav>` element to avoid colliding
 * with the breadcrumb's "Workspaces" link on environment-scoped pages.
 */
test.describe('App shell navigation', () => {
  test('sidebar renders Getting Started, Workspaces, Roles, Users', async ({
    authenticatedPage: page,
  }) => {
    // Navigate to /settings/roles (a non-workspace route) so the sidebar
    // renders "Workspaces" as a top-level link rather than as the
    // collapsible submenu parent button (which kicks in only when the
    // URL is workspace-scoped).
    await page.goto('/settings/roles');
    const drawer = page
      .locator('aside.MuiDrawer-root, .MuiDrawer-paper')
      .first();

    await expect(
      drawer.getByRole('link', { name: 'Getting Started' })
    ).toBeVisible();
    await expect(
      drawer.getByRole('link', { name: 'Workspaces', exact: true })
    ).toBeVisible();
    await expect(drawer.getByRole('link', { name: 'Roles' })).toBeVisible();
    await expect(
      drawer.getByRole('link', { name: 'User Management' })
    ).toBeVisible();
  });

  test('clicking a sidebar entry navigates to that route', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/');
    const drawer = page
      .locator('aside.MuiDrawer-root, .MuiDrawer-paper')
      .first();

    // The sidebar has two "Roles" links — workspace-scoped
    // (`/workspaces/.../security/auth/role/overview`) and global
    // (`/settings/roles`). The test targets the global one; filter by
    // href to disambiguate.
    await drawer.locator('a[href="/settings/roles"]').click();
    await page.waitForURL(/\/settings\/roles/);
    // Settings layout fetches the roles list before the toolbar renders;
    // bump the timeout so React Query has time to settle.
    await expect(page.getByRole('link', { name: 'Add new Role' })).toBeVisible({
      timeout: 15_000,
    });

    await drawer.getByRole('link', { name: 'User Management' }).click();
    await page.waitForURL(/\/settings\/users/);
    await expect(page.getByRole('link', { name: 'Add new User' })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('account menu opens, shows the seed admin and logs out', async ({
    authenticatedPage: page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Account settings' }).click();
    // The seed user from migration 1 — auth fixture forces this email.
    // The popup menu shows the email as a `<span>` exactly equal to
    // "admin@example.com"; other places on the page show
    // "Admin (admin@example.com)" (table cells, etc.), so use exact match.
    await expect(
      page.getByText('admin@example.com', { exact: true })
    ).toBeVisible();
    // Logout — wait for the post-signout redirect (auth.js sends us back
    // through OIDC /api/interaction). We don't drive the full re-login
    // here; the auth spec already covers it.
    await page.getByRole('menuitem', { name: 'Logout' }).click();
    await page.waitForURL(/\/api\/interaction\//);
    await expect(
      page.getByRole('textbox', { name: 'Username or Email' })
    ).toBeVisible();
  });

  test('workspace selector lives in the sidebar header once a workspace exists', async ({
    authenticatedPage: page,
  }) => {
    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );
    await page.goto(
      `/workspaces/${workspaceId}/${environmentId}/ai-connections/overview`
    );
    // The selector moved from the AppBar into the sidebar header
    // (see WorkspaceSelectorMenu.tsx — aria-label "Workspace"). Use
    // `exact: true` so we don't accidentally match the new
    // "Workspaces" sidebar collapsible-group parent button.
    await expect(
      page.getByRole('button', { name: 'Workspace', exact: true })
    ).toBeVisible();
  });

  test('environment-scoped sidebar submenu (AI Connections, AI Resources, ...) renders', async ({
    authenticatedPage: page,
  }) => {
    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );
    await page.goto(`/workspaces/${workspaceId}/${environmentId}`);

    // The horizontal tab strip moved into the sidebar's "Workspaces"
    // collapsible group. Each entry surfaces as a `link` (anchor) once
    // the group is auto-expanded on workspace routes.
    for (const tab of [
      'Playground',
      'AI Connections',
      'AI Resources',
      'Prioritization',
      'Security',
      'Insights',
      'SDK',
    ]) {
      await expect(page.getByRole('link', { name: tab })).toBeVisible();
    }
  });

  // The persistent sidebar's collapse/expand toggle uses a chevron
  // IconButton that sits visually below the fixed AppBar but whose
  // bounding box overlaps the AppBar in Chromium headless. `click()`
  // gets intercepted; `click({ force: true })` clicks but the
  // ListItemText opacity transition doesn't seem to fire reliably
  // headless. Tracked as a follow-up.
  test.skip('sidebar drawer collapses + expands via the chevron toggle', async () => {
    /* see comment above */
  });
});
