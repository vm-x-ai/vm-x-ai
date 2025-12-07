import { ColumnType } from 'kysely';

export type Timestamp = ColumnType<Date, Date | string, Date | string>;

export interface Completion {
  ts: Timestamp;

  promptTokens: number | null;
  completionTokens: number | null;
  tokensPerSecond: number | null;
  totalTokens: number | null;
  timeToFirstToken: number | null;
  requestCount: number | null;
  errorCount: number | null;
  successCount: number | null;
  
  requestDuration: number | null;
  providerDuration: number | null;
  gateDuration: number | null;
  routingDuration: number | null;

  workspaceId: string;
  environmentId: string;
  connectionId: string | null;
  resourceId: string | null;
  provider: string | null;
  model: string | null;
  requestId: string;
  messageId: string | null;
  failureReason: string | null;
  statusCode: number;
  correlationId: string | null;
  apiKeyId: string | null;
  sourceIp: string;
  userId: string | null;
}

export interface DB {
  completions: Completion;
}
