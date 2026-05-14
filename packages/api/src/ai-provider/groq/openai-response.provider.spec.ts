import { describe, expect, it, vi } from 'vitest';
import OpenAI from 'openai';
import type { ResponseCreateParams } from 'openai/resources/responses/responses.js';
import {
  GroqResponseProvider,
  normalizeAssistantOutputTextForGroq,
} from './openai-response.provider';
import { PinoLogger } from 'nestjs-pino';
import type { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import type { OpenAIConnectionConfig } from '../openai/shared';

/**
 * Class-layer test for {@link GroqResponseProvider}. Groq exposes a
 * native OpenAI Responses-compatible endpoint at
 * `https://api.groq.com/openai/v1/responses`
 * (https://console.groq.com/docs/responses-api), so the cell only
 * overrides `createClient` to point the OpenAI SDK at Groq's baseURL.
 * The Responses handler itself — envelope strip, model substitution,
 * header forwarding, error mapping, `providerRequestPayload` capture —
 * is inherited verbatim from `OpenAIResponseProvider` and covered by
 * `openai/openai-response.provider.spec.ts`.
 */

function makeLogger(): PinoLogger {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    setContext: vi.fn(),
  } as unknown as PinoLogger;
}

function makeConnection(): AIConnectionEntity<OpenAIConnectionConfig> {
  return {
    connectionId: 'conn-1',
    config: { apiKey: 'gsk_test' },
  } as unknown as AIConnectionEntity<OpenAIConnectionConfig>;
}

class TestableGroqProvider extends GroqResponseProvider {
  public callCreateClient(
    connection: AIConnectionEntity<OpenAIConnectionConfig>
  ): Promise<OpenAI> {
    return this.createClient(connection);
  }
}

describe('GroqResponseProvider', () => {
  it('createClient instantiates an OpenAI SDK client with the Groq baseURL', async () => {
    const provider = new TestableGroqProvider(makeLogger());
    const client = await provider.callCreateClient(makeConnection());
    expect(client).toBeInstanceOf(OpenAI);
    // Pin the *full* OpenAI-compat path. Groq's Responses endpoint
    // lives at `/openai/v1/responses` — a regression that dropped the
    // path suffix and pointed at the bare host would 404 on every
    // request but a looser `toContain('api.groq.com')` would still
    // pass.
    expect(client.baseURL).toBe('https://api.groq.com/openai/v1');
  });

  it('createClient rejects when the connection config has no API key', async () => {
    // The shared `createOpenAIClient` factory enforces this invariant
    // for every OpenAI-compat sibling (OpenAI, Gemini, Groq,
    // Perplexity). Pinning here guards against a future Groq-specific
    // override that forgets to delegate (e.g. instantiating
    // `new OpenAI(...)` directly).
    const provider = new TestableGroqProvider(makeLogger());
    const noKey = {
      connectionId: 'conn-no-key',
      config: { apiKey: '' },
    } as unknown as Parameters<typeof provider.callCreateClient>[0];
    await expect(provider.callCreateClient(noKey)).rejects.toThrow();
  });
});

describe('normalizeAssistantOutputTextForGroq', () => {
  it('flattens typed `output_text` parts on assistant messages to a plain string', () => {
    const req: ResponseCreateParams = {
      model: 'm',
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
            { type: 'output_text', text: 'Hello ' },
            { type: 'output_text', text: 'Lucas.' },
          ],
        } as never,
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'What is my name?' }],
        },
      ] as never,
    };
    const out = normalizeAssistantOutputTextForGroq(req);
    const items = out.input as unknown as Array<Record<string, unknown>>;
    // User messages stay untouched (typed input_text is accepted by Groq).
    expect(items[0]).toEqual(req.input![0]);
    expect(items[2]).toEqual(req.input![2]);
    // Assistant message flattens to a plain string content.
    expect(items[1]).toEqual({
      type: 'message',
      role: 'assistant',
      content: 'Hello Lucas.',
    });
  });

  it('leaves the request untouched when input is a string', () => {
    const req: ResponseCreateParams = { model: 'm', input: 'hello' };
    expect(normalizeAssistantOutputTextForGroq(req)).toBe(req);
  });

  it('preserves assistant messages whose content is already a string', () => {
    const req: ResponseCreateParams = {
      model: 'm',
      input: [
        { type: 'message', role: 'assistant', content: 'hello' },
      ] as never,
    };
    const out = normalizeAssistantOutputTextForGroq(req);
    expect(out).toBe(req);
  });

  it('does not touch user messages with typed `input_text` content', () => {
    const req: ResponseCreateParams = {
      model: 'm',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'hi' }],
        },
      ] as never,
    };
    const out = normalizeAssistantOutputTextForGroq(req);
    expect(out).toBe(req);
  });

  it('leaves assistant messages whose content contains non-text parts alone (avoids dropping refusals/images)', () => {
    // If a future model emits a refusal part or an image, we must not
    // silently lose it — the flatten only fires when EVERY part is a
    // plain `output_text`. Otherwise we leave the message for the
    // upstream to handle (which today means a 400; the right fix is
    // per-part mapping, not a lossy collapse).
    const req: ResponseCreateParams = {
      model: 'm',
      input: [
        {
          type: 'message',
          role: 'assistant',
          content: [
            { type: 'output_text', text: 'partial' },
            { type: 'refusal', refusal: 'I cannot help.' },
          ],
        } as never,
      ],
    };
    const out = normalizeAssistantOutputTextForGroq(req);
    expect(out).toBe(req);
  });

  it('does not touch function_call / function_call_output items', () => {
    const req: ResponseCreateParams = {
      model: 'm',
      input: [
        {
          type: 'function_call',
          id: 'fc_1',
          call_id: 'tu_1',
          name: 'get_weather',
          arguments: '{}',
          status: 'completed',
        },
        {
          type: 'function_call_output',
          call_id: 'tu_1',
          output: '15 °C',
        },
      ] as never,
    };
    const out = normalizeAssistantOutputTextForGroq(req);
    expect(out).toBe(req);
  });
});
