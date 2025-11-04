import { HttpStatus } from '@nestjs/common';
import { CompletionHeaders } from '../ai-provider/ai-provider.types';

export type CompletionErrorData = {
  openAICompatibleError: {
    code?: string | null;
    type?: string | null;
    param?: string | null;
  };
  headers?: CompletionHeaders;
  message: string;
  rate: boolean;
  statusCode: HttpStatus;
  retryable: boolean;
  retryDelay?: number;
  failureReason?: string;
};

export class CompletionError extends Error {
  constructor(public readonly data: CompletionErrorData, cause?: unknown) {
    super(data.message);
    this.name = 'CompletionError';
    this.cause = cause;
  }
}
