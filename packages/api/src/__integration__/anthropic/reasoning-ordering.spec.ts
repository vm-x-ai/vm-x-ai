import { describe, expect, it } from 'vitest';
import { requestAnthropicToResponses } from '../../ai-provider/openai/anthropic-messages.provider';
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';
import type { ResponseInputItem } from 'openai/resources/responses/responses.js';

/**
 * T16: the converter's comment promised "BEFORE the assistant
 * message" but the old code pushed reasoning items into a
 * `followUps` list appended after. The fix splits reasoning into a
 * dedicated bucket emitted ahead of the message item, matching the
 * contract.
 */

describe('Anth→Resp reasoning items emit BEFORE assistant message (T16)', () => {
  it('reasoning item precedes the message in the produced input[]', () => {
    const out = requestAnthropicToResponses({
      model: 'claude',
      max_tokens: 64,
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'thinking',
              thinking: 'thought process',
              signature: 'sig',
            },
            { type: 'text', text: 'visible answer' },
          ],
        },
      ],
    } as AnthropicMessagesRequest);
    const items = out.input as ResponseInputItem[];
    const types = items.map((i) => (i as { type?: string }).type);
    const reasoningIdx = types.indexOf('reasoning');
    const messageIdx = types.indexOf('message');
    expect(reasoningIdx).toBeGreaterThanOrEqual(0);
    expect(messageIdx).toBeGreaterThanOrEqual(0);
    expect(reasoningIdx).toBeLessThan(messageIdx);
  });

  it('redacted_thinking precedes the message too', () => {
    const out = requestAnthropicToResponses({
      model: 'claude',
      max_tokens: 64,
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'redacted_thinking', data: 'opaque' } as never,
            { type: 'text', text: 'answer' },
          ],
        },
      ],
    } as AnthropicMessagesRequest);
    const items = out.input as ResponseInputItem[];
    const types = items.map((i) => (i as { type?: string }).type);
    const reasoningIdx = types.indexOf('reasoning');
    const messageIdx = types.indexOf('message');
    expect(reasoningIdx).toBeLessThan(messageIdx);
  });

  it('tool_use trailing followups still come AFTER the message', () => {
    const out = requestAnthropicToResponses({
      model: 'claude',
      max_tokens: 64,
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'thinking',
              thinking: 't',
              signature: 's',
            },
            { type: 'text', text: 'about to call a tool' },
            {
              type: 'tool_use',
              id: 'tu_1',
              name: 'search',
              input: { q: 'cats' },
            },
          ],
        },
      ],
    } as AnthropicMessagesRequest);
    const items = out.input as ResponseInputItem[];
    const types = items.map((i) => (i as { type?: string }).type);
    expect(types).toEqual(['reasoning', 'message', 'function_call']);
  });
});
