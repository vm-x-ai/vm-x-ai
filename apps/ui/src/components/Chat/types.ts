import { UIMessage } from 'ai';

export type ChatMessageMetadata = {
  model: string;
  provider: string;
  connectionId: string;
};

export type ChatMessage = UIMessage<ChatMessageMetadata>;
