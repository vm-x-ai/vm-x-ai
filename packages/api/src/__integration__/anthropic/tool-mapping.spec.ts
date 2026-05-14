import { describe, expect, it } from 'vitest';
import { requestAnthropicToResponses } from '../../ai-provider/openai/anthropic-messages.provider';
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';
import type {
  ResponseInputItem,
  Tool as ResponsesTool,
} from 'openai/resources/responses/responses.js';

/**
 * Anth→Resp tool / tool_result mapping.
 *
 * - `tool_result.content` arrays must survive intact: text folds back
 *   to a string for the common case, but non-text parts (images) emit
 *   the array form of `function_call_output.output` so the tool's
 *   multimodal payload reaches the next turn.
 * - Anthropic's `Tool` shares `strict` and `defer_loading` with the
 *   Responses `function` tool; both must propagate rather than being
 *   hard-coded to `null` / dropped.
 */

describe('Anth→Resp tool_result content mapping', () => {
  it('string content passes through verbatim as `output: string`', () => {
    const out = requestAnthropicToResponses({
      model: 'claude',
      max_tokens: 64,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_1',
              content: '15 °C, partly cloudy',
            },
          ],
        },
      ],
    } as AnthropicMessagesRequest);
    const items = out.input as ResponseInputItem[];
    const fco = items.find(
      (i) => (i as { type?: string }).type === 'function_call_output'
    ) as { output?: unknown } | undefined;
    expect(fco?.output).toBe('15 °C, partly cloudy');
  });

  it('text-only array content folds to a single string (cheap wire form)', () => {
    const out = requestAnthropicToResponses({
      model: 'claude',
      max_tokens: 64,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_1',
              content: [
                { type: 'text', text: 'part-a;' },
                { type: 'text', text: 'part-b' },
              ],
            },
          ],
        },
      ],
    } as AnthropicMessagesRequest);
    const items = out.input as ResponseInputItem[];
    const fco = items.find(
      (i) => (i as { type?: string }).type === 'function_call_output'
    ) as { output?: unknown } | undefined;
    // Both parts concatenated, no array wrapping.
    expect(fco?.output).toBe('part-a;part-b');
  });

  it('mixed text + image content emits the input_text / input_image array', () => {
    const out = requestAnthropicToResponses({
      model: 'claude',
      max_tokens: 64,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_1',
              content: [
                { type: 'text', text: 'see chart:' },
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: 'AAAA',
                  },
                },
              ],
            },
          ],
        },
      ],
    } as AnthropicMessagesRequest);
    const items = out.input as ResponseInputItem[];
    const fco = items.find(
      (i) => (i as { type?: string }).type === 'function_call_output'
    ) as { output?: unknown } | undefined;
    expect(Array.isArray(fco?.output)).toBe(true);
    const arr = fco?.output as Array<{ type: string; [k: string]: unknown }>;
    expect(arr).toHaveLength(2);
    expect(arr[0]).toMatchObject({ type: 'input_text', text: 'see chart:' });
    expect(arr[1]).toMatchObject({
      type: 'input_image',
      image_url: 'data:image/png;base64,AAAA',
    });
  });

  it('URL-source images become input_image with the verbatim url', () => {
    const out = requestAnthropicToResponses({
      model: 'claude',
      max_tokens: 64,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_1',
              content: [
                {
                  type: 'image',
                  source: { type: 'url', url: 'https://cdn.example/p.png' },
                },
              ],
            },
          ],
        },
      ],
    } as AnthropicMessagesRequest);
    const items = out.input as ResponseInputItem[];
    const fco = items.find(
      (i) => (i as { type?: string }).type === 'function_call_output'
    ) as { output?: unknown } | undefined;
    expect(fco?.output).toEqual([
      { type: 'input_image', image_url: 'https://cdn.example/p.png' },
    ]);
  });
});

describe('Anth→Resp function tool mapping', () => {
  it('forwards `strict` from Anthropic Tool to Responses function tool', () => {
    const out = requestAnthropicToResponses({
      model: 'claude',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'go' }],
      tools: [
        {
          name: 'lookup',
          description: 'd',
          input_schema: { type: 'object', properties: {} },
          strict: true,
        },
      ],
    } as AnthropicMessagesRequest);
    expect(out.tools).toBeDefined();
    const t = out.tools![0] as ResponsesTool & { strict?: boolean | null };
    expect(t.strict).toBe(true);
  });

  it('forwards `defer_loading` when set', () => {
    const out = requestAnthropicToResponses({
      model: 'claude',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'go' }],
      tools: [
        {
          name: 'lookup',
          description: 'd',
          input_schema: { type: 'object', properties: {} },
          defer_loading: true,
        },
      ],
    } as AnthropicMessagesRequest);
    const t = out.tools![0] as ResponsesTool & { defer_loading?: boolean };
    expect(t.defer_loading).toBe(true);
  });

  it('omits `defer_loading` when the Anthropic tool did not set it', () => {
    const out = requestAnthropicToResponses({
      model: 'claude',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'go' }],
      tools: [
        {
          name: 'lookup',
          description: 'd',
          input_schema: { type: 'object', properties: {} },
        },
      ],
    } as AnthropicMessagesRequest);
    const t = out.tools![0] as ResponsesTool & { defer_loading?: boolean };
    expect('defer_loading' in t).toBe(false);
  });

  it('leaves `strict` as `null` when the Anthropic tool did not set it', () => {
    // Letting `strict` be `null` lets the upstream apply its own
    // default rather than us forcing one direction.
    const out = requestAnthropicToResponses({
      model: 'claude',
      max_tokens: 64,
      messages: [{ role: 'user', content: 'go' }],
      tools: [
        {
          name: 'lookup',
          description: 'd',
          input_schema: { type: 'object', properties: {} },
        },
      ],
    } as AnthropicMessagesRequest);
    const t = out.tools![0] as ResponsesTool & { strict?: boolean | null };
    expect(t.strict).toBeNull();
  });
});
