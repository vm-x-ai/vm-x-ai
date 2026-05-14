import { describe, expect, it } from 'vitest';
import {
  anthropicRequestToOpenAI,
  openAIResponseToAnthropic,
} from '../../ai-provider/anthropic/openai-chat-completion.provider';
import type {
  AnthropicPassthrough,
  PassthroughEnvelope,
} from '../../ai-provider/passthrough.helpers';
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';

/**
 * Phase 12 regression tests: every Anthropic-only feature must
 * survive the OpenAI Chat Completions pivot via the
 * `__vmx_passthrough.anthropic` envelope. A missing field here is a
 * silent customer data loss.
 */
describe('anthropic-converter / request → openai (passthrough envelope)', () => {
  function getPassthrough(
    request: AnthropicMessagesRequest
  ): AnthropicPassthrough | undefined {
    const out = anthropicRequestToOpenAI(request) as unknown as {
      __vmx_passthrough?: PassthroughEnvelope;
    };
    return out.__vmx_passthrough?.anthropic;
  }

  it('preserves request-level cache_control', () => {
    const pt = getPassthrough({
      model: 'claude-haiku-4-5',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
      cache_control: { type: 'ephemeral', ttl: '1h' },
    });
    expect(pt?.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('preserves cache_control markers on system text blocks', () => {
    const pt = getPassthrough({
      model: 'claude-haiku-4-5',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
      system: [
        {
          type: 'text',
          text: 'Frozen system prompt',
          cache_control: { type: 'ephemeral' },
        },
        { type: 'text', text: 'Volatile suffix' },
      ],
    });
    expect(pt?.system_cache_breakpoints).toEqual([
      { index: 0, cache_control: { type: 'ephemeral' } },
    ]);
  });

  it('preserves cache_control markers on tool definitions', () => {
    const pt = getPassthrough({
      model: 'claude-haiku-4-5',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        {
          name: 'cached_tool',
          description: 'Tool with cache control',
          input_schema: { type: 'object' },
          cache_control: { type: 'ephemeral', ttl: '5m' },
        },
        {
          name: 'fresh_tool',
          input_schema: { type: 'object' },
        },
      ],
    });
    expect(pt?.tool_cache_breakpoints).toEqual([
      { index: 0, cache_control: { type: 'ephemeral', ttl: '5m' } },
    ]);
  });

  it('preserves cache_control markers on message content blocks', () => {
    const pt = getPassthrough({
      model: 'claude-haiku-4-5',
      max_tokens: 100,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Long context' },
            {
              type: 'text',
              text: 'Cache here',
              cache_control: { type: 'ephemeral' },
            },
          ],
        },
      ],
    });
    expect(pt?.cache_breakpoints).toEqual([
      {
        path: 'messages[0].content[1]',
        cache_control: { type: 'ephemeral' },
      },
    ]);
  });

  it('preserves thinking config', () => {
    const pt = getPassthrough({
      model: 'claude-opus-4-7',
      max_tokens: 4096,
      messages: [{ role: 'user', content: 'hi' }],
      thinking: { type: 'adaptive', display: 'summarized' },
    });
    expect(pt?.thinking).toEqual({
      type: 'adaptive',
      display: 'summarized',
    });
  });

  it('preserves top_k (the historical silent-drop bug)', () => {
    // Regression: anthropic-converter.ts:119 never set top_k on the
    // OpenAI body. Now it lives on the passthrough envelope so
    // Bedrock-Invoke / native AnthropicProvider can re-attach it.
    const pt = getPassthrough({
      model: 'claude-haiku-4-5',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
      top_k: 40,
    });
    expect(pt?.top_k).toBe(40);
  });

  it('preserves service_tier', () => {
    const pt = getPassthrough({
      model: 'claude-haiku-4-5',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
      service_tier: 'standard_only',
    });
    expect(pt?.service_tier).toBe('standard_only');
  });

  it('preserves full structured metadata (not just user_id)', () => {
    const pt = getPassthrough({
      model: 'claude-haiku-4-5',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
      metadata: { user_id: 'user-123' } as AnthropicMessagesRequest['metadata'],
    });
    expect(pt?.metadata).toEqual({ user_id: 'user-123' });
  });

  it('preserves server tools (web_search_*, code_execution_*, bash_*, text_editor_*)', () => {
    const pt = getPassthrough({
      model: 'claude-opus-4-7',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        {
          name: 'custom_tool',
          input_schema: { type: 'object' },
        },
        {
          type: 'web_search_20250305',
          name: 'web_search',
        } as unknown as AnthropicMessagesRequest['tools'] extends Array<infer T>
          ? T
          : never,
      ] as AnthropicMessagesRequest['tools'],
    });
    expect(pt?.server_tools).toHaveLength(1);
    expect(pt?.server_tools?.[0]).toMatchObject({
      type: 'web_search_20250305',
    });
  });

  it('preserves prior thinking blocks for multi-turn continuity', () => {
    const pt = getPassthrough({
      model: 'claude-opus-4-7',
      max_tokens: 1024,
      messages: [
        { role: 'user', content: 'first turn' },
        {
          role: 'assistant',
          content: [
            {
              type: 'thinking',
              thinking: 'Internal reasoning',
              signature: 'sig-abc',
            },
            { type: 'text', text: 'Hello!', citations: [] },
          ],
        },
        { role: 'user', content: 'second turn' },
      ],
    });
    expect(pt?.prior_thinking).toHaveLength(1);
    expect(pt?.prior_thinking?.[0].blocks[0]).toMatchObject({
      type: 'thinking',
      thinking: 'Internal reasoning',
      signature: 'sig-abc',
    });
  });

  it('preserves tool_choice.disable_parallel_tool_use', () => {
    const pt = getPassthrough({
      model: 'claude-haiku-4-5',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
      tool_choice: {
        type: 'auto',
        disable_parallel_tool_use: true,
      },
    });
    expect(pt?.tool_choice).toEqual({
      type: 'auto',
      disable_parallel_tool_use: true,
    });
  });
});

describe('anthropic-converter / response → anthropic (Anthropic fidelity)', () => {
  it('round-trips refusal stop_reason from OpenAI message.refusal', () => {
    const out = openAIResponseToAnthropic({
      id: 'cc_1',
      model: 'claude-opus-4-7',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            refusal: 'I cannot help with that request.',
          },
          finish_reason: 'content_filter',
        },
      ],
    });
    expect(out.stop_reason).toBe('refusal');
    expect(out.stop_details).toMatchObject({
      type: 'refusal',
      explanation: 'I cannot help with that request.',
    });
  });

  it('round-trips thinking blocks from message.reasoning extension', () => {
    const out = openAIResponseToAnthropic({
      id: 'cc_2',
      model: 'claude-opus-4-7',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'Final answer',
            reasoning: {
              thinking: 'Step 1: think about it. Step 2: answer.',
              signature: 'sig-xyz',
            },
          },
          finish_reason: 'stop',
        },
      ],
    });
    expect(out.content).toEqual([
      {
        type: 'thinking',
        thinking: 'Step 1: think about it. Step 2: answer.',
        signature: 'sig-xyz',
      },
      { type: 'text', text: 'Final answer', citations: null },
    ]);
  });

  it('round-trips redacted_thinking blocks', () => {
    const out = openAIResponseToAnthropic({
      id: 'cc_3',
      model: 'claude-opus-4-7',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'OK',
            reasoning: { redacted: ['encrypted-blob-1', 'encrypted-blob-2'] },
          },
          finish_reason: 'stop',
        },
      ],
    });
    expect(out.content[0]).toEqual({
      type: 'redacted_thinking',
      data: 'encrypted-blob-1',
    });
    expect(out.content[1]).toEqual({
      type: 'redacted_thinking',
      data: 'encrypted-blob-2',
    });
  });

  it('round-trips cache_creation_input_tokens', () => {
    const out = openAIResponseToAnthropic({
      id: 'cc_4',
      model: 'claude-opus-4-7',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'hi' },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 5,
        prompt_tokens_details: {
          cached_tokens: 50,
          cache_creation_input_tokens: 25,
          cache_creation: {
            ephemeral_5m_input_tokens: 20,
            ephemeral_1h_input_tokens: 5,
          },
        },
      },
    });
    expect(out.usage.cache_creation_input_tokens).toBe(25);
    expect(out.usage.cache_read_input_tokens).toBe(50);
    expect(out.usage.cache_creation).toEqual({
      ephemeral_5m_input_tokens: 20,
      ephemeral_1h_input_tokens: 5,
    });
  });

  it('round-trips server_tool_use counts', () => {
    const out = openAIResponseToAnthropic({
      id: 'cc_5',
      model: 'claude-opus-4-7',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'hi' },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        server_tool_use: { web_search_requests: 3, web_fetch_requests: 0 },
      },
    });
    expect(out.usage.server_tool_use).toEqual({
      web_search_requests: 3,
      web_fetch_requests: 0,
    });
  });

  it('emits tool_use blocks with caller field (SDK conformance)', () => {
    const out = openAIResponseToAnthropic({
      id: 'cc_6',
      model: 'claude-haiku-4-5',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: '{"city":"SF"}',
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    });
    expect(out.content[0]).toEqual({
      type: 'tool_use',
      id: 'call_1',
      name: 'get_weather',
      input: { city: 'SF' },
      caller: { type: 'direct' },
    });
    expect(out.stop_reason).toBe('tool_use');
  });
});
