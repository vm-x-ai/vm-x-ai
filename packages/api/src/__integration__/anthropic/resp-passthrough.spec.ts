import { describe, expect, it } from 'vitest';
import { requestResponsesToAnthropic } from '../../ai-provider/anthropic/openai-response.provider';
import type { ResponseCreateParams } from 'openai/resources/responses/responses.js';

/**
 * T7: the Resp→Anthropic adapter used to ignore `__vmx_passthrough`,
 * silently dropping cache_control / top_k / service_tier / metadata /
 * container / server_tools / structured_output. The fix calls the
 * canonical `applyPassthrough` and `applyStructuredOutputFromSchema`
 * helpers shared with the Chat path.
 */

const baseReq = {
  model: 'claude',
  input: [
    {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'hi' }],
    },
  ],
} as ResponseCreateParams;

describe('Resp→Anthropic passthrough re-application (T7)', () => {
  it('honours __vmx_passthrough.anthropic.top_k', () => {
    const out = requestResponsesToAnthropic({
      ...baseReq,
      __vmx_passthrough: { anthropic: { top_k: 50 } },
    } as unknown as ResponseCreateParams);
    expect(out.top_k).toBe(50);
  });

  it('honours __vmx_passthrough.anthropic.service_tier', () => {
    const out = requestResponsesToAnthropic({
      ...baseReq,
      __vmx_passthrough: {
        anthropic: { service_tier: 'auto' },
      },
    } as unknown as ResponseCreateParams);
    expect(out.service_tier).toBe('auto');
  });

  it('honours __vmx_passthrough.anthropic.metadata', () => {
    const out = requestResponsesToAnthropic({
      ...baseReq,
      __vmx_passthrough: {
        anthropic: { metadata: { user_id: 'u-1' } },
      },
    } as unknown as ResponseCreateParams);
    expect(out.metadata).toEqual({ user_id: 'u-1' });
  });

  it('honours __vmx_passthrough.anthropic.container', () => {
    const out = requestResponsesToAnthropic({
      ...baseReq,
      __vmx_passthrough: { anthropic: { container: 'c-7' } },
    } as unknown as ResponseCreateParams);
    expect(out.container).toBe('c-7');
  });

  it('honours __vmx_passthrough.anthropic.cache_control top-level', () => {
    const out = requestResponsesToAnthropic({
      ...baseReq,
      __vmx_passthrough: {
        anthropic: { cache_control: { type: 'ephemeral', ttl: '1h' } },
      },
    } as unknown as ResponseCreateParams);
    expect(out.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
  });

  it('honours __vmx_passthrough.anthropic.thinking', () => {
    const out = requestResponsesToAnthropic({
      ...baseReq,
      __vmx_passthrough: {
        anthropic: { thinking: { type: 'enabled', budget_tokens: 4096 } },
      },
    } as unknown as ResponseCreateParams);
    expect(out.thinking).toEqual({ type: 'enabled', budget_tokens: 4096 });
  });

  it('re-attaches server tools from __vmx_passthrough.anthropic.server_tools', () => {
    const out = requestResponsesToAnthropic({
      ...baseReq,
      __vmx_passthrough: {
        anthropic: {
          server_tools: [
            {
              type: 'web_search_20250305',
              name: 'web_search',
              max_uses: 3,
            } as never,
          ],
        },
      },
    } as unknown as ResponseCreateParams);
    const ws = (out.tools ?? []).find(
      (t) => (t as { type?: string }).type === 'web_search_20250305'
    );
    expect(ws).toBeDefined();
  });

  it('translates text.format = json_schema into a synthetic Anthropic tool', () => {
    const out = requestResponsesToAnthropic({
      ...baseReq,
      text: {
        format: {
          type: 'json_schema',
          name: 'CityCountry',
          schema: {
            type: 'object',
            properties: { city: { type: 'string' } },
            required: ['city'],
          },
        },
      } as never,
    } as unknown as ResponseCreateParams);
    expect(out.tools).toBeDefined();
    const synthetic = (out.tools ?? []).find(
      (t) => (t as { name?: string }).name === '__vmx_structured_output__'
    );
    expect(synthetic).toBeDefined();
    expect(out.tool_choice).toMatchObject({
      type: 'tool',
      name: '__vmx_structured_output__',
    });
  });

  it('applies system_cache_breakpoints to the produced system blocks', () => {
    const out = requestResponsesToAnthropic({
      ...baseReq,
      instructions: 'be helpful',
      __vmx_passthrough: {
        anthropic: {
          system_cache_breakpoints: [
            { index: 0, cache_control: { type: 'ephemeral', ttl: '5m' } },
          ],
        },
      },
    } as unknown as ResponseCreateParams);
    const sys = out.system as Array<{
      type?: string;
      text?: string;
      cache_control?: { type: 'ephemeral'; ttl?: string };
    }>;
    expect(sys[0].cache_control).toEqual({ type: 'ephemeral', ttl: '5m' });
  });
});
