# UI End-to-End Tests

Playwright suite that drives the VM-X dashboard against a running stack.

## Prerequisites

The suite needs:

- The API on `http://localhost:3030/api` (configurable via `API_ORIGIN`)
- The UI on `http://localhost:3001` (configurable via `BASE_URL`)
- The seed admin user from migration 1: `admin@example.com` / `admin`
  - The first run walks through the `CHANGE_PASSWORD` flow and sets the
    new password to `Admin1234!`. Subsequent runs reuse it.
  - Override via `E2E_USER_EMAIL`, `E2E_USER_PASSWORD`, `E2E_NEW_PASSWORD`.

The Playwright config will start the UI dev server automatically if it's
not already running (it reuses an existing one when available — see
`webServer.reuseExistingServer`).

## Running

```bash
# Default — runs all specs in Chromium with video recording on
pnpm exec nx run ui:e2e

# Headed (watch the browser drive)
pnpm exec nx run ui:e2e --headed

# Single spec
pnpm exec nx run ui:e2e -- e2e/tests/theme-toggle.spec.ts

# Faster local iteration (disable video for speed)
PWVIDEO=off pnpm exec nx run ui:e2e

# Open the HTML report after a run
pnpm exec playwright show-report packages/ui/playwright-report
```

## Reports

After every run, four artifact streams land under `packages/ui/`:

| Artifact                | Where                                             | When                                                                         |
| ----------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------- |
| Per-test videos (.webm) | `test-output/playwright/output/<test>/video.webm` | Always (config: `video: 'on'`)                                               |
| **Consolidated video**  | `test-output/playwright/run.webm`                 | Always — every per-test clip stitched into one file (lossless ffmpeg concat) |
| Screenshots             | `test-output/playwright/output/<test>/`           | Only on failure                                                              |
| Traces                  | `test-output/playwright/output/<test>/trace.zip`  | Only on retry                                                                |
| HTML report             | `playwright-report/index.html`                    | Always (embeds video+trace; top sticky banner links to `run.webm`)           |

`pnpm exec playwright show-trace test-output/playwright/output/.../trace.zip`
opens a failure trace in the Playwright Inspector for step-by-step debugging.

The browser viewport (and recorded video) are set to **1920×1080** so the
dashboard's wide filter rows (Insights → Audit, Usage → metadata
group-by) fit on screen — Chromium's default 1280×720 silently clips the
right edge.

### Consolidated `run.webm`

A custom reporter (`e2e/run-video-reporter.ts`) runs after the HTML
reporter and:

1. Sorts every `video.webm` clip alphabetically (which matches the
   Playwright run order for spec files) and concatenates them with
   `ffmpeg -f concat -c copy` (lossless, near-instant).
2. Writes the result to `test-output/playwright/run.webm` and copies a
   second copy into `playwright-report/run.webm`.
3. Injects a sticky top banner into the HTML report linking to that
   file with both a `download` link and an inline `<video controls>`.

If `ffmpeg` is missing the suite still passes — the reporter just logs
a warning and skips the consolidation. Disable entirely with
`PWVIDEO=off`.

## Database reset

`globalTeardown` (`e2e/global-teardown.ts`) runs after every full
suite invocation and rolls back every Kysely migration to zero, then
re-applies them. That gives the **next** run a clean baseline so order
dependencies between specs (and stale data from previous runs) can't
masquerade as flakes.

Cost: ~1s on a warm Postgres. Disable for ad-hoc debugging with
`PWNO_DB_RESET=1`.

The reset is gated on the API side to `localhost` + `NODE_ENV=local|test`
— see `packages/api/src/migrations/base.ts`.

## Coverage

End-to-end means real APIs — the suite goes through the dashboard, the
NestJS backend, Postgres, and (for the live spec) a real provider. There
is no mocking layer.

| Spec                           | What it checks                                                                                                                                                                                                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/auth.spec.ts`           | Unauth redirect to OIDC; full login flow lands on dashboard                                                                                                                                                                                                                                                   |
| `tests/navigation.spec.ts`     | Sidebar entries, account menu logout, environment-tab navigation, workspace selector in app bar                                                                                                                                                                                                               |
| `tests/theme-toggle.spec.ts`   | Dark toggle flips `data-dark`, body bg, persists across reload                                                                                                                                                                                                                                                |
| `tests/scalar-docs.spec.ts`    | `/api/docs` (Scalar) renders; `/api/docs-json` exposes Responses API path + CompletionDimensions enum                                                                                                                                                                                                         |
| `tests/workspaces.spec.ts`     | Getting-started flow creates workspace + environment + default API key; workspace/environment list and edit pages render                                                                                                                                                                                      |
| `tests/ai-connections.spec.ts` | AI Connection list + Quick / Advanced create form toggle, provider list, fields                                                                                                                                                                                                                               |
| `tests/ai-resources.spec.ts`   | AI Resource list                                                                                                                                                                                                                                                                                              |
| `tests/prioritization.spec.ts` | Pool definition table headers, Add Pool reveals an inline create row                                                                                                                                                                                                                                          |
| `tests/security.spec.ts`       | Security overview lists the auto-generated Default API key; create role form fields                                                                                                                                                                                                                           |
| `tests/insights.spec.ts`       | Audit page filters (date, resource, connection, status, metadata, group-by) + dropdown values; Usage page sections + filters                                                                                                                                                                                  |
| `tests/sdk.spec.ts`            | Environment Details surfaces ids; OpenAI Adapter language tabs (Node/Python/cURL) render and switch                                                                                                                                                                                                           |
| `tests/settings.spec.ts`       | Settings → Roles list + create form; Settings → Users list (admin visible) + create form                                                                                                                                                                                                                      |
| `tests/playground.spec.ts`     | AI Resources overview reachable                                                                                                                                                                                                                                                                               |
| `tests/live-openai.spec.ts`    | **Live OpenAI roundtrip** — Advanced create connection → auto-resource visible → playground Chat Completions stream → playground Responses-API stream → connection rename → connection delete (cascades resource). Runs against a real OpenAI account using `OPENAI_API_KEY` from the workspace `.env.local`. |

## Live mode

`tests/live-openai.spec.ts` drives the same `.env.local` as the API
integration suite. The keys it expects (read at test time, **not**
checked in):

- `OPENAI_API_KEY` — required; spec skips silently when missing.
- `OPENAI_TEST_MODEL` — optional override (default: the OpenAI provider's
  `defaultModel`, currently `gpt-4.1`).

To override per-run:

```bash
OPENAI_TEST_MODEL=gpt-4o-mini pnpm exec nx run ui:e2e
```

The spec creates uniquely-named connections (`e2e-openai-<timestamp>`)
so re-runs don't collide on the unique constraint, and step 6 cleans
up by deleting the connection (cascades the auto-resource). Test runs
that fail mid-flight may leave a stray `e2e-openai-…` connection
around; delete it from the dashboard or grep the `ai_connection` table.

Future expansion ideas: per-provider live specs mirroring the API
integration suite (Anthropic, Bedrock Invoke, Perplexity, Gemini), each
exercising the matching provider through the playground.

## What's not covered yet

- **Tool calls / structured output through the playground UI** — the
  playground only exposes plain text input, so the tool-call surface
  is exercised by the API integration tests, not e2e.
- **Audit metadata filter values dropdown** — the values combobox is
  gated on observed metadata keys (per-key). Once `live-openai`
  routinely seeds metadata, we can hard-assert the dropdown opens.
- **Multi-browser** — Chromium only. Firefox/WebKit are commented out
  in `playwright.config.ts`; uncomment for cross-browser regressions.
