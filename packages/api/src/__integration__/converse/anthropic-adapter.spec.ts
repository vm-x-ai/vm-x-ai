import { describe, expect, it } from 'vitest';
import {
  ConverseCommandOutput,
  ConverseStreamOutput,
  StopReason,
} from '@aws-sdk/client-bedrock-runtime';
import type { RawMessageStreamEvent } from '@anthropic-ai/sdk/resources/messages';
import {
  requestAnthropicToConverse,
  responseConverseToAnthropic,
  streamConverseToAnthropic,
} from '../../ai-provider/aws-bedrock-converse/anthropic-messages.provider';
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';

/**
 * Adapter unit tests for the direct Anthropic ↔ Converse converter
 * (canonical owner: `aws-bedrock-converse/anthropic-messages.provider.ts`).
 * Three pure functions, no SDK dependency.
 */

describe('Anthropic → Converse request adapter', () => {
  it('maps a simple user message to a Converse message with text content', () => {
    const out = requestAnthropicToConverse(
      {
        model: 'claude',
        max_tokens: 64,
        messages: [{ role: 'user', content: 'hello' }],
      } as AnthropicMessagesRequest,
      'us.anthropic.claude-haiku-4-5'
    );
    expect(out.modelId).toBe('us.anthropic.claude-haiku-4-5');
    expect(out.inferenceConfig?.maxTokens).toBe(64);
    expect(out.messages).toEqual([
      { role: 'user', content: [{ text: 'hello' }] },
    ]);
  });

  it('maps top-level system to Converse system blocks', () => {
    const out = requestAnthropicToConverse(
      {
        model: 'claude',
        max_tokens: 16,
        messages: [{ role: 'user', content: 'hi' }],
        system: 'be brief',
      } as AnthropicMessagesRequest,
      'm'
    );
    expect(out.system).toEqual([{ text: 'be brief' }]);
  });

  it('maps tool_use + tool_result content blocks', () => {
    const out = requestAnthropicToConverse(
      {
        model: 'claude',
        max_tokens: 16,
        messages: [
          { role: 'user', content: 'weather?' },
          {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'tu_1',
                name: 'get_weather',
                input: { location: 'Tokyo' },
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tu_1',
                content: '15 °C',
              },
            ],
          },
        ],
      } as AnthropicMessagesRequest,
      'm'
    );

    expect(out.messages?.[1]).toMatchObject({
      role: 'assistant',
      content: [
        {
          toolUse: {
            toolUseId: 'tu_1',
            name: 'get_weather',
            input: { location: 'Tokyo' },
          },
        },
      ],
    });
    expect(out.messages?.[2]).toMatchObject({
      role: 'user',
      content: [
        {
          toolResult: {
            toolUseId: 'tu_1',
            content: [{ text: '15 °C' }],
            status: 'success',
          },
        },
      ],
    });
  });

  it('maps Anthropic tools and tool_choice variants', () => {
    const out = requestAnthropicToConverse(
      {
        model: 'claude',
        max_tokens: 16,
        messages: [{ role: 'user', content: 'pong' }],
        tools: [
          {
            name: 'get_weather',
            description: 'Weather lookup',
            input_schema: {
              type: 'object',
              properties: { location: { type: 'string' } },
              required: ['location'],
            },
          },
        ],
        tool_choice: { type: 'auto' },
      } as AnthropicMessagesRequest,
      'm'
    );
    expect(out.toolConfig?.tools?.[0]).toMatchObject({
      toolSpec: { name: 'get_weather' },
    });
    expect(out.toolConfig?.toolChoice).toMatchObject({ auto: {} });
  });

  it('forwards top_k via additionalModelRequestFields', () => {
    const out = requestAnthropicToConverse(
      {
        model: 'claude',
        max_tokens: 16,
        messages: [{ role: 'user', content: 'pong' }],
        top_k: 50,
      } as AnthropicMessagesRequest,
      'm'
    );
    expect(out.additionalModelRequestFields).toMatchObject({ top_k: 50 });
  });
});

describe('Converse → Anthropic response adapter', () => {
  it('maps text + toolUse content blocks back to Anthropic blocks', () => {
    const resp: ConverseCommandOutput = {
      $metadata: { requestId: 'req_1', extendedRequestId: 'req_1' } as never,
      output: {
        message: {
          role: 'assistant',
          content: [
            { text: 'Tool result coming.' },
            {
              toolUse: {
                toolUseId: 'tu_1',
                name: 'get_weather',
                input: { location: 'Tokyo' },
              },
            },
          ],
        },
      },
      stopReason: StopReason.TOOL_USE,
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        cacheReadInputTokens: 0,
        cacheWriteInputTokens: 0,
      } as never,
      metrics: { latencyMs: 0 } as never,
    } as ConverseCommandOutput;

    const out = responseConverseToAnthropic(resp, 'claude-haiku-4-5');
    expect(out.type).toBe('message');
    expect(out.role).toBe('assistant');
    expect(out.stop_reason).toBe('tool_use');
    expect(out.content).toHaveLength(2);
    const tool = out.content.find(
      (b) => (b as { type?: string }).type === 'tool_use'
    );
    expect(tool).toMatchObject({
      type: 'tool_use',
      id: 'tu_1',
      name: 'get_weather',
      input: { location: 'Tokyo' },
    });
    expect(out.usage?.input_tokens).toBe(10);
  });

  it('maps stopReason MAX_TOKENS to max_tokens', () => {
    const resp: ConverseCommandOutput = {
      $metadata: { requestId: 'req_1' } as never,
      output: { message: { role: 'assistant', content: [{ text: '...' }] } },
      stopReason: StopReason.MAX_TOKENS,
      usage: {
        inputTokens: 10,
        outputTokens: 100,
        totalTokens: 110,
      } as never,
      metrics: { latencyMs: 0 } as never,
    } as ConverseCommandOutput;
    const out = responseConverseToAnthropic(resp, 'm');
    expect(out.stop_reason).toBe('max_tokens');
  });
});

describe('Converse → Anthropic stream adapter', () => {
  async function* synth(events: ConverseStreamOutput[]) {
    for (const e of events) yield e;
  }

  it('emits message_start → text deltas → message_delta + message_stop', async () => {
    const events: ConverseStreamOutput[] = [
      { messageStart: { role: 'assistant' } },
      {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { text: 'Hello' },
        },
      },
      {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { text: ' world' },
        },
      },
      { contentBlockStop: { contentBlockIndex: 0 } },
      { messageStop: { stopReason: StopReason.END_TURN } },
      {
        metadata: {
          usage: {
            inputTokens: 5,
            outputTokens: 2,
            totalTokens: 7,
          },
          metrics: { latencyMs: 0 } as never,
        },
      },
    ];

    const out: RawMessageStreamEvent[] = [];
    for await (const e of streamConverseToAnthropic(
      synth(events),
      'claude-haiku-4-5'
    )) {
      out.push(e);
    }

    const types = out.map((e) => e.type);
    expect(types).toContain('message_start');
    expect(types.some((t) => t === 'content_block_start')).toBe(true);
    expect(types.filter((t) => t === 'content_block_delta')).toHaveLength(2);
    expect(types).toContain('content_block_stop');
    expect(types).toContain('message_delta');
    expect(types).toContain('message_stop');

    // Reconstructed text should be the concatenated deltas.
    const text = out
      .filter((e) => e.type === 'content_block_delta')
      .map((e) => {
        const d = (e as { delta?: { type?: string; text?: string } }).delta;
        return d?.type === 'text_delta' ? d.text ?? '' : '';
      })
      .join('');
    expect(text).toBe('Hello world');

    // Final message_delta carries usage.
    const delta = out.find((e) => e.type === 'message_delta') as {
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    expect(delta.usage?.input_tokens).toBe(5);
    expect(delta.usage?.output_tokens).toBe(2);
  });

  it('translates Converse toolUse stream events to input_json_delta', async () => {
    const events: ConverseStreamOutput[] = [
      { messageStart: { role: 'assistant' } },
      {
        contentBlockStart: {
          contentBlockIndex: 0,
          start: {
            toolUse: { toolUseId: 'tu_1', name: 'get_weather' },
          },
        },
      },
      {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { toolUse: { input: '{"location":' } },
        },
      },
      {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { toolUse: { input: '"Tokyo"}' } },
        },
      },
      { contentBlockStop: { contentBlockIndex: 0 } },
      { messageStop: { stopReason: StopReason.TOOL_USE } },
    ];

    const out: RawMessageStreamEvent[] = [];
    for await (const e of streamConverseToAnthropic(synth(events), 'm')) {
      out.push(e);
    }
    const argsDeltas = out
      .filter((e) => e.type === 'content_block_delta')
      .map((e) => {
        const d = (
          e as {
            delta?: { type?: string; partial_json?: string };
          }
        ).delta;
        return d?.type === 'input_json_delta' ? d.partial_json ?? '' : '';
      })
      .join('');
    expect(() => JSON.parse(argsDeltas)).not.toThrow();
    expect(JSON.parse(argsDeltas)).toEqual({ location: 'Tokyo' });
  });
});
