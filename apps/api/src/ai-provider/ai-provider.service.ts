import { HttpStatus, Injectable } from '@nestjs/common';
import { OpenAIProvider } from './openai/openai.provider';
import { CompletionProvider } from './ai-provider.types';
import { throwServiceError } from '../error';
import { ErrorCode } from '../error-code';
import { AIProviderDto } from './dto/ai-provider.dto';

@Injectable()
export class AIProviderService {
  private readonly providers: Record<string, CompletionProvider> = {};

  constructor(private readonly openaiProvider: OpenAIProvider) {
    this.providers[openaiProvider.provider.id] = this.openaiProvider;
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
