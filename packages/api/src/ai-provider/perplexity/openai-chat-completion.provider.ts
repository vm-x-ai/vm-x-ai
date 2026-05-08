import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { OpenAIChatCompletionProvider } from '../openai/openai-chat-completion.provider';
import {
  type OpenAIConnectionConfig,
  createOpenAIClient,
} from '../openai/shared';

const PERPLEXITY_BASE_URL = 'https://api.perplexity.ai';

@Injectable()
export class PerplexityChatCompletionProvider extends OpenAIChatCompletionProvider {
  protected override createClient(
    connection: AIConnectionEntity<OpenAIConnectionConfig>
  ): Promise<OpenAI> {
    return createOpenAIClient(connection, PERPLEXITY_BASE_URL);
  }
}
