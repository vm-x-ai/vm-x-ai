import { describe, expect, it } from 'vitest';
import { canonicalAnthropicToBedrockInvoke } from '../../ai-provider/adapters/anthropic-messages.adapter';
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';

/**
 * T10: Bedrock-Invoke's Anthropic body expects `anthropic_beta`
 * (snake-case array), not the canonical `betas` field. The
 * `canonicalAnthropicToBedrockInvoke` helper now renames the field
 * on the way to the wire so beta opt-ins (interleaved-thinking,
 * compact-2026-01-12, files-api, etc.) actually fire.
 */

describe('canonicalAnthropicToBedrockInvoke betas rename (T10)', () => {
  it('renames betas → anthropic_beta on the produced body', () => {
    const wire = canonicalAnthropicToBedrockInvoke(
      {
        model: 'claude-haiku-4-5',
        max_tokens: 64,
        messages: [{ role: 'user', content: 'hi' }],
        betas: ['interleaved-thinking-2025-05-14'],
      } as AnthropicMessagesRequest,
      'bedrock-2023-05-31'
    );
    expect(wire).toMatchObject({
      anthropic_version: 'bedrock-2023-05-31',
      anthropic_beta: ['interleaved-thinking-2025-05-14'],
    });
    expect((wire as Record<string, unknown>).betas).toBeUndefined();
  });

  it('omits anthropic_beta when betas is empty', () => {
    const wire = canonicalAnthropicToBedrockInvoke(
      {
        model: 'claude-haiku-4-5',
        max_tokens: 64,
        messages: [{ role: 'user', content: 'hi' }],
        betas: [],
      } as AnthropicMessagesRequest,
      'bedrock-2023-05-31'
    );
    expect((wire as Record<string, unknown>).anthropic_beta).toBeUndefined();
    expect((wire as Record<string, unknown>).betas).toBeUndefined();
  });

  it('omits anthropic_beta when betas is undefined', () => {
    const wire = canonicalAnthropicToBedrockInvoke(
      {
        model: 'claude-haiku-4-5',
        max_tokens: 64,
        messages: [{ role: 'user', content: 'hi' }],
      } as AnthropicMessagesRequest,
      'bedrock-2023-05-31'
    );
    expect((wire as Record<string, unknown>).anthropic_beta).toBeUndefined();
  });

  it('still strips model + stream from the canonical body', () => {
    const wire = canonicalAnthropicToBedrockInvoke(
      {
        model: 'claude-haiku-4-5',
        max_tokens: 64,
        stream: true,
        messages: [{ role: 'user', content: 'hi' }],
      } as AnthropicMessagesRequest,
      'bedrock-2023-05-31'
    );
    expect((wire as Record<string, unknown>).model).toBeUndefined();
    expect((wire as Record<string, unknown>).stream).toBeUndefined();
  });

  it('strips Bedrock-Invoke-rejected fields (mcp_servers, container, context_management, inference_geo)', () => {
    // Bedrock InvokeModel rejects these Anthropic-native fields with
    // 400 — they're only proxied by the direct Anthropic API. Strip
    // silently so callers that mix-and-match providers don't surface a
    // raw AWS error.
    const wire = canonicalAnthropicToBedrockInvoke(
      {
        model: 'claude-haiku-4-5',
        max_tokens: 64,
        messages: [{ role: 'user', content: 'hi' }],
        mcp_servers: [
          {
            type: 'url',
            url: 'https://example.com/mcp',
            name: 'example',
          },
        ],
        container: 'container_abc123',
        context_management: { edits: [] },
        inference_geo: 'us',
      } as unknown as AnthropicMessagesRequest,
      'bedrock-2023-05-31'
    );
    expect((wire as Record<string, unknown>).mcp_servers).toBeUndefined();
    expect((wire as Record<string, unknown>).container).toBeUndefined();
    expect(
      (wire as Record<string, unknown>).context_management
    ).toBeUndefined();
    expect((wire as Record<string, unknown>).inference_geo).toBeUndefined();
    expect(wire.anthropic_version).toBe('bedrock-2023-05-31');
  });
});
