import { describe, expect, it, vi } from 'vitest';
import OpenAI from 'openai';
import { PerplexityChatCompletionProvider } from './openai-chat-completion.provider';
import { PinoLogger } from 'nestjs-pino';
import type { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import type { OpenAIConnectionConfig } from '../openai/shared';

/**
 * Class-layer test for {@link PerplexityChatCompletionProvider}. It only
 * overrides `createClient` to point at Perplexity's OpenAI-compat baseURL;
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
    config: { apiKey: 'pplx-test' },
  } as unknown as AIConnectionEntity<OpenAIConnectionConfig>;
}

class TestablePerplexityProvider extends PerplexityChatCompletionProvider {
  public callCreateClient(
    connection: AIConnectionEntity<OpenAIConnectionConfig>
  ): Promise<OpenAI> {
    return this.createClient(connection);
  }
}

describe('PerplexityChatCompletionProvider', () => {
  it('createClient points at the Perplexity OpenAI-compat baseURL', async () => {
    const provider = new TestablePerplexityProvider(makeLogger());
    const client = await provider.callCreateClient(makeConnection());
    expect(client).toBeInstanceOf(OpenAI);
    // Pin the *exact* baseURL. A regression that drops to a bare host
    // or accidentally adds a versioned path (Perplexity does NOT have
    // an `/openai/v1` prefix like Groq does) would still pass a loose
    // `toContain('api.perplexity.ai')` assertion but break every
    // chat-completion request.
    expect(client.baseURL).toBe('https://api.perplexity.ai');
  });

  it('createClient rejects when the connection config has no API key', async () => {
    // The shared `createOpenAIClient` factory enforces this invariant
    // for every OpenAI-compat sibling (OpenAI, Gemini, Groq, Perplexity).
    // Pinning here guards against a future Perplexity-specific override
    // that forgets to delegate (e.g. instantiating `new OpenAI(...)`
    // directly).
    const provider = new TestablePerplexityProvider(makeLogger());
    const noKey = {
      connectionId: 'conn-no-key',
      config: { apiKey: '' },
    } as unknown as Parameters<typeof provider.callCreateClient>[0];
    await expect(provider.callCreateClient(noKey)).rejects.toThrow();
  });
});
