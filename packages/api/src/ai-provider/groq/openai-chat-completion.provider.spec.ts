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
    // OpenAI SDK exposes `baseURL` as a public field on the instance.
    expect(client.baseURL).toContain('api.groq.com');
  });
});
