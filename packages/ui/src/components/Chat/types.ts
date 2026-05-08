import { UIMessage } from 'ai';

export type ChatMessageMetadata = {
  model: string;
  provider: string;
  connectionId: string;
  /**
   * Gateway-assigned request id (the value the API returns on the
   * `x-vmx-request-id` response header). The playground uses this to
   * deep-link a chat reply to its audit row.
   */
  requestId: string;
};

export type ChatMessage = UIMessage<ChatMessageMetadata>;
