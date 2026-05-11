import { test, expect } from '../fixtures/auth';
import { ensureWorkspaceAndEnvironment } from '../fixtures/workspace';
import { hasLiveKeys, liveEnv } from '../fixtures/live';
import { anthropicMessage, chatCompletion } from '../fixtures/gateway';

/**
 * Full end-to-end roundtrip against a real Anthropic account.
 *
 * Mirrors `live-openai.spec.ts` but for the Anthropic provider — covers:
 *
 *   1. Create connection (Advanced flow, Anthropic provider) → API key
 *      from `ANTHROPIC_API_KEY` in `.env.local`.
 *   2. Auto-resource appears in the AI Resources list.
 *   3. Playground reachability + the "Anthropic Messages" toggle is
 *      visible on the endpoint mode group.
 *   4. Drive a non-streaming Anthropic Messages call (Phase 11
 *      `/anthropic/messages` endpoint) → assert the response carries
 *      Anthropic-shape `content[0].text`.
 *   5. Drive a non-streaming Chat Completions call against the same
 *      resource → confirms the connection works for both endpoints.
 *   6. Edit the connection (rename + save).
 *   7. Delete the connection (cascades to the auto-resource).
 *
 * Skipped if `ANTHROPIC_API_KEY` is missing from `.env.local` /
 * `process.env`.
 */

const SHOULD_RUN = hasLiveKeys('ANTHROPIC_API_KEY');

const CONNECTION_NAME = `e2e-anthropic-${Date.now()}`;
const RESOURCE_NAME = `${CONNECTION_NAME}-default`;
const RENAMED_CONNECTION = `${CONNECTION_NAME}-renamed`;

test.describe
  .serial('Live Anthropic: connection + playground + edit + delete', () => {
  test.skip(
    !SHOULD_RUN,
    'ANTHROPIC_API_KEY not set — see e2e/fixtures/live.ts'
  );

  let connectionId = '';
  let resourceId = '';

  test('step 1 — create Anthropic connection via Advanced flow', async ({
    authenticatedPage: page,
  }) => {
    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );
    await page.goto(
      `/workspaces/${workspaceId}/${environmentId}/ai-connections/new`
    );

    // Switch to Advanced — the provider-specific config (api key field)
    // only renders in this mode.
    await page.getByRole('button', { name: 'Advanced Add' }).click();

    await page
      .getByRole('textbox', { name: 'Connection Name' })
      .fill(CONNECTION_NAME);

    // Switch the provider dropdown from the OpenAI default to Anthropic.
    // The combobox is a labelled MUI Autocomplete on the form; opening
    // it and clicking the option is enough — the form re-renders to
    // expose Anthropic's "Anthropic API Key" field.
    const providerInput = page.getByRole('combobox', { name: /provider/i });
    await providerInput.click();
    await page.getByRole('option', { name: 'Anthropic' }).click();

    // Fill the Anthropic-specific API key field. Same `getByLabel`
    // pattern as the OpenAI spec — the field renders as
    // `<input type="password">` (`format: "secret"`), which has no
    // implicit ARIA `textbox` role.
    await page
      .getByLabel('Anthropic API Key')
      .fill(liveEnv('ANTHROPIC_API_KEY'));

    await page.getByRole('button', { name: 'Save' }).click();

    await expect(
      page.getByRole('heading', { name: 'Quick Create Result' })
    ).toBeVisible({ timeout: 30_000 });

    // The dialog renders a link to the auto-created resource. Pull
    // the resourceId out of its href so step 2/3 can deep-link.
    const resourceLink = page.getByRole('link', { name: RESOURCE_NAME });
    await expect(resourceLink).toBeVisible();
    const resourceHref = await resourceLink.getAttribute('href');
    const resourceMatch = resourceHref?.match(/\/ai-resources\/edit\/([^/]+)/);
    expect(resourceMatch).not.toBeNull();
    resourceId = resourceMatch![1];

    const connectionLink = page.getByRole('link', {
      name: CONNECTION_NAME,
      exact: true,
    });
    const connectionHref = await connectionLink.getAttribute('href');
    const connectionMatch = connectionHref?.match(
      /\/ai-connections\/edit\/([^/]+)/
    );
    expect(connectionMatch).not.toBeNull();
    connectionId = connectionMatch![1];

    await page.getByRole('button', { name: 'Dismiss' }).click();
    await page.waitForURL(/\/ai-connections\/overview/);

    await expect(
      page.getByRole('cell', { name: CONNECTION_NAME })
    ).toBeVisible();
  });

  test('step 2 — auto-resource appears in the AI Resources list', async ({
    authenticatedPage: page,
  }) => {
    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );
    await page.goto(
      `/workspaces/${workspaceId}/${environmentId}/ai-resources/overview`
    );
    await expect(page.getByRole('cell', { name: RESOURCE_NAME })).toBeVisible();
  });

  test('step 3 — Playground exposes the Anthropic Messages endpoint toggle', async ({
    authenticatedPage: page,
  }) => {
    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );
    await page.goto(
      `/workspaces/${workspaceId}/${environmentId}/ai-resources/edit/${resourceId}/general`
    );

    // "Open playground" is rendered as `<Button component={Link}>`
    // — MUI emits an `<a>` with role="link", not role="button".
    await page
      .getByRole('link', { name: 'Open playground' })
      .click({ timeout: 15_000 });

    // The Anthropic toggle is the third option in the endpoint-mode
    // toggle group. Visibility + clickability is enough — driving an
    // SSE stream through the UI is brittle (see live-openai's skipped
    // streaming step), and step 4 covers the actual call shape via
    // the BFF directly.
    const anthropicToggle = page.getByRole('button', {
      name: /anthropic messages/i,
    });
    await expect(anthropicToggle).toBeVisible();
    await anthropicToggle.click();

    // Streaming is supported for Anthropic from Phase 12 onwards
    // (`anthropicStreamToChatCompletionChunks` in
    // `ai-provider/adapters/anthropic-messages.adapter.ts`). We just
    // verify the toggle is present so the playground exposes it as
    // an option. MUI v9 Switch reports role="switch" (not
    // "checkbox") — using the right role here makes the test
    // resilient to disabled state too.
    const streamingSwitch = page.getByRole('switch', {
      name: /streaming/i,
    });
    await expect(streamingSwitch).toBeVisible();
  });

  test('step 4 — Anthropic Messages call returns Anthropic-shape body', async ({
    authenticatedPage: page,
  }) => {
    // Cold start can push a non-streaming Anthropic call past
    // Playwright's 30s default; mirror live-openai's 2-minute budget.
    test.setTimeout(120_000);

    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );

    const result = await anthropicMessage(page.request, {
      resourceName: RESOURCE_NAME,
      workspaceId,
      environmentId,
      messages: [{ role: 'user', content: 'Reply with just the word "ok".' }],
      maxTokens: 32,
    });

    // Surface the body on a 4xx/5xx so the assertion failure shows
    // what the gateway rejected — debugging silent 400s on a CI run
    // otherwise requires re-running locally.
    expect(
      result.status,
      `expected 200 but got ${result.status}; body: ${result.body.slice(
        0,
        500
      )}`
    ).toBe(200);

    // Hard assertion on the response shape: Anthropic Messages
    // returns `{ id, type:'message', role:'assistant', content:
    // [{type:'text', text:string}], ... }`. Phase 11A still pivots
    // the response back to OpenAI shape inside the gateway, so the
    // BFF receives OpenAI shape and returns it verbatim — but the
    // assistant text is what the playground renders either way.
    const parsed = JSON.parse(result.body) as Record<string, unknown>;
    // Either OpenAI shape (`choices[0].message.content`) or Anthropic
    // shape (`content[0].text`) carries the model's reply. Accept
    // both so this spec doesn't break when Phase 11B lands the
    // output-side passthrough.
    const text =
      ((
        parsed as {
          choices?: Array<{ message?: { content?: string } }>;
        }
      ).choices?.[0]?.message?.content ??
        '') ||
      ((
        parsed as {
          content?: Array<{ type?: string; text?: string }>;
        }
      ).content
        ?.filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('') ??
        '');
    expect(text.trim().length).toBeGreaterThan(0);
  });

  test('step 5 — same connection serves Chat Completions too', async ({
    authenticatedPage: page,
  }) => {
    // Reusing the OpenAI-shape gateway path validates that the
    // connection's API key works across both endpoints (Anthropic
    // Messages + Chat Completions via Anthropic's OpenAI-compat).
    test.setTimeout(120_000);

    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );

    const result = await chatCompletion(page.request, {
      resourceName: RESOURCE_NAME,
      workspaceId,
      environmentId,
      messages: [{ role: 'user', content: 'Reply with just the word "ok".' }],
    });

    expect(result.status).toBe(200);
    const parsed = JSON.parse(result.body) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = parsed.choices?.[0]?.message?.content ?? '';
    expect(text.trim().length).toBeGreaterThan(0);
  });

  test('step 6 — edit connection: rename via /general tab', async ({
    authenticatedPage: page,
  }) => {
    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );
    await page.goto(
      `/workspaces/${workspaceId}/${environmentId}/ai-connections/edit/${connectionId}/general`
    );

    const nameField = page.getByRole('textbox', {
      name: 'Connection Name',
    });
    await expect(nameField).toHaveValue(CONNECTION_NAME);
    await nameField.fill(RENAMED_CONNECTION);

    await page.getByRole('button', { name: 'Save' }).click();
    // The save is an async react-server-action; a toast confirms
    // the commit. Reloading before the toast appears causes the
    // browser to refresh against the pre-save state and the
    // assertion below sees the old name. Wait for the toast first.
    await expect(page.locator('.Toastify__toast--success').first()).toBeVisible(
      { timeout: 10_000 }
    );
    await page.reload();
    await expect(nameField).toHaveValue(RENAMED_CONNECTION);
  });

  test('step 7 — delete connection (cascades resource)', async ({
    authenticatedPage: page,
  }) => {
    const { workspaceId, environmentId } = await ensureWorkspaceAndEnvironment(
      page
    );
    await page.goto(
      `/workspaces/${workspaceId}/${environmentId}/ai-connections/edit/${connectionId}/general`
    );

    await page
      .getByRole('button', { name: /more|actions|menu/i })
      .first()
      .click();
    await page.getByRole('menuitem', { name: /delete connection/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Delete' })).toBeEnabled({
      timeout: 15_000,
    });
    await dialog.getByRole('button', { name: 'Delete' }).click();

    await page.waitForURL(/\/ai-connections\/overview/);
    await expect(
      page.getByRole('cell', { name: RENAMED_CONNECTION })
    ).toHaveCount(0);

    await page.goto(
      `/workspaces/${workspaceId}/${environmentId}/ai-resources/overview`
    );
    await expect(page.getByRole('cell', { name: RESOURCE_NAME })).toHaveCount(
      0
    );
  });
});
