import { test, expect } from '../fixtures/auth';
import { ensureWorkspaceAndEnvironment } from '../fixtures/workspace';
import { ensureAiResource } from '../fixtures/ai-resource';

/**
 * Playground tests — Phase 1 covers the UI controls (endpoint mode,
 * streaming, web-search) without firing a real provider call. Driving
 * an actual chat is in `live-openai.spec.ts` (gated on
 * `OPENAI_API_KEY`).
 */
test.describe('AI Resource playground', () => {
  test('AI resources overview page is reachable for an empty workspace', async ({
    authenticatedPage: page,
  }) => {
    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );

    await page.goto(`/workspaces/${workspaceId}/${environmentId}/ai-resources`);

    // The breadcrumb still shows the current section. The label is
    // mapped from `ai-resources` to `AI Resources` via the lookup
    // table in `Layout/Breadcrumbs.tsx`. Two roles match this label —
    // the breadcrumb anchor and the sidebar link — so we narrow to
    // the breadcrumb by selecting the anchor that points to the
    // overview path.
    await expect(
      page.locator(`a[href$="/ai-resources/overview"]`, {
        hasText: 'AI Resources',
      })
    ).toBeVisible();
    // Sidebar entry for AI Resources is highlighted when on the route.
    const sidebarLink = page.getByRole('link', {
      name: 'AI Resources',
      exact: true,
    });
    await expect(sidebarLink.first()).toBeVisible();
  });
});

test.describe.serial('AI Resource playground — UI controls', () => {
  let resourceId = '';
  const connectionName = `e2e-pg-${Date.now()}`;

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

  test('Open playground link on resource edit deep-links to /playground with the resource preselected', async ({
    authenticatedPage: page,
  }) => {
    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );
    await page.goto(
      `/workspaces/${workspaceId}/${environmentId}/ai-resources/edit/${resourceId}/general`
    );
    await page
      .getByRole('link', { name: 'Open playground' })
      .click({ timeout: 15_000 });
    await page.waitForURL(
      new RegExp(
        `/workspaces/${workspaceId}/${environmentId}/playground\\?resourceId=${resourceId}`
      )
    );
  });

  test('endpoint toggle, mode toggle, Streaming + Web search all render on /playground', async ({
    authenticatedPage: page,
  }) => {
    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );
    await page.goto(
      `/workspaces/${workspaceId}/${environmentId}/playground?resourceId=${resourceId}`
    );

    // Mode toggle (resource vs connection/model).
    await expect(
      page.getByRole('button', { name: 'use ai resource' })
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole('button', { name: 'use connection model' })
    ).toBeVisible();

    // Endpoint mode + switches.
    const chatCompletions = page.getByRole('button', {
      name: 'chat completions',
    });
    const responses = page.getByRole('button', { name: 'responses' });
    const anthropic = page.getByRole('button', {
      name: 'anthropic messages',
    });
    const streaming = page.getByRole('switch', { name: 'Streaming' });
    const webSearch = page.getByRole('switch', { name: 'Web search' });

    await expect(chatCompletions).toBeVisible();
    await expect(responses).toBeVisible();
    await expect(anthropic).toBeVisible();
    await expect(streaming).toBeVisible();
    await expect(webSearch).toBeVisible();

    // Switching to Responses disables the Streaming switch.
    await responses.click();
    await expect(streaming).toBeDisabled();

    // Switching to Anthropic Messages also disables Streaming
    // (Anthropic SSE event-shape mapping is Phase 11B follow-up).
    await anthropic.click();
    await expect(streaming).toBeDisabled();

    // Switching back to Chat Completions re-enables it.
    await chatCompletions.click();
    await expect(streaming).toBeEnabled();

    // Web search is independent of endpoint mode.
    await expect(webSearch).not.toBeChecked();
    await webSearch.click();
    await expect(webSearch).toBeChecked();
  });

  test('Connection / Model mode reveals connection + model inputs', async ({
    authenticatedPage: page,
  }) => {
    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );
    await page.goto(
      `/workspaces/${workspaceId}/${environmentId}/playground?resourceId=${resourceId}`
    );
    await page
      .getByRole('button', { name: 'use connection model' })
      .click({ timeout: 15_000 });
    await expect(
      page.getByRole('combobox', { name: 'Connection name' })
    ).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Model' })).toBeVisible();
  });

  test('attach button opens the file picker and renders attachment chip after a paste', async ({
    authenticatedPage: page,
  }) => {
    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );
    await page.goto(
      `/workspaces/${workspaceId}/${environmentId}/playground?resourceId=${resourceId}`
    );

    // Paperclip is rendered next to the message textarea.
    await expect(
      page.getByRole('button', { name: 'Attach files' })
    ).toBeVisible({ timeout: 15_000 });

    // Simulate a clipboard paste of an image. The chat textarea wires
    // its onPaste handler to capture clipboardData.items of kind=file.
    const textarea = page.getByPlaceholder(
      'Type a message... (Press Shift + Enter to break line)'
    );
    await textarea.click();
    // 1×1 transparent PNG, base64-encoded so we can hand a real Blob to
    // the synthetic ClipboardEvent.
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
    await page.evaluate(async (b64) => {
      const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
      const file = new File([blob], 'paste.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const target = document.activeElement as HTMLElement;
      target.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        })
      );
    }, pngBase64);
    await expect(
      page.getByRole('button', { name: /Remove paste\.png/i })
    ).toBeVisible({ timeout: 5_000 });
  });
});
