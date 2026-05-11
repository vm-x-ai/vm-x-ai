import { describe, expect, it } from 'vitest';
import { buildCompletionFlowHarness } from '../helpers/completion-flow';
import type { GatewayRequest } from '../helpers/gateway-request';
import type { CompletionRequestDto } from '../../gateway/dto/completion-request.dto';

/**
 * Unit tests for the new `vmx.providerArgs` escape hatch.
 *
 * Merge precedence (lowest → highest):
 *   1. resource.defaultArgs    (operator-set baseline)
 *   2. parsed request body     (caller-supplied)
 *   3. vmx.providerArgs        (override — wins over both)
 *
 * The point of `providerArgs` is to let clients inject provider-
 * native fields the gateway shape can't model (e.g. Perplexity
 * `search_recency_filter`, Anthropic `top_k`, Gemini `safetySettings`),
 * even when those fields conflict with structured slots like
 * `messages` or `tools`.
 */

describe('vmx.providerArgs precedence', () => {
  it('overrides a scalar field set by the parsed request body', async () => {
    const { service, spies } = buildCompletionFlowHarness();
    const payload = {
      model: 'default',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.7,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vmx: { providerArgs: { temperature: 0.0 } } as any,
    } as CompletionRequestDto;
    await service.completion('ws-1', 'env-1', payload);
    const dispatched = spies.providerCompletion.mock.calls[0]?.[0] as {
      temperature: number;
    };
    expect(dispatched.temperature).toBe(0.0);
  });

  it('overrides a structured field (`messages`) — full control for the user', async () => {
    const { service, spies } = buildCompletionFlowHarness();
    const overriddenMessages = [
      { role: 'user', content: 'overridden by providerArgs' },
    ];
    const payload = {
      model: 'default',
      messages: [{ role: 'user', content: 'will be replaced' }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vmx: { providerArgs: { messages: overriddenMessages } } as any,
    } as CompletionRequestDto;
    await service.completion('ws-1', 'env-1', payload);
    const dispatched = spies.providerCompletion.mock.calls[0]?.[0] as {
      messages: typeof overriddenMessages;
    };
    expect(dispatched.messages).toEqual(overriddenMessages);
  });

  it('beats resource defaultArgs', async () => {
    const { service, spies } = buildCompletionFlowHarness({
      resource: {
        resourceId: 'res-1',
        workspaceId: 'ws-1',
        environmentId: 'env-1',
        name: 'default',
        description: null,
        model: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          connectionId: 'conn-1',
        },
        fallbackModels: [],
        secondaryModels: [],
        routing: null,
        capacity: [],
        useFallback: false,
        defaultArgs: { temperature: 1.0, top_p: 0.5 },
      } as never,
    });
    const payload = {
      model: 'default',
      messages: [{ role: 'user', content: 'hi' }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vmx: { providerArgs: { temperature: 0.0 } } as any,
    } as CompletionRequestDto;
    await service.completion('ws-1', 'env-1', payload);
    const dispatched = spies.providerCompletion.mock.calls[0]?.[0] as {
      temperature: number;
      top_p: number;
    };
    // providerArgs wins on the conflict.
    expect(dispatched.temperature).toBe(0.0);
    // top_p was only in defaultArgs — survives because nothing
    // overrode it.
    expect(dispatched.top_p).toBe(0.5);
  });

  it('injects a provider-native field that the gateway shape does not model', async () => {
    const { service, spies } = buildCompletionFlowHarness();
    const payload = {
      model: 'default',
      messages: [{ role: 'user', content: 'hi' }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vmx: { providerArgs: { search_recency_filter: 'week' } } as any,
    } as CompletionRequestDto;
    await service.completion('ws-1', 'env-1', payload);
    const dispatched = spies.providerCompletion.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(dispatched.search_recency_filter).toBe('week');
  });

  it('is a no-op when not set (legacy compatibility)', async () => {
    const { service, spies } = buildCompletionFlowHarness();
    const payload = {
      model: 'default',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.5,
    } as CompletionRequestDto;
    await service.completion('ws-1', 'env-1', payload);
    const dispatched = spies.providerCompletion.mock.calls[0]?.[0] as {
      temperature: number;
    };
    expect(dispatched.temperature).toBe(0.5);
  });

  it('applies on the format-aware path (Anthropic body) too', async () => {
    const { service, spies } = buildCompletionFlowHarness();
    const gw: GatewayRequest = {
      format: 'anthropic',
      body: {
        model: 'claude-haiku-4-5',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'hi' }],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vmx: { providerArgs: { top_k: 7, custom_field: 'survives' } } as any,
      } as never,
    };
    await service.complete('ws-1', 'env-1', gw);
    const dispatchedReq = spies.providerComplete.mock.calls[0]?.[0] as {
      format: string;
      body: Record<string, unknown>;
    };
    expect(dispatchedReq.format).toBe('anthropic');
    // The native body got providerArgs spread on top.
    expect(dispatchedReq.body.top_k).toBe(7);
    expect(dispatchedReq.body.custom_field).toBe('survives');
  });
});
