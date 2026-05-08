import OpenAI from 'openai';
import { AIConnectionEntity } from '../../ai-connection/entities/ai-connection.entity';
import { CompletionHeaders } from '../ai-provider.types';
import { throwServiceError } from '../../error';
import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../error-code';

export type OpenAIConnectionConfig = {
  apiKey: string;
};

/**
 * Precompiled regexes for `parseDuration`. We hit this on every
 * RateLimit error path, so building a fresh `RegExp(...)` per unit
 * per call is pure allocation churn.
 *
 * `ms` must come before `s` so the `s` regex (`s(?!\w)`) doesn't
 * shadow it — `\w` excludes letters but the unit-matching loop runs
 * each entry independently against the full string.
 */
const DURATION_UNITS: Array<{ unit: string; ms: number; regex: RegExp }> = [
  { unit: 'h', ms: 3_600_000, regex: /(\d+(?:\.\d+)?)h(?!\w)/ },
  { unit: 'm', ms: 60_000, regex: /(\d+(?:\.\d+)?)m(?!\w)/ },
  { unit: 'ms', ms: 1, regex: /(\d+(?:\.\d+)?)ms(?!\w)/ },
  { unit: 's', ms: 1_000, regex: /(\d+(?:\.\d+)?)s(?!\w)/ },
];

export async function createOpenAIClient(
  connection: AIConnectionEntity<OpenAIConnectionConfig>,
  baseURL?: string
): Promise<OpenAI> {
  const apiKey = connection.config?.apiKey?.trim();
  if (!apiKey) {
    throwServiceError(
      HttpStatus.BAD_REQUEST,
      ErrorCode.AI_CONNECTION_CONFIG_INVALID,
      {
        connectionId: connection.connectionId,
        error: 'API Key cannot be found in the AI connection config',
      }
    );
  }
  return new OpenAI(baseURL ? { apiKey, baseURL } : { apiKey });
}

export function filterRelevantHeaders(headers?: Headers): CompletionHeaders {
  if (!headers) return {};
  return Object.fromEntries(
    Array.from(headers.entries()).filter(([key]) => key.startsWith('x-'))
  );
}

export function extractRateLimitResetTime(headers?: Headers) {
  if (!headers) return { resetRequests: 0, resetTokens: 0 };
  const resetRequests = headers.get('x-ratelimit-reset-requests');
  const resetTokens = headers.get('x-ratelimit-reset-tokens');
  return {
    resetRequests: resetRequests ? parseDuration(resetRequests) : 0,
    resetTokens: resetTokens ? parseDuration(resetTokens) : 0,
  };
}

export function parseDuration(durationStr: string | undefined): number {
  if (!durationStr) return 0;
  let totalMillis = 0;
  // `ms` must be matched before `s` because `(?!\\w)` only excludes
  // letters, and the unit-matching regexes are run independently.
  // Don't return early — duration strings like `1m30s` need every
  // unit matched to compute the full delta.
  for (const { ms, regex } of DURATION_UNITS) {
    const match = regex.exec(durationStr);
    if (match) {
      const value = parseFloat(match[1]);
      if (Number.isFinite(value)) {
        totalMillis += value * ms;
      }
    }
  }
  return totalMillis;
}
