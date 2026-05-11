import { describe, expect, it } from 'vitest';
import { responseResponsesToAnthropic } from '../../ai-provider/openai/anthropic-messages.provider';

/**
 * T15: `output_tokens_details.reasoning_tokens` was read into a local
 * but never written to the returned Anthropic-shape usage. Cost
 * tracking under-reported reasoning spend on every Anth→OpenAI
 * Responses round-trip. The fix surfaces the nested detail.
 */

describe('Resp→Anth response usage carries reasoning_tokens (T15)', () => {
  it('exposes reasoning_tokens via output_tokens_details on usage', () => {
    const anth = responseResponsesToAnthropic(
      {
        id: 'resp_1',
        output: [],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          output_tokens_details: { reasoning_tokens: 30 },
        },
      } as never,
      'claude'
    );
    const usage = anth.usage as
      | { output_tokens_details?: { reasoning_tokens?: number } }
      | undefined;
    expect(usage?.output_tokens_details?.reasoning_tokens).toBe(30);
  });

  it('omits output_tokens_details when no reasoning_tokens reported', () => {
    const anth = responseResponsesToAnthropic(
      {
        id: 'resp_1',
        output: [],
        usage: { input_tokens: 100, output_tokens: 50 },
      } as never,
      'claude'
    );
    const usage = anth.usage as { output_tokens_details?: unknown } | undefined;
    expect(usage?.output_tokens_details).toBeUndefined();
  });
});
