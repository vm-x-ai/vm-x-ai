import { AIConnectionEntity } from '../ai-connection/entities/ai-connection.entity';
import { AIResourceModelConfigEntity } from '../ai-resource/common/model.entity';
import { AIProviderRateLimitDto } from './dto/rate-limit.dto';
import { Observable } from 'rxjs';
import { AIProviderDto } from './dto/ai-provider.dto';
import { ChatCompletionCreateParams } from 'openai/resources/index.js';
import OpenAI from 'openai';

export type CompletionHeaders = {
  'x-request-id'?: string;
  'x-ratelimit-limit-requests'?: string;
  'x-ratelimit-limit-tokens'?: string;
  'x-ratelimit-remaining-requests'?: string;
  'x-ratelimit-remaining-tokens'?: string;
  'x-ratelimit-reset-requests'?: string;
  'x-ratelimit-reset-tokens'?: string;
};

export type CompletionObservableData = {
  data:
    | OpenAI.Chat.Completions.ChatCompletion
    | OpenAI.Chat.Completions.ChatCompletionChunk;
  headers: CompletionHeaders;
};

export interface CompletionProvider {
  provider: AIProviderDto;

  getRateLimit(
    connection: AIConnectionEntity,
    modelConfig: AIResourceModelConfigEntity
  ): Promise<AIProviderRateLimitDto[] | null>;

  completion(
    request: ChatCompletionCreateParams,
    connection: AIConnectionEntity,
    model: AIResourceModelConfigEntity,
    observable: Observable<CompletionObservableData>
  ): Promise<void>;
}
