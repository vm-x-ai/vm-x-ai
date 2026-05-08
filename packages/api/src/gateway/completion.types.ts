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
  /**
   * The body the provider's SDK saw on the wire (post-conversion or
   * verbatim on passthrough), captured pre-flight. Surfaces on the
   * audit row's `providerRequestPayload` even when the SDK throws —
   * lets ops debug provider parsing issues without re-running the
   * request.
   *
   * Set by every provider implementation immediately before the SDK
   * call so it's available to every error path. CompletionService
   * reads it off the caught error and passes to the audit push site.
   */
  providerRequestPayload?: unknown;
};

export class CompletionError extends Error {
  constructor(public readonly data: CompletionErrorData, cause?: unknown) {
    super(data.message);
    this.name = 'CompletionError';
    this.cause = cause;
  }
}
