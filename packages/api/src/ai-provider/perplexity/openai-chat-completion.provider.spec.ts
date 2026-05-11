import { describe, expect, it, vi } from 'vitest';
import OpenAI from 'openai';
import { PerplexityChatCompletionProvider } from './openai-chat-completion.provider';
import { PinoLogger } from 'nestjs-pino';
import type { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import type { OpenAIConnectionConfig } from '../openai/shared';

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
    expect(client.baseURL).toContain('api.perplexity.ai');
  });
});
