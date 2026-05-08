import { test, expect } from '@playwright/test';

/**
 * Scalar API reference is served by the backend at `/api/docs`, not by the
 * UI. We hit the API origin directly (the test base URL is the UI but
 * Playwright lets us navigate anywhere).
 */

const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:3030';

test.describe('Scalar API reference', () => {
  test('renders without the Fastify "res.send" crash', async ({ page }) => {
    const resp = await page.goto(`${API_ORIGIN}/api/docs`);
    expect(resp?.status()).toBe(200);

    // The Scalar bundle injects an element with id #app once it boots.
    // We don't need to wait for full render — just confirm we got HTML
    // (not the JSON error payload from the Fastify regression we hit
    // before adding `withFastify: true`).
    const ct = resp?.headers()['content-type'] ?? '';
    expect(ct).toContain('text/html');
  });

  test('OpenAPI spec is reachable at /api/docs-json', async ({ request }) => {
    const resp = await request.get(`${API_ORIGIN}/api/docs-json`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body).toMatchObject({ openapi: expect.any(String) });
    // Schemas we should now be exposing post-LiteLLM-parity.
    expect(body.components.schemas).toHaveProperty('RequestDimensions');
    expect(body.paths).toHaveProperty(
      '/api/v1/completion/{workspaceId}/{environmentId}/responses'
    );
  });
});
