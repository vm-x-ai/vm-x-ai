import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasKeys } from '../../helpers/env';
import {
  createLiveHttpHarness,
  discoverSeedProviders,
  gatewayUrls,
  type LiveHttpHarness,
  type SeedProviderConfig,
} from '../../helpers/live-http-harness';

/**
 * **Live** end-to-end HTTP integration tests for
 * `POST /completion/:ws/:env/anthropic/messages`.
 *
 * Goes through Fastify routing + DTO validation + auth + controller
 * + AnthropicMessagesService + provider class → real Anthropic API.
 * Native Anthropic is the primary surface here; cross-provider
 * conversion (OpenAI → anthropic, Gemini → anthropic, etc.) is
 * exercised by the live-flow `anthropic-messages.spec.ts` provider
 * matrix.
 */

const SHOULD_RUN = hasKeys('ANTHROPIC_API_KEY');

type AnthropicMessage = {
  id: string;
  type: string;
  role: string;
  model: string;
  content: Array<{
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  }>;
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number };
};

describe.skipIf(!SHOULD_RUN)('POST /anthropic/messages (live HTTP)', () => {
  let harness: LiveHttpHarness;
  let provider: SeedProviderConfig;
  let urls: ReturnType<typeof gatewayUrls>;

  beforeAll(async () => {
    harness = await createLiveHttpHarness();
    const seeded = discoverSeedProviders().find(
      (p) => p.providerId === 'anthropic' && p.enabled
    );
    if (!seeded) throw new Error('expected Anthropic seed (gated by skipIf)');
    provider = seeded;
    urls = gatewayUrls(harness);
  });

  afterAll(async () => {
    if (harness) await harness.cleanup();
  });

  // ─── Non-streaming ────────────────────────────────────────────────
  it('simple message returns 200 + Anthropic Message shape', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: urls.anthropicMessages,
      headers: { Authorization: `Bearer ${harness.apiKey}` },
      payload: {
        model: provider.resourceName,
        max_tokens: 32,
        messages: [
          { role: 'user', content: 'Reply with the single word: pong' },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as AnthropicMessage;
    expect(body.role).toBe('assistant');
    expect(body.type).toBe('message');
    const text = body.content.find((c) => c.type === 'text')?.text ?? '';
    expect(text).toBeTruthy();
    expect(body.usage.input_tokens).toBeGreaterThan(0);
    expect(body.usage.output_tokens).toBeGreaterThan(0);
  });

  it('multi-message conversation preserves context', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: urls.anthropicMessages,
      headers: { Authorization: `Bearer ${harness.apiKey}` },
      payload: {
        model: provider.resourceName,
        max_tokens: 32,
        messages: [
          { role: 'user', content: 'My name is Lucas.' },
          { role: 'assistant', content: 'Hello, Lucas. How can I help?' },
          { role: 'user', content: 'Reply with my name and nothing else.' },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as AnthropicMessage;
    const text =
      body.content.find((c) => c.type === 'text')?.text?.toLowerCase() ?? '';
    expect(text).toContain('lucas');
  });

  it('top-level system field steers the model', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: urls.anthropicMessages,
      headers: { Authorization: `Bearer ${harness.apiKey}` },
      payload: {
        model: provider.resourceName,
        max_tokens: 32,
        system: 'Reply ONLY in ALL CAPS.',
        messages: [{ role: 'user', content: 'say hello' }],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as AnthropicMessage;
    const text = body.content.find((c) => c.type === 'text')?.text ?? '';
    expect(text.replace(/[^a-zA-Z]/g, '')).toMatch(/^[A-Z]+$/);
  });

  it('tools array forwards; tool_use response shape passes back', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: urls.anthropicMessages,
      headers: { Authorization: `Bearer ${harness.apiKey}` },
      payload: {
        model: provider.resourceName,
        max_tokens: 256,
        messages: [{ role: 'user', content: "What's the weather in Tokyo?" }],
        tools: [
          {
            name: 'get_weather',
            description: 'Get the current weather in a city',
            input_schema: {
              type: 'object',
              properties: {
                location: { type: 'string', description: 'City name' },
              },
              required: ['location'],
            },
          },
        ],
        tool_choice: { type: 'any' },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as AnthropicMessage;
    const tu = body.content.find((c) => c.type === 'tool_use');
    expect(tu?.name).toBe('get_weather');
    expect(body.stop_reason).toBe('tool_use');
  });

  // ─── Streaming (T3: every typed frame has an event: line) ────────
  it('streaming returns text/event-stream + every frame has event: line', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: urls.anthropicMessages,
      headers: { Authorization: `Bearer ${harness.apiKey}` },
      payload: {
        model: provider.resourceName,
        max_tokens: 32,
        messages: [
          { role: 'user', content: 'Reply with the single word: pong' },
        ],
        stream: true,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    // Anthropic streaming envelope — every typed frame must carry
    // `event: <type>\ndata: ...`.
    expect(res.payload).toContain('event: message_start');
    expect(res.payload).toContain('event: content_block_start');
    expect(res.payload).toContain('event: content_block_delta');
    expect(res.payload).toContain('event: message_stop');
  });

  // ─── Auth + validation ───────────────────────────────────────────
  it('missing Authorization → 401', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: urls.anthropicMessages,
      payload: {
        model: provider.resourceName,
        max_tokens: 8,
        messages: [{ role: 'user', content: 'hi' }],
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it('missing max_tokens → 400 (Anthropic-required field)', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: urls.anthropicMessages,
      headers: { Authorization: `Bearer ${harness.apiKey}` },
      payload: {
        model: provider.resourceName,
        messages: [{ role: 'user', content: 'hi' }],
      },
    });
    expect(res.statusCode).toBe(400);
  });
});
