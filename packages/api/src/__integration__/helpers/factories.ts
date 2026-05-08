import { PinoLogger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { AIResourceModelConfigEntity } from '../../ai-resource/common/model.entity';
import { OpenAIProvider } from '../../ai-provider/openai';
import { OpenAIChatCompletionProvider } from '../../ai-provider/openai/openai-chat-completion.provider';
import { OpenAIResponseProvider } from '../../ai-provider/openai/openai-response.provider';
import { OpenAIAnthropicMessagesProvider } from '../../ai-provider/openai/anthropic-messages.provider';
import { GeminiProvider } from '../../ai-provider/gemini';
import { GeminiChatCompletionProvider } from '../../ai-provider/gemini/openai-chat-completion.provider';
import { GeminiResponseProvider } from '../../ai-provider/gemini/openai-response.provider';
import { GeminiAnthropicMessagesProvider } from '../../ai-provider/gemini/anthropic-messages.provider';
import { GroqProvider } from '../../ai-provider/groq';
import { GroqChatCompletionProvider } from '../../ai-provider/groq/openai-chat-completion.provider';
import { GroqResponseProvider } from '../../ai-provider/groq/openai-response.provider';
import { GroqAnthropicMessagesProvider } from '../../ai-provider/groq/anthropic-messages.provider';
import { PerplexityProvider } from '../../ai-provider/perplexity';
import { PerplexityChatCompletionProvider } from '../../ai-provider/perplexity/openai-chat-completion.provider';
import { PerplexityResponseProvider } from '../../ai-provider/perplexity/openai-response.provider';
import { PerplexityAnthropicMessagesProvider } from '../../ai-provider/perplexity/anthropic-messages.provider';
import { AnthropicProvider } from '../../ai-provider/anthropic';
import { AnthropicDispatcher } from '../../ai-provider/anthropic/shared';
import { AnthropicOpenAICompletionProvider } from '../../ai-provider/anthropic/openai-chat-completion.provider';
import { AnthropicOpenAIResponseProvider } from '../../ai-provider/anthropic/openai-response.provider';
import { AnthropicMessagesProvider } from '../../ai-provider/anthropic/anthropic-messages.provider';
import { AWSBedrockInvokeProvider } from '../../ai-provider/aws-bedrock-invoke';
import { AWSBedrockInvokeDispatcher } from '../../ai-provider/aws-bedrock-invoke/shared';
import { AWSBedrockInvokeOpenAICompletionProvider } from '../../ai-provider/aws-bedrock-invoke/openai-chat-completion.provider';
import { AWSBedrockInvokeOpenAIResponseProvider } from '../../ai-provider/aws-bedrock-invoke/openai-response.provider';
import { AWSBedrockInvokeAnthropicMessagesProvider } from '../../ai-provider/aws-bedrock-invoke/anthropic-messages.provider';
import { AWSBedrockProvider } from '../../ai-provider/aws-bedrock-converse';
import { AWSBedrockConverseDispatcher } from '../../ai-provider/aws-bedrock-converse/shared';
import { AWSBedrockConverseOpenAICompletionProvider } from '../../ai-provider/aws-bedrock-converse/openai-chat-completion.provider';
import { AWSBedrockConverseOpenAIResponseProvider } from '../../ai-provider/aws-bedrock-converse/openai-response.provider';
import { AWSBedrockConverseAnthropicMessagesProvider } from '../../ai-provider/aws-bedrock-converse/anthropic-messages.provider';

/**
 * No-op PinoLogger that satisfies the constructor signature used by
 * provider classes. We don't need real logging in integration tests.
 */
export function makeStubLogger(): PinoLogger {
  // PinoLogger's instance methods all accept varargs; route them to
  // console.error so visible failures are still readable.
  const noop = () => undefined;
  return {
    setContext: noop,
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: (...args: unknown[]) => console.error('[integration]', ...args),
    fatal: (...args: unknown[]) => console.error('[integration]', ...args),
    assign: noop,
    logger: undefined,
  } as unknown as PinoLogger;
}

/**
 * Tiny ConfigService stub returning sensible defaults for the only two
 * keys provider classes read at construct time (BASE_URL, BASE_PATH).
 */
export function makeStubConfigService(
  overrides: Record<string, string> = {}
): ConfigService {
  const defaults: Record<string, string> = {
    BASE_URL: 'http://localhost:3000',
    BASE_PATH: '',
    ...overrides,
  };
  return {
    get: (k: string) => defaults[k],
    getOrThrow: (k: string) => {
      const v = defaults[k];
      if (v === undefined) throw new Error(`Missing config: ${k}`);
      return v;
    },
  } as unknown as ConfigService;
}

/**
 * Build an AIConnectionEntity skeleton with the given config. Tests
 * pass this directly to provider.openAICompletion() — the entity isn't
 * persisted, so most fields just need to be present, not meaningful.
 */
export function makeConnection<T extends Record<string, unknown>>(
  provider: string,
  config: T
): AIConnectionEntity<T> {
  return {
    connectionId: '00000000-0000-0000-0000-000000000001',
    workspaceId: '00000000-0000-0000-0000-000000000002',
    environmentId: '00000000-0000-0000-0000-000000000003',
    name: `${provider}-test`,
    provider,
    description: null,
    config,
    capacity: [],
    discoveredCapacity: null,
    allowedModels: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: 'integration-test',
    updatedBy: 'integration-test',
  } as unknown as AIConnectionEntity<T>;
}

export function makeModel(
  provider: string,
  model: string
): AIResourceModelConfigEntity {
  return {
    provider,
    model,
    connectionId: '00000000-0000-0000-0000-000000000001',
  };
}

// Provider construction helpers — each returns a fresh instance so tests
// can be run in parallel safely.

// 4-file-per-provider constructors. Each provider's composer takes
// three @Injectable format-specific helpers; we instantiate them
// in-line with a stub logger so live-flow specs can target each
// composer directly.
export const buildOpenAIProvider = () => {
  const logger = makeStubLogger();
  const chat = new OpenAIChatCompletionProvider(logger);
  const response = new OpenAIResponseProvider(logger);
  return new OpenAIProvider(
    chat,
    response,
    new OpenAIAnthropicMessagesProvider(response)
  );
};

export const buildGeminiProvider = () => {
  const logger = makeStubLogger();
  const chat = new GeminiChatCompletionProvider(logger);
  return new GeminiProvider(
    chat,
    new GeminiResponseProvider(chat),
    new GeminiAnthropicMessagesProvider(chat)
  );
};

export const buildGroqProvider = () => {
  const logger = makeStubLogger();
  const chat = new GroqChatCompletionProvider(logger);
  return new GroqProvider(
    chat,
    new GroqResponseProvider(chat),
    new GroqAnthropicMessagesProvider(chat)
  );
};

export const buildPerplexityProvider = () => {
  const logger = makeStubLogger();
  const chat = new PerplexityChatCompletionProvider(logger);
  return new PerplexityProvider(
    chat,
    new PerplexityResponseProvider(chat),
    new PerplexityAnthropicMessagesProvider(chat)
  );
};

export const buildAnthropicProvider = () => {
  const logger = makeStubLogger();
  const dispatcher = new AnthropicDispatcher(logger);
  const chat = new AnthropicOpenAICompletionProvider(dispatcher);
  return new AnthropicProvider(
    chat,
    new AnthropicOpenAIResponseProvider(dispatcher),
    new AnthropicMessagesProvider(dispatcher)
  );
};

export const buildBedrockProvider = () => {
  const logger = makeStubLogger();
  const config = makeStubConfigService();
  const dispatcher = new AWSBedrockConverseDispatcher(logger, config);
  return new AWSBedrockProvider(
    config,
    new AWSBedrockConverseOpenAICompletionProvider(dispatcher),
    new AWSBedrockConverseOpenAIResponseProvider(dispatcher),
    new AWSBedrockConverseAnthropicMessagesProvider(dispatcher)
  );
};

export const buildBedrockInvokeProvider = () => {
  const logger = makeStubLogger();
  const config = makeStubConfigService();
  const dispatcher = new AWSBedrockInvokeDispatcher(logger, config);
  const chat = new AWSBedrockInvokeOpenAICompletionProvider(dispatcher);
  return new AWSBedrockInvokeProvider(
    chat,
    new AWSBedrockInvokeOpenAIResponseProvider(dispatcher),
    new AWSBedrockInvokeAnthropicMessagesProvider(dispatcher)
  );
};
