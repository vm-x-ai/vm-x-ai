import { describe, expect, it } from 'vitest';
import {
  assertModelSupportsFeatures,
  modelSupportsTools,
} from '../../ai-provider/aws-bedrock-converse/capability-gate';
import { CompletionError } from '../../gateway/completion.types';

/**
 * T19: minimal capability gate refuses Bedrock requests that send
 * tools to a no-tool-support model — turning Bedrock's opaque 400
 * "ValidationException: this model doesn't support tool use" into a
 * clear gateway-side error.
 */

describe('assertModelSupportsFeatures (T19)', () => {
  it.each([
    'amazon.titan-text-large-v1',
    'mistral.mistral-7b-instruct-v0:2',
    'mistral.mixtral-8x7b-instruct-v0:1',
    'meta.llama3-8b-instruct-v1:0',
    'meta.llama3-70b-instruct-v1:0',
    'meta.llama3-2-1b-instruct-v1:0',
    'meta.llama3-2-3b-instruct-v1:0',
    'deepseek.deepseek-r1-v1:0',
    'us.deepseek.deepseek-r1-v1:0',
  ])('throws CompletionError 400 when sending tools to %s', (modelId) => {
    expect(() =>
      assertModelSupportsFeatures(modelId, { tools: true })
    ).toThrowError(CompletionError);
  });

  it('lets tools-supporting models through silently', () => {
    expect(() =>
      assertModelSupportsFeatures(
        'us.anthropic.claude-haiku-4-5-20251001-v1:0',
        { tools: true }
      )
    ).not.toThrow();
    expect(() =>
      assertModelSupportsFeatures('amazon.nova-pro-v1:0', { tools: true })
    ).not.toThrow();
    expect(() =>
      assertModelSupportsFeatures('meta.llama4-maverick-17b-instruct-v1:0', {
        tools: true,
      })
    ).not.toThrow();
  });

  it('is a no-op when no features are requested', () => {
    expect(() =>
      assertModelSupportsFeatures('amazon.titan-text-large-v1', {})
    ).not.toThrow();
  });

  it('error carries the bedrock-specific code', () => {
    try {
      assertModelSupportsFeatures('amazon.titan-text-large-v1', {
        tools: true,
      });
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(CompletionError);
      const ce = err as CompletionError;
      expect(ce.data.statusCode).toBe(400);
      expect(ce.data.openAICompatibleError?.code).toBe(
        'bedrock_model_does_not_support_tools'
      );
    }
  });

  it('modelSupportsTools direct check matches the assertion', () => {
    expect(modelSupportsTools('amazon.titan-text-large-v1')).toBe(false);
    expect(modelSupportsTools('us.anthropic.claude-haiku-4-5')).toBe(true);
  });
});
