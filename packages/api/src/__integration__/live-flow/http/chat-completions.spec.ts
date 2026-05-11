import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasKeys } from '../../helpers/env';
import {
  createLiveHttpHarness,
  discoverSeedProviders,
  gatewayUrls,
  type LiveHttpHarness,
  type SeedProviderConfig,
} from '../../helpers/live-http-harness';
import type { ChatCompletion } from 'openai/resources/index.js';

/**
 * **Live** end-to-end HTTP integration tests for
 * `POST /completion/:ws/:env/chat/completions`.
 *
 * Goes through the full Fastify routing + DTO validation + auth +
 * controller + completion service + provider class → real upstream
 * provider HTTP. Boots the real `AppModule` once per file via the
 * live HTTP harness.
 *
 * Each test makes one real upstream call with a small `max_tokens`
 * cap (16) and a deterministic prompt to keep cost minimal. Provider
 * coverage is OpenAI-only here — the cross-provider matrix is owned
 * by the per-provider specs in `__integration__/providers/`.
 */

const SHOULD_RUN = hasKeys('OPENAI_API_KEY');

describe.skipIf(!SHOULD_RUN)('POST /chat/completions (live HTTP)', () => {
  let harness: LiveHttpHarness;
  let provider: SeedProviderConfig;
  let urls: ReturnType<typeof gatewayUrls>;

  beforeAll(async () => {
    harness = await createLiveHttpHarness();
    const seeded = discoverSeedProviders().find(
      (p) => p.providerId === 'openai' && p.enabled
    );
    if (!seeded) throw new Error('expected OpenAI seed (gated by skipIf)');
    provider = seeded;
    urls = gatewayUrls(harness);
  });

  afterAll(async () => {
    if (harness) await harness.cleanup();
  });

  // ─── Non-streaming ────────────────────────────────────────────────
  it('simple completion returns 200 + assistant content', async () => {
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
    const body = JSON.parse(res.payload) as ChatCompletion;
    expect(body.choices[0]?.message?.content).toBeTruthy();
    expect(body.usage?.total_tokens).toBeGreaterThan(0);
  });

  it('multi-message conversation preserves context', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: urls.chatCompletions,
      headers: { Authorization: `Bearer ${harness.apiKey}` },
      payload: {
        model: provider.resourceName,
        messages: [
          { role: 'user', content: 'My name is Lucas.' },
          { role: 'assistant', content: 'Hello, Lucas. How can I help?' },
          { role: 'user', content: 'Reply with my name and nothing else.' },
        ],
        max_tokens: 16,
        temperature: 0,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as ChatCompletion;
    expect(body.choices[0]?.message?.content?.toLowerCase()).toContain('lucas');
  });

  it('system prompt steers the model', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: urls.chatCompletions,
      headers: { Authorization: `Bearer ${harness.apiKey}` },
      payload: {
        model: provider.resourceName,
        messages: [
          { role: 'system', content: 'Reply ONLY in ALL CAPS.' },
          { role: 'user', content: 'say hello' },
        ],
        max_tokens: 16,
        temperature: 0,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as ChatCompletion;
    const text = body.choices[0]?.message?.content ?? '';
    // The model occasionally adds punctuation ("HELLO!"), so check
    // the alphabetic chars are upper-cased rather than equality.
    expect(text.replace(/[^a-zA-Z]/g, '')).toMatch(/^[A-Z]+$/);
  });

  it('tool calling returns tool_calls + finish_reason=tool_calls', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: urls.chatCompletions,
      headers: { Authorization: `Bearer ${harness.apiKey}` },
      payload: {
        model: provider.resourceName,
        messages: [{ role: 'user', content: "What's the weather in Tokyo?" }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get current weather for a city',
              parameters: {
                type: 'object',
                properties: {
                  location: {
                    type: 'string',
                    description: 'City name',
                  },
                },
                required: ['location'],
              },
            },
          },
        ],
        tool_choice: 'required',
        max_tokens: 64,
        temperature: 0,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as ChatCompletion;
    expect(body.choices[0]?.finish_reason).toBe('tool_calls');
    const tc = body.choices[0]?.message?.tool_calls?.[0] as
      | { function?: { name?: string } }
      | undefined;
    expect(tc?.function?.name).toBe('get_weather');
  });

  // ─── Streaming ────────────────────────────────────────────────────
  it('streaming returns text/event-stream + emits chunks + [DONE]', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: urls.chatCompletions,
      headers: { Authorization: `Bearer ${harness.apiKey}` },
      payload: {
        model: provider.resourceName,
        messages: [
          { role: 'user', content: 'Reply with the single word: pong' },
        ],
        stream: true,
        max_tokens: 16,
        temperature: 0,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    // SSE wire shape: each chunk on its own `data:` line + `[DONE]`.
    expect(res.payload).toContain('data: {');
    expect(res.payload.trim().endsWith('data: [DONE]')).toBe(true);
    // Final chunk should carry a finish_reason.
    expect(res.payload).toContain('"finish_reason"');
  });

  // ─── Auth + validation ───────────────────────────────────────────
  it('missing Authorization → 401', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: urls.chatCompletions,
      payload: {
        model: provider.resourceName,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 8,
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it('non-UUID workspaceId is rejected (4xx)', async () => {
    // Guards run before param validation, so a bogus workspaceId is
    // first caught by `ApiKeyGuard` (no matching key for that
    // workspace → 401) before the `ParseUUIDPipe` would 400. Either
    // is a correct rejection — we just assert the request never
    // reaches the provider.
    const res = await harness.app.inject({
      method: 'POST',
      url: '/completion/not-a-uuid/00000000-0000-4000-8000-000000000002/chat/completions',
      headers: { Authorization: `Bearer ${harness.apiKey}` },
      payload: {
        model: provider.resourceName,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 8,
      },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });

  it('unknown resource name → 401 (auth fails to resolve resource)', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: urls.chatCompletions,
      headers: { Authorization: `Bearer ${harness.apiKey}` },
      payload: {
        model: 'this-resource-does-not-exist',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 8,
      },
    });
    expect(res.statusCode).toBe(401);
  });
});
