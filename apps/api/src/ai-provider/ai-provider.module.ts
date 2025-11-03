import { Module } from '@nestjs/common';
import { OpenAIProvider } from './openai/openai.provider';
import { AIProviderService } from './ai-provider.service';
import { AIProviderController } from './ai-provider.controller';

@Module({
  imports: [],
  controllers: [AIProviderController],
  providers: [OpenAIProvider, AIProviderService],
  exports: [AIProviderService],
})
export class AIProviderModule {}
