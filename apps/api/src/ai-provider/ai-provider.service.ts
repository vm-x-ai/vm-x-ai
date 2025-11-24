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
import { ConfigService } from '@nestjs/config';
@Injectable()
export class AIProviderService {
  private readonly providers: Record<string, CompletionProvider> = {};

  constructor(
    private readonly openaiProvider: OpenAIProvider,
    private readonly anthropicProvider: AnthropicProvider,
    private readonly groqProvider: GroqProvider,
    private readonly geminiProvider: GeminiProvider,
    private readonly awsBedrockProvider: AWSBedrockProvider,
    private readonly configService: ConfigService
  ) {
    this.providers[openaiProvider.provider.id] = this.openaiProvider;
    this.providers[anthropicProvider.provider.id] = this.anthropicProvider;
    this.providers[groqProvider.provider.id] = this.groqProvider;
    this.providers[geminiProvider.provider.id] = this.geminiProvider;
    this.providers[awsBedrockProvider.provider.id] = this.awsBedrockProvider;
  }

  public getAll(): AIProviderDto[] {
    const baseUrl = this.configService.get('BASE_URL');
    return Object.values(this.providers).map((provider) => ({
      ...provider.provider,
      config: {
        ...provider.provider.config,
        logo: {
          ...provider.provider.config.logo,
          url: `${baseUrl}${provider.provider.config.logo.url}`,
        },
      },
    }));
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
