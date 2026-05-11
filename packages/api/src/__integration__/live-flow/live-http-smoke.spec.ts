import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { hasKeys } from '../helpers/env';
import {
  createLiveHttpHarness,
  discoverSeedProviders,
  gatewayUrls,
  type LiveHttpHarness,
} from '../helpers/live-http-harness';

/**
 * Smoke test for the full-stack live HTTP harness. Boots the real
 * `AppModule` (Postgres + Redis), seeds a workspace + environment +
 * connection + resource + API key, and hits one endpoint
 * end-to-end against a real upstream provider. Verifies the harness
 * itself works before the bigger per-endpoint specs build on it.
 *
 * Skips when no `*_API_KEY` env var is present — graceful local
 * degradation. Costs one upstream call per run when keys are set.
 */

const SHOULD_RUN =
  hasKeys('OPENAI_API_KEY') ||
  hasKeys('ANTHROPIC_API_KEY') ||
  hasKeys('GEMINI_API_KEY');

describe.skipIf(!SHOULD_RUN)('Live HTTP harness smoke', () => {
  let harness: LiveHttpHarness;

  beforeAll(async () => {
    harness = await createLiveHttpHarness();
  });

  afterAll(async () => {
    if (harness) await harness.cleanup();
  });

  it('POST /chat/completions hits a real provider end-to-end', async () => {
    const providers = discoverSeedProviders();
    const provider = providers.find((p) => p.enabled);
    if (!provider) return; // skipIf above catches this
    const urls = gatewayUrls(harness);

    const res = await harness.app.inject({
      method: 'POST',
      url: urls.chatCompletions,
      headers: { Authorization: `Bearer ${harness.apiKey}` },
      payload: {
        model: provider.resourceName,
        messages: [
          { role: 'user', content: 'Reply with the single word: pong' },
        ],
        max_tokens: 16,
        temperature: 0,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as {
      choices: Array<{ message: { content: string | null } }>;
      usage?: { total_tokens?: number };
    };
    expect(body.choices?.[0]?.message?.content).toBeTruthy();
    expect(body.usage?.total_tokens).toBeGreaterThan(0);
  });
});
