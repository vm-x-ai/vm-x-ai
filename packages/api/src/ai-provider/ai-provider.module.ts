import { Module } from '@nestjs/common';
import { AIProviderService } from './ai-provider.service';
import { AIProviderController } from './ai-provider.controller';

// 4-file-per-provider structure (per task.md decision D4). Each
// provider folder ships an `index.ts` composer + 3 format-specific
// `@Injectable` classes (+ optional `shared.ts` for transport). All
// four classes per provider are listed in `providers[]` so NestJS's
// DI graph resolves them.
import { OpenAIProvider } from './openai';
import { OpenAIChatCompletionProvider } from './openai/openai-chat-completion.provider';
import { OpenAIResponseProvider } from './openai/openai-response.provider';
import { OpenAIAnthropicMessagesProvider } from './openai/anthropic-messages.provider';

import { GeminiProvider } from './gemini';
import { GeminiChatCompletionProvider } from './gemini/openai-chat-completion.provider';
import { GeminiResponseProvider } from './gemini/openai-response.provider';
import { GeminiAnthropicMessagesProvider } from './gemini/anthropic-messages.provider';
import { GeminiDispatcher } from './gemini/shared';

import { GroqProvider } from './groq';
import { GroqChatCompletionProvider } from './groq/openai-chat-completion.provider';
import { GroqResponseProvider } from './groq/openai-response.provider';
import { GroqAnthropicMessagesProvider } from './groq/anthropic-messages.provider';

import { PerplexityProvider } from './perplexity';
import { PerplexityChatCompletionProvider } from './perplexity/openai-chat-completion.provider';
import { PerplexityResponseProvider } from './perplexity/openai-response.provider';
import { PerplexityAnthropicMessagesProvider } from './perplexity/anthropic-messages.provider';

import { AnthropicProvider } from './anthropic';
import { AnthropicDispatcher } from './anthropic/shared';
import { AnthropicOpenAICompletionProvider } from './anthropic/openai-chat-completion.provider';
import { AnthropicOpenAIResponseProvider } from './anthropic/openai-response.provider';
import { AnthropicMessagesProvider } from './anthropic/anthropic-messages.provider';

import { AWSBedrockInvokeProvider } from './aws-bedrock-invoke';
import { AWSBedrockInvokeDispatcher } from './aws-bedrock-invoke/shared';
import { AWSBedrockInvokeOpenAICompletionProvider } from './aws-bedrock-invoke/openai-chat-completion.provider';
import { AWSBedrockInvokeOpenAIResponseProvider } from './aws-bedrock-invoke/openai-response.provider';
import { AWSBedrockInvokeAnthropicMessagesProvider } from './aws-bedrock-invoke/anthropic-messages.provider';

import { AWSBedrockProvider } from './aws-bedrock-converse';
import { AWSBedrockConverseDispatcher } from './aws-bedrock-converse/shared';
import { AWSBedrockConverseOpenAICompletionProvider } from './aws-bedrock-converse/openai-chat-completion.provider';
import { AWSBedrockConverseOpenAIResponseProvider } from './aws-bedrock-converse/openai-response.provider';
import { AWSBedrockConverseAnthropicMessagesProvider } from './aws-bedrock-converse/anthropic-messages.provider';

@Module({
  imports: [],
  controllers: [AIProviderController],
  providers: [
    // OpenAI — 4-file structure
    OpenAIProvider,
    OpenAIChatCompletionProvider,
    OpenAIResponseProvider,
    OpenAIAnthropicMessagesProvider,

    // Gemini — 4-file structure (native @google/genai across all 3 inputs)
    GeminiProvider,
    GeminiDispatcher,
    GeminiChatCompletionProvider,
    GeminiResponseProvider,
    GeminiAnthropicMessagesProvider,

    // Groq — 4-file structure
    GroqProvider,
    GroqChatCompletionProvider,
    GroqResponseProvider,
    GroqAnthropicMessagesProvider,

    // Perplexity — 4-file structure
    PerplexityProvider,
    PerplexityChatCompletionProvider,
    PerplexityResponseProvider,
    PerplexityAnthropicMessagesProvider,

    // Anthropic — 4-file structure (+ shared dispatcher)
    AnthropicProvider,
    AnthropicDispatcher,
    AnthropicOpenAICompletionProvider,
    AnthropicOpenAIResponseProvider,
    AnthropicMessagesProvider,

    // AWS Bedrock-Invoke — 4-file structure (+ shared dispatcher)
    AWSBedrockInvokeProvider,
    AWSBedrockInvokeDispatcher,
    AWSBedrockInvokeOpenAICompletionProvider,
    AWSBedrockInvokeOpenAIResponseProvider,
    AWSBedrockInvokeAnthropicMessagesProvider,

    // AWS Bedrock-Converse — 4-file structure (+ shared dispatcher)
    AWSBedrockProvider,
    AWSBedrockConverseDispatcher,
    AWSBedrockConverseOpenAICompletionProvider,
    AWSBedrockConverseOpenAIResponseProvider,
    AWSBedrockConverseAnthropicMessagesProvider,

    AIProviderService,
  ],
  exports: [AIProviderService],
})
export class AIProviderModule {}
