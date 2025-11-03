import { AIConnectionEntity } from '../ai-connection/entities/ai-connection.entity';
import { AIResourceModelConfigEntity } from '../ai-resource/common/model.entity';
import { AIProviderRateLimitDto } from './dto/rate-limit.dto';
import { Observable } from 'rxjs';
import { AIProviderDto } from './dto/ai-provider.dto';
import { ChatCompletionCreateParams } from 'openai/resources/index.js';
import OpenAI from 'openai';

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
    observable: Observable<
      | OpenAI.Chat.Completions.ChatCompletion
      | OpenAI.Chat.Completions.ChatCompletionChunk
    >
  ): Promise<void>;
}
