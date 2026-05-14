import { describe, expect, it } from 'vitest';
import { anthropicRequestToOpenAI } from '../../ai-provider/anthropic/openai-chat-completion.provider';
import { openAIRequestToAnthropic } from '../../ai-provider/anthropic/openai-chat-completion.provider';
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';

/**
 * T9: extend `AnthropicPassthrough` to carry Anthropic-only fields
 * the doc-comment claimed were forwarded but no code captured —
 * `betas[]`, `mcp_servers[]`, `context_management.edits[]`,
 * `inference_geo`. Round-trip them through the canonical
 * Anthropic→OpenAI→Anthropic converter pair.
 */

const baseAnthropicReq = {
  model: 'claude',
  max_tokens: 64,
  messages: [{ role: 'user', content: 'hi' }],
} as AnthropicMessagesRequest;

describe('Anthropic↔OpenAI passthrough — extended fields (T9)', () => {
  it('captures + re-emits betas[]', () => {
    const openAI = anthropicRequestToOpenAI({
      ...baseAnthropicReq,
      betas: ['interleaved-thinking-2025-05-14', 'compact-2026-01-12'],
    } as AnthropicMessagesRequest & { betas?: string[] });
    const anthropic = openAIRequestToAnthropic(openAI);
    expect(
      (anthropic as AnthropicMessagesRequest & { betas?: string[] }).betas
    ).toEqual(['interleaved-thinking-2025-05-14', 'compact-2026-01-12']);
  });

  it('captures + re-emits mcp_servers[]', () => {
    const openAI = anthropicRequestToOpenAI({
      ...baseAnthropicReq,
      mcp_servers: [
        {
          type: 'url',
          url: 'https://mcp.example/tools',
          name: 'example',
        },
      ] as AnthropicMessagesRequest['mcp_servers'],
    });
    const anthropic = openAIRequestToAnthropic(openAI);
    expect(anthropic.mcp_servers).toEqual([
      { type: 'url', url: 'https://mcp.example/tools', name: 'example' },
    ]);
  });

  it('captures + re-emits context_management.edits[]', () => {
    const openAI = anthropicRequestToOpenAI({
      ...baseAnthropicReq,
      context_management: {
        edits: [{ type: 'compact_20260112' }],
      } as AnthropicMessagesRequest['context_management'],
    });
    const anthropic = openAIRequestToAnthropic(openAI);
    expect(anthropic.context_management).toEqual({
      edits: [{ type: 'compact_20260112' }],
    });
  });

  it('captures + re-emits inference_geo', () => {
    const openAI = anthropicRequestToOpenAI({
      ...baseAnthropicReq,
      inference_geo: 'us',
    } as AnthropicMessagesRequest);
    const anthropic = openAIRequestToAnthropic(openAI);
    expect(anthropic.inference_geo).toBe('us');
  });

  it('drops betas[] when the source array is empty', () => {
    const openAI = anthropicRequestToOpenAI({
      ...baseAnthropicReq,
      betas: [],
    } as AnthropicMessagesRequest & { betas?: string[] });
    const anthropic = openAIRequestToAnthropic(openAI);
    expect(
      (anthropic as AnthropicMessagesRequest & { betas?: string[] }).betas
    ).toBeUndefined();
  });
});
