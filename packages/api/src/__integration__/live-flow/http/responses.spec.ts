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
 * `POST /completion/:ws/:env/responses`.
 *
 * Goes through Fastify routing + DTO validation + auth + controller
 * + ResponsesService + provider class → real upstream. OpenAI is the
 * primary surface here since the Responses API is OpenAI-native;
 * cross-provider conversion (Gemini → Responses, Anthropic →
 * Responses) is exercised by `__integration__/responses/end-to-end`.
 */

const SHOULD_RUN = hasKeys('OPENAI_API_KEY');

type ResponsesResponse = {
  id: string;
  object: string;
  output: Array<{
    type: string;
    role?: string;
    content?: Array<{ type: string; text?: string }>;
    name?: string;
    arguments?: string;
  }>;
  usage?: { total_tokens?: number };
};

describe.skipIf(!SHOULD_RUN)('POST /responses (live HTTP)', () => {
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
  it('simple request returns 200 + Response shape with output array', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: urls.responses,
      headers: { Authorization: `Bearer ${harness.apiKey}` },
      payload: {
        model: provider.resourceName,
        input: 'Reply with the single word: pong',
        max_output_tokens: 16,
        temperature: 0,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as ResponsesResponse;
    expect(Array.isArray(body.output)).toBe(true);
    expect(body.output.length).toBeGreaterThan(0);
    const message = body.output.find((o) => o.type === 'message');
    expect(message?.content?.[0]?.text).toBeTruthy();
  });

  it('multi-message input items pass through and preserve context', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: urls.responses,
      headers: { Authorization: `Bearer ${harness.apiKey}` },
      payload: {
        model: provider.resourceName,
        input: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'My name is Lucas.' }],
          },
          {
            type: 'message',
            role: 'assistant',
            content: [
              { type: 'output_text', text: 'Hello, Lucas. How can I help?' },
            ],
          },
          {
            type: 'message',
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: 'Reply with my name and nothing else.',
              },
            ],
          },
        ],
        max_output_tokens: 16,
        temperature: 0,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as ResponsesResponse;
    const message = body.output.find((o) => o.type === 'message');
    expect(message?.content?.[0]?.text?.toLowerCase()).toContain('lucas');
  });

  it('instructions field acts as system prompt', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: urls.responses,
      headers: { Authorization: `Bearer ${harness.apiKey}` },
      payload: {
        model: provider.resourceName,
        input: 'say hello',
        instructions: 'Reply ONLY in ALL CAPS.',
        max_output_tokens: 16,
        temperature: 0,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as ResponsesResponse;
    const text =
      body.output.find((o) => o.type === 'message')?.content?.[0]?.text ?? '';
    expect(text.replace(/[^a-zA-Z]/g, '')).toMatch(/^[A-Z]+$/);
  });

  it('tools array (function tool) returns function_call output', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: urls.responses,
      headers: { Authorization: `Bearer ${harness.apiKey}` },
      payload: {
        model: provider.resourceName,
        input: "What's the weather in Tokyo?",
        tools: [
          {
            type: 'function',
            name: 'get_weather',
            description: 'Get current weather for a city',
            parameters: {
              type: 'object',
              properties: {
                location: { type: 'string', description: 'City name' },
              },
              required: ['location'],
            },
          },
        ],
        tool_choice: 'required',
        max_output_tokens: 64,
        temperature: 0,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as ResponsesResponse;
    const fc = body.output.find((o) => o.type === 'function_call');
    expect(fc?.name).toBe('get_weather');
  });

  // ─── Streaming ────────────────────────────────────────────────────
  it('streaming returns text/event-stream + emits typed events', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: urls.responses,
      headers: { Authorization: `Bearer ${harness.apiKey}` },
      payload: {
        model: provider.resourceName,
        input: 'Reply with the single word: pong',
        stream: true,
        max_output_tokens: 16,
        temperature: 0,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    // Each typed frame must carry an `event:` line per the
    // Responses streaming spec.
    expect(res.payload).toContain('event: response.created');
    expect(res.payload).toContain('event: response.completed');
  });

  // ─── Auth + validation ───────────────────────────────────────────
  it('missing Authorization → 401', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: urls.responses,
      payload: {
        model: provider.resourceName,
        input: 'hi',
        max_output_tokens: 8,
      },
    });
    expect(res.statusCode).toBe(401);
  });
});
