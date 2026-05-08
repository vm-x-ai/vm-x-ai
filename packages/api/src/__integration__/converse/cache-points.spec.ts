import { describe, expect, it } from 'vitest';
import type { Message, Tool } from '@aws-sdk/client-bedrock-runtime';
import {
  injectCachePoints,
  type ConverseSystemBlock,
} from '../../ai-provider/aws-bedrock-converse/shared';
import { requestAnthropicToConverse } from '../../ai-provider/aws-bedrock-converse/anthropic-messages.provider';
import type { AnthropicPassthrough } from '../../gateway/anthropic/anthropic-converter';
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';

/**
 * Caching is the silent breakage T1 closes: `cache_control` markers
 * used to land in `additionalModelRequestFields` (a free-form blob
 * Bedrock ignores) rather than as Converse-native `cachePoint`
 * content blocks. These tests pin the OpenAI-side passthrough
 * envelope translation AND the Anthropic-input direct adapter to
 * the correct on-the-wire shape.
 */

describe('OpenAI → Converse cachePoint injection (T1)', () => {
  it('injects cachePoint after a marked system block at the right index', () => {
    const system: ConverseSystemBlock[] = [
      { text: 'sys-0' },
      { text: 'sys-1' },
    ];
    const passthrough: AnthropicPassthrough = {
      system_cache_breakpoints: [
        { index: 0, cache_control: { type: 'ephemeral', ttl: '5m' } },
      ],
    };
    injectCachePoints([], system, undefined, passthrough);
    expect(system).toEqual([
      { text: 'sys-0' },
      { cachePoint: { type: 'default', ttl: '5m' } },
      { text: 'sys-1' },
    ]);
  });

  it('injects cachePoint after a marked tool entry, descending so indices stay stable', () => {
    const tools: Tool[] = [
      { toolSpec: { name: 'a', inputSchema: { json: {} as never } } },
      { toolSpec: { name: 'b', inputSchema: { json: {} as never } } },
      { toolSpec: { name: 'c', inputSchema: { json: {} as never } } },
    ];
    const passthrough: AnthropicPassthrough = {
      tool_cache_breakpoints: [
        { index: 0, cache_control: { type: 'ephemeral' } },
        { index: 2, cache_control: { type: 'ephemeral', ttl: '1h' } },
      ],
    };
    injectCachePoints([], undefined, tools, passthrough);
    expect(tools).toHaveLength(5);
    expect((tools[0] as { toolSpec?: { name?: string } }).toolSpec?.name).toBe(
      'a'
    );
    expect(tools[1]).toEqual({ cachePoint: { type: 'default' } });
    expect((tools[2] as { toolSpec?: { name?: string } }).toolSpec?.name).toBe(
      'b'
    );
    expect((tools[3] as { toolSpec?: { name?: string } }).toolSpec?.name).toBe(
      'c'
    );
    expect(tools[4]).toEqual({ cachePoint: { type: 'default', ttl: '1h' } });
  });

  it('appends a trailing cachePoint to the message that owned the marked block', () => {
    const messages: Message[] = [
      { role: 'user', content: [{ text: 'first user turn' }] },
      { role: 'assistant', content: [{ text: 'assistant reply' }] },
      { role: 'user', content: [{ text: 'second user turn' }] },
    ];
    const passthrough: AnthropicPassthrough = {
      cache_breakpoints: [
        {
          path: 'messages[1].content[0]',
          cache_control: { type: 'ephemeral', ttl: '5m' },
        },
      ],
    };
    injectCachePoints(messages, undefined, undefined, passthrough);
    expect(messages[1].content).toEqual([
      { text: 'assistant reply' },
      { cachePoint: { type: 'default', ttl: '5m' } },
    ]);
    // First and third messages stay clean.
    expect(messages[0].content).toEqual([{ text: 'first user turn' }]);
    expect(messages[2].content).toEqual([{ text: 'second user turn' }]);
  });

  it('is a no-op when passthrough is undefined', () => {
    const system: ConverseSystemBlock[] = [{ text: 'sys' }];
    const tools: Tool[] = [
      { toolSpec: { name: 'a', inputSchema: { json: {} as never } } },
    ];
    const messages: Message[] = [{ role: 'user', content: [{ text: 'hi' }] }];
    injectCachePoints(messages, system, tools, undefined);
    expect(system).toEqual([{ text: 'sys' }]);
    expect(tools).toHaveLength(1);
    expect(messages[0].content).toEqual([{ text: 'hi' }]);
  });

  it('omits the ttl field when the breakpoint did not specify one', () => {
    const system: ConverseSystemBlock[] = [{ text: 'sys' }];
    injectCachePoints([], system, undefined, {
      system_cache_breakpoints: [
        { index: 0, cache_control: { type: 'ephemeral' } },
      ],
    });
    expect(system[1]).toEqual({ cachePoint: { type: 'default' } });
  });
});

describe('Anthropic → Converse direct adapter cachePoint emission (T1)', () => {
  it('emits cachePoint after a system text block carrying cache_control', () => {
    const out = requestAnthropicToConverse(
      {
        model: 'claude',
        max_tokens: 64,
        system: [
          {
            type: 'text',
            text: 'You are helpful.',
            cache_control: { type: 'ephemeral', ttl: '1h' },
          },
        ] as AnthropicMessagesRequest['system'],
        messages: [{ role: 'user', content: 'ping' }],
      } as AnthropicMessagesRequest,
      'us.anthropic.claude-haiku-4-5'
    );
    expect(out.system).toEqual([
      { text: 'You are helpful.' },
      { cachePoint: { type: 'default', ttl: '1h' } },
    ]);
  });

  it('emits cachePoint after a content block carrying cache_control', () => {
    const out = requestAnthropicToConverse(
      {
        model: 'claude',
        max_tokens: 64,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'first' },
              {
                type: 'text',
                text: 'cached prefix ends here',
                cache_control: { type: 'ephemeral' },
              },
              { type: 'text', text: 'after the breakpoint' },
            ],
          },
        ],
      } as AnthropicMessagesRequest,
      'us.anthropic.claude-haiku-4-5'
    );
    expect(out.messages?.[0].content).toEqual([
      { text: 'first' },
      { text: 'cached prefix ends here' },
      { cachePoint: { type: 'default' } },
      { text: 'after the breakpoint' },
    ]);
  });

  it('emits cachePoint after a tool definition carrying cache_control', () => {
    const out = requestAnthropicToConverse(
      {
        model: 'claude',
        max_tokens: 64,
        messages: [{ role: 'user', content: 'hello' }],
        tools: [
          {
            name: 'tool_a',
            description: 'first',
            input_schema: { type: 'object', properties: {} },
          },
          {
            name: 'tool_b',
            description: 'second',
            input_schema: { type: 'object', properties: {} },
            cache_control: { type: 'ephemeral', ttl: '5m' },
          },
        ] as AnthropicMessagesRequest['tools'],
      } as AnthropicMessagesRequest,
      'us.anthropic.claude-haiku-4-5'
    );
    expect(out.toolConfig?.tools).toHaveLength(3);
    const tools = out.toolConfig?.tools ?? [];
    expect((tools[0] as { toolSpec?: { name?: string } }).toolSpec?.name).toBe(
      'tool_a'
    );
    expect((tools[1] as { toolSpec?: { name?: string } }).toolSpec?.name).toBe(
      'tool_b'
    );
    expect(tools[2]).toEqual({
      cachePoint: { type: 'default', ttl: '5m' },
    });
  });
});
