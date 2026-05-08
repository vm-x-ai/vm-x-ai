import { describe, expect, it } from 'vitest';
import { anthropicToResponsesRequest } from './from-anthropic';
import type { AnthropicMessagesRequest } from '../anthropic/anthropic.types';

describe('anthropicToResponsesRequest', () => {
  it('maps a simple user-only request', () => {
    const out = anthropicToResponsesRequest({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      messages: [{ role: 'user', content: 'Hello!' }],
    } as AnthropicMessagesRequest);
    expect(out.model).toBe('claude-haiku-4-5');
    expect(out.max_output_tokens).toBe(512);
    expect(out.input).toEqual([
      { type: 'message', role: 'user', content: 'Hello!' },
    ]);
    expect(out.instructions).toBeUndefined();
  });

  it('lifts string `system` into instructions', () => {
    const out = anthropicToResponsesRequest({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      system: 'Be terse.',
      messages: [{ role: 'user', content: 'Why?' }],
    } as AnthropicMessagesRequest);
    expect(out.instructions).toBe('Be terse.');
  });

  it('joins array `system` text blocks with double newlines', () => {
    const out = anthropicToResponsesRequest({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      system: [
        { type: 'text', text: 'Be terse.' },
        { type: 'text', text: 'Cite sources.' },
      ],
      messages: [{ role: 'user', content: 'Why?' }],
    } as AnthropicMessagesRequest);
    expect(out.instructions).toBe('Be terse.\n\nCite sources.');
  });

  it('preserves multi-turn user/assistant alternation', () => {
    const out = anthropicToResponsesRequest({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      messages: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello!' },
        { role: 'user', content: 'How are you?' },
      ],
    } as AnthropicMessagesRequest);
    expect(out.input).toEqual([
      { type: 'message', role: 'user', content: 'Hi' },
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Hello!' }],
      },
      { type: 'message', role: 'user', content: 'How are you?' },
    ]);
  });

  it('emits function_call items for assistant tool_use blocks', () => {
    const out = anthropicToResponsesRequest({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
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
      ],
    } as AnthropicMessagesRequest);
    expect(out.input).toEqual([
      { type: 'message', role: 'user', content: 'weather?' },
      {
        type: 'function_call',
        call_id: 'tu_1',
        name: 'get_weather',
        arguments: JSON.stringify({ location: 'Tokyo' }),
      },
    ]);
  });

  it('flushes assistant text before tool_use into a message + function_call', () => {
    const out = anthropicToResponsesRequest({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      messages: [
        { role: 'user', content: 'weather?' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Checking now.' },
            {
              type: 'tool_use',
              id: 'tu_1',
              name: 'get_weather',
              input: {},
            },
          ],
        },
      ],
    } as AnthropicMessagesRequest);
    expect(out.input).toEqual([
      { type: 'message', role: 'user', content: 'weather?' },
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Checking now.' }],
      },
      {
        type: 'function_call',
        call_id: 'tu_1',
        name: 'get_weather',
        arguments: '{}',
      },
    ]);
  });

  it('maps user tool_result blocks to function_call_output items', () => {
    const out = anthropicToResponsesRequest({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      messages: [
        { role: 'user', content: 'weather?' },
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tu_1', name: 'get_weather', input: {} },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_1',
              content: '{"temp_c":22}',
            },
          ],
        },
      ],
    } as AnthropicMessagesRequest);
    expect(out.input).toEqual([
      { type: 'message', role: 'user', content: 'weather?' },
      {
        type: 'function_call',
        call_id: 'tu_1',
        name: 'get_weather',
        arguments: '{}',
      },
      {
        type: 'function_call_output',
        call_id: 'tu_1',
        output: '{"temp_c":22}',
      },
    ]);
  });

  it('maps base64 image blocks to data: URLs', () => {
    const out = anthropicToResponsesRequest({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe.' },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: 'abc',
              },
            },
          ],
        },
      ],
    } as AnthropicMessagesRequest);
    expect(out.input).toEqual([
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: 'Describe.' },
          { type: 'input_image', image_url: 'data:image/png;base64,abc' },
        ],
      },
    ]);
  });

  it('emits reasoning items for thinking blocks with signatures', () => {
    const out = anthropicToResponsesRequest({
      model: 'claude-opus-4-7',
      max_tokens: 4096,
      messages: [
        { role: 'user', content: 'Solve.' },
        {
          role: 'assistant',
          content: [
            {
              type: 'thinking',
              thinking: 'Step 1...',
              signature: 'sig-abc',
            },
            { type: 'text', text: 'The answer is 42.' },
          ],
        },
      ],
    } as AnthropicMessagesRequest);
    const items = out.input as Array<{
      type: string;
      summary?: Array<{ text: string }>;
      encrypted_content?: string;
      content?: Array<{ type: string; text: string }>;
    }>;
    expect(items[0].type).toBe('message');
    expect(items[1].type).toBe('reasoning');
    expect(items[1].encrypted_content).toBe('sig-abc');
    expect(items[1].summary).toEqual([
      { type: 'summary_text', text: 'Step 1...' },
    ]);
    expect(items[2].type).toBe('message');
    expect(items[2].content).toEqual([
      { type: 'output_text', text: 'The answer is 42.' },
    ]);
  });

  it('emits redacted_thinking with the redacted: sentinel prefix', () => {
    const out = anthropicToResponsesRequest({
      model: 'claude-opus-4-7',
      max_tokens: 4096,
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'redacted_thinking', data: 'opaque-blob' }],
        },
      ],
    } as AnthropicMessagesRequest);
    const items = out.input as Array<{
      type: string;
      encrypted_content?: string;
    }>;
    expect(items[0].type).toBe('reasoning');
    expect(items[0].encrypted_content).toBe('redacted:opaque-blob');
  });

  it('partitions function tools onto tools[], server tools onto passthrough', () => {
    const out = anthropicToResponsesRequest({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        {
          name: 'get_weather',
          description: 'Get the weather',
          input_schema: {
            type: 'object',
            properties: { location: { type: 'string' } },
            required: ['location'],
          },
        },
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 3,
        } as unknown as never,
      ],
    } as AnthropicMessagesRequest);

    expect(out.tools).toEqual([
      {
        type: 'function',
        name: 'get_weather',
        description: 'Get the weather',
        parameters: {
          type: 'object',
          properties: { location: { type: 'string' } },
          required: ['location'],
        },
        strict: null,
      },
    ]);

    const passthrough = (
      out as { __vmx_passthrough?: { anthropic?: { server_tools?: unknown } } }
    ).__vmx_passthrough;
    expect(passthrough?.anthropic?.server_tools).toEqual([
      { type: 'web_search_20250305', name: 'web_search', max_uses: 3 },
    ]);
  });

  it('maps tool_choice variants', () => {
    const cases: Array<[AnthropicMessagesRequest['tool_choice'], unknown]> = [
      [{ type: 'auto' }, 'auto'],
      [{ type: 'any' }, 'required'],
      [{ type: 'none' }, 'none'],
      [
        { type: 'tool', name: 'get_weather' },
        { type: 'function', name: 'get_weather' },
      ],
    ];
    for (const [tc, expected] of cases) {
      const out = anthropicToResponsesRequest({
        model: 'claude-haiku-4-5',
        max_tokens: 512,
        messages: [{ role: 'user', content: 'hi' }],
        tool_choice: tc,
      } as AnthropicMessagesRequest);
      expect(out.tool_choice).toEqual(expected);
    }
  });

  it('maps thinking budget_tokens to reasoning.effort tier', () => {
    const cases: Array<[number, 'low' | 'medium' | 'high']> = [
      [1000, 'low'],
      [4000, 'medium'],
      [12000, 'high'],
    ];
    for (const [budget, effort] of cases) {
      const out = anthropicToResponsesRequest({
        model: 'claude-opus-4-7',
        max_tokens: 8192,
        messages: [{ role: 'user', content: 'hi' }],
        thinking: { type: 'enabled', budget_tokens: budget },
      } as AnthropicMessagesRequest);
      expect(out.reasoning).toEqual({ effort });
    }
  });

  it('carries Anthropic-only fields onto __vmx_passthrough.anthropic', () => {
    const out = anthropicToResponsesRequest({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      messages: [{ role: 'user', content: 'hi' }],
      top_k: 10,
      service_tier: 'auto',
      metadata: { user_id: 'u_42' },
      betas: ['interleaved-thinking-2025-05-14'],
      thinking: { type: 'enabled', budget_tokens: 1024 },
      stop_sequences: ['STOP'],
      mcp_servers: [
        { type: 'url', url: 'https://example.com', name: 'remote' },
      ],
      context_management: { edits: [{ type: 'compaction' }] },
      inference_geo: 'us',
    } as AnthropicMessagesRequest);

    const anth =
      (out as { __vmx_passthrough?: { anthropic?: Record<string, unknown> } })
        .__vmx_passthrough?.anthropic ?? {};
    expect(anth.top_k).toBe(10);
    expect(anth.service_tier).toBe('auto');
    expect(anth.metadata).toEqual({ user_id: 'u_42' });
    expect(anth.betas).toEqual(['interleaved-thinking-2025-05-14']);
    expect(anth.thinking).toEqual({ type: 'enabled', budget_tokens: 1024 });
    expect(anth.stop_sequences).toEqual(['STOP']);
    expect(anth.mcp_servers).toEqual([
      { type: 'url', url: 'https://example.com', name: 'remote' },
    ]);
    expect(anth.context_management).toEqual({
      edits: [{ type: 'compaction' }],
    });
    expect(anth.inference_geo).toBe('us');
  });

  it('extracts cache_control breakpoints into top-level passthrough fields', () => {
    const out = anthropicToResponsesRequest({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      system: [
        {
          type: 'text',
          text: 'long system text',
          cache_control: { type: 'ephemeral', ttl: '5m' },
        } as never,
      ],
      tools: [
        {
          name: 'get_weather',
          description: 'Get the weather',
          input_schema: {},
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          cache_control: { type: 'ephemeral', ttl: '1h' } as any,
        },
      ],
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'long context',
              cache_control: { type: 'ephemeral' },
            } as never,
          ],
        },
      ],
    } as unknown as AnthropicMessagesRequest);

    const anth =
      (out as { __vmx_passthrough?: { anthropic?: Record<string, unknown> } })
        .__vmx_passthrough?.anthropic ?? {};
    expect(anth.system_cache_breakpoints).toEqual([{ index: 0, ttl: '5m' }]);
    expect(anth.tool_cache_breakpoints).toEqual([{ index: 0, ttl: '1h' }]);
    expect(anth.messages_cache_breakpoints).toEqual([
      { messageIndex: 0, blockIndex: 0, index: 0 },
    ]);
  });

  it('merges inbound __vmx_passthrough with anthropic-side carry-overs', () => {
    const out = anthropicToResponsesRequest({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      messages: [{ role: 'user', content: 'hi' }],
      __vmx_passthrough: {
        bedrock: { performanceConfig: { latency: 'optimized' } },
        anthropic: { existing_field: 'kept' },
      },
      top_k: 5,
    } as never);

    const passthrough =
      (out as { __vmx_passthrough?: Record<string, unknown> })
        .__vmx_passthrough ?? {};
    expect(
      (passthrough.bedrock as Record<string, unknown>).performanceConfig
    ).toEqual({
      latency: 'optimized',
    });
    expect(
      (passthrough.anthropic as Record<string, unknown>).existing_field
    ).toBe('kept');
    expect((passthrough.anthropic as Record<string, unknown>).top_k).toBe(5);
  });

  it('carries vmx envelope through verbatim', () => {
    const vmx = {
      correlationId: 'agent-1',
      metadata: { team: 'growth' },
      timeoutMs: 25000,
    };
    const out = anthropicToResponsesRequest({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      messages: [{ role: 'user', content: 'hi' }],
      vmx,
    } as never);
    expect((out as { vmx?: unknown }).vmx).toBe(vmx);
  });

  it('forwards stream / temperature / top_p', () => {
    const out = anthropicToResponsesRequest({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
      temperature: 0.7,
      top_p: 0.9,
    } as AnthropicMessagesRequest);
    expect((out as { stream?: boolean }).stream).toBe(true);
    expect(out.temperature).toBe(0.7);
    expect(out.top_p).toBe(0.9);
  });
});
