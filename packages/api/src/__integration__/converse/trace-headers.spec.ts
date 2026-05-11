import { describe, expect, it } from 'vitest';
import { extractConverseTraceHeaders } from '../../ai-provider/aws-bedrock-converse/shared';
import type { ConverseCommandOutput } from '@aws-sdk/client-bedrock-runtime';

/**
 * T24: surface Bedrock observability fields on the gateway headers
 * stream so the audit pipeline records `latencyMs` and the
 * actually-invoked model when a prompt router is in use.
 */

describe('extractConverseTraceHeaders (T24)', () => {
  it('emits x-request-id from metadata', () => {
    const headers = extractConverseTraceHeaders({
      $metadata: { requestId: 'req-1' },
    } as ConverseCommandOutput);
    expect(headers['x-request-id']).toBe('req-1');
  });

  it('emits x-bedrock-latency-ms from metrics.latencyMs', () => {
    const headers = extractConverseTraceHeaders({
      $metadata: {},
      metrics: { latencyMs: 432 },
    } as ConverseCommandOutput);
    expect(headers['x-bedrock-latency-ms']).toBe('432');
  });

  it('emits x-bedrock-invoked-model-id from trace.promptRouter', () => {
    const headers = extractConverseTraceHeaders({
      $metadata: {},
      trace: {
        promptRouter: {
          invokedModelId:
            'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-haiku-4-5-v1:0',
        },
      },
    } as unknown as ConverseCommandOutput);
    expect(headers['x-bedrock-invoked-model-id']).toBe(
      'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-haiku-4-5-v1:0'
    );
  });

  it('emits all three headers together when all fields are present', () => {
    const headers = extractConverseTraceHeaders({
      $metadata: { requestId: 'req-2' },
      metrics: { latencyMs: 100 },
      trace: { promptRouter: { invokedModelId: 'm-1' } },
    } as unknown as ConverseCommandOutput);
    expect(headers).toEqual({
      'x-request-id': 'req-2',
      'x-bedrock-latency-ms': '100',
      'x-bedrock-invoked-model-id': 'm-1',
    });
  });

  it('returns an empty object when response is undefined', () => {
    expect(extractConverseTraceHeaders(undefined)).toEqual({});
  });
});
