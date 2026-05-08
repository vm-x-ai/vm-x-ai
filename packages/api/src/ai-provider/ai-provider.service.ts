import { HttpStatus, Injectable } from '@nestjs/common';
import { OpenAIProvider } from './openai';
import { GeminiProvider } from './gemini';
import { GroqProvider } from './groq';
import { PerplexityProvider } from './perplexity';
import { AnthropicProvider } from './anthropic';
import { AWSBedrockInvokeProvider } from './aws-bedrock-invoke';
import { CompletionProvider } from './ai-provider.types';
import { throwServiceError } from '../error';
import { ErrorCode } from '../error-code';
import { AIProviderDto } from './dto/ai-provider.dto';
import { AWSBedrockProvider } from './aws-bedrock-converse';
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
    private readonly awsBedrockInvokeProvider: AWSBedrockInvokeProvider,
    private readonly perplexityProvider: PerplexityProvider,
    private readonly configService: ConfigService
  ) {
    this.providers[openaiProvider.provider.id] = this.openaiProvider;
    this.providers[anthropicProvider.provider.id] = this.anthropicProvider;
    this.providers[groqProvider.provider.id] = this.groqProvider;
    this.providers[geminiProvider.provider.id] = this.geminiProvider;
    this.providers[awsBedrockProvider.provider.id] = this.awsBedrockProvider;
    this.providers[awsBedrockInvokeProvider.provider.id] =
      this.awsBedrockInvokeProvider;
    this.providers[perplexityProvider.provider.id] = this.perplexityProvider;
  }

  public getAll(): AIProviderDto[] {
    const baseUrl = this.configService.getOrThrow<string>('BASE_URL');
    const basePath = this.configService.getOrThrow<string>('BASE_PATH');

    return Object.values(this.providers).map((provider) => {
      const { url, darkUrl } = provider.provider.config.logo;
      return {
        ...provider.provider,
        config: {
          ...provider.provider.config,
          logo: {
            ...provider.provider.config.logo,
            url: `${baseUrl}${basePath}${url}`,
            ...(darkUrl ? { darkUrl: `${baseUrl}${basePath}${darkUrl}` } : {}),
          },
        },
      };
    });
  }

  public get(id: string): CompletionProvider {
    if (!this.providers[id]) {
      throwServiceError(HttpStatus.NOT_FOUND, ErrorCode.AI_PROVIDER_NOT_FOUND, {
        id,
      });
    }

    return this.providers[id];
  }

  public async getByIds(ids: string[]): Promise<CompletionProvider[]> {
    if (ids.length === 0) return [];
    return await ids.map((id) => this.providers[id]);
  }
}
