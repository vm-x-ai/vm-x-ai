import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { OpenAIChatCompletionProvider } from '../openai/openai-chat-completion.provider';
import {
  type OpenAIConnectionConfig,
  createOpenAIClient,
} from '../openai/shared';

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

@Injectable()
export class GroqChatCompletionProvider extends OpenAIChatCompletionProvider {
  protected override createClient(
    connection: AIConnectionEntity<OpenAIConnectionConfig>
  ): Promise<OpenAI> {
    return createOpenAIClient(connection, GROQ_BASE_URL);
  }
}
