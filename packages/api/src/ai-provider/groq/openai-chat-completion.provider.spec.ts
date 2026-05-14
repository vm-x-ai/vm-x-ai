import { describe, expect, it, vi } from 'vitest';
import OpenAI from 'openai';
import { GroqChatCompletionProvider } from './openai-chat-completion.provider';
import { PinoLogger } from 'nestjs-pino';
import type { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import type { OpenAIConnectionConfig } from '../openai/shared';

/**
 * Class-layer test for {@link GroqChatCompletionProvider}. It only
 * overrides `createClient` to point at Groq's OpenAI-compat baseURL;
 * the base behaviour is covered by `openai/openai-chat-completion.provider.spec.ts`.
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

class TestableGroqProvider extends GroqChatCompletionProvider {
  // expose the protected createClient for assertion.
  public callCreateClient(
    connection: AIConnectionEntity<OpenAIConnectionConfig>
  ): Promise<OpenAI> {
    return this.createClient(connection);
  }
}

describe('GroqChatCompletionProvider', () => {
  it('createClient instantiates an OpenAI SDK client with the Groq baseURL', async () => {
    const provider = new TestableGroqProvider(makeLogger());
    const client = await provider.callCreateClient(makeConnection());
    expect(client).toBeInstanceOf(OpenAI);
    // Pin the *full* OpenAI-compat path. Groq's chat completions live
    // at `/openai/v1` — a regression that dropped the path suffix and
    // pointed at the bare host would 404 on every request but a looser
    // `toContain('api.groq.com')` would still pass.
    expect(client.baseURL).toBe('https://api.groq.com/openai/v1');
  });

  it('createClient rejects when the connection config has no API key', async () => {
    // The shared `createOpenAIClient` factory enforces this invariant
    // for every OpenAI-compat sibling (OpenAI, Gemini, Groq, Perplexity).
    // Pinning here guards against a future Groq-specific override that
    // forgets to delegate (e.g. instantiating `new OpenAI(...)` directly).
    const provider = new TestableGroqProvider(makeLogger());
    const noKey = {
      connectionId: 'conn-no-key',
      config: { apiKey: '' },
    } as unknown as Parameters<typeof provider.callCreateClient>[0];
    await expect(provider.callCreateClient(noKey)).rejects.toThrow();
  });
});
