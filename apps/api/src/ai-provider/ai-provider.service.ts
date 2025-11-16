import { HttpStatus, Injectable } from '@nestjs/common';
import { OpenAIProvider } from './providers/openai.provider';
import { CompletionProvider } from './ai-provider.types';
import { throwServiceError } from '../error';
import { ErrorCode } from '../error-code';
import { AIProviderDto } from './dto/ai-provider.dto';
import { AnthropicProvider } from './providers/anthropic.provider';
import { GroqProvider } from './providers/groq.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { AWSBedrockProvider } from './providers/aws-bedrock.provider';
@Injectable()
export class AIProviderService {
  private readonly providers: Record<string, CompletionProvider> = {};

  constructor(
    private readonly openaiProvider: OpenAIProvider,
    private readonly anthropicProvider: AnthropicProvider,
    private readonly groqProvider: GroqProvider,
    private readonly geminiProvider: GeminiProvider,
    private readonly awsBedrockProvider: AWSBedrockProvider
  ) {
    this.providers[openaiProvider.provider.id] = this.openaiProvider;
    this.providers[anthropicProvider.provider.id] = this.anthropicProvider;
    this.providers[groqProvider.provider.id] = this.groqProvider;
    this.providers[geminiProvider.provider.id] = this.geminiProvider;
    this.providers[awsBedrockProvider.provider.id] = this.awsBedrockProvider;
  }

  public getAll(): AIProviderDto[] {
    return Object.values(this.providers).map((provider) => provider.provider);
  }

  public get(id: string): CompletionProvider {
    if (!this.providers[id]) {
      throwServiceError(HttpStatus.NOT_FOUND, ErrorCode.AI_PROVIDER_NOT_FOUND, {
        id,
      });
    }

    return this.providers[id];
  }
}
