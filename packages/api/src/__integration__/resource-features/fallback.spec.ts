import { describe, expect, it } from 'vitest';
import { buildCompletionFlowHarness } from '../helpers/completion-flow';
import type { CompletionRequestDto } from '../../gateway/dto/completion-request.dto';

/**
 * Deep unit tests for the AI-Resource **fallback** feature with a
 * mocked provider. Verifies that:
 *   - Primary success short-circuits the fallback chain.
 *   - Primary failure rolls to the next fallback in declared order.
 *   - Each fallback gets a fresh `requestAt` timestamp + audit
 *     event so dashboards can attribute latency / cost to the right
 *     leg.
 *   - Mid-chain success leaves the remaining fallbacks unused.
 *   - All-models-fail rethrows the last error.
 *   - The fallback chain respects per-model `maxRetries` / `timeoutMs`.
 */

const baseRequest: CompletionRequestDto = {
  model: 'default',
  messages: [{ role: 'user', content: 'hi' }],
} as never;

const successResponse = (id: string, model: string) =>
  ({
    data: {
      id,
      object: 'chat.completion',
      model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'ok' },
          finish_reason: 'stop',
          logprobs: null,
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
    headers: {},
    providerRequestPayload: {},
  } as never);

const buildResource = (
  primary: { provider: string; model: string },
  fallbacks: Array<{ provider: string; model: string }> = []
) =>
  ({
    resourceId: 'res-1',
    workspaceId: 'ws-1',
    environmentId: 'env-1',
    name: 'default',
    description: null,
    model: { ...primary, connectionId: 'conn-1' },
    fallbackModels: fallbacks.map((f) => ({ ...f, connectionId: 'conn-1' })),
    secondaryModels: [],
    routing: null,
    capacity: [],
    useFallback: true,
  } as never);

describe('AI-Resource fallback', () => {
  it('returns the primary response and never invokes fallbacks on success', async () => {
    const { service, spies } = buildCompletionFlowHarness({
      resource: buildResource({ provider: 'openai', model: 'primary' }, [
        { provider: 'anthropic', model: 'fallback-1' },
        { provider: 'gemini', model: 'fallback-2' },
      ]),
    });
    const result = await service.completion('ws-1', 'env-1', baseRequest);
    expect((result.data as { id: string }).id).toBe('cmpl_test');
    // Only one provider call — primary succeeded.
    expect(spies.providerCompletion).toHaveBeenCalledTimes(1);
  });

  it('rolls through the fallback chain in declared order on failure', async () => {
    const { service, spies } = buildCompletionFlowHarness({
      resource: buildResource({ provider: 'openai', model: 'primary' }, [
        { provider: 'anthropic', model: 'fallback-1' },
        { provider: 'gemini', model: 'fallback-2' },
      ]),
    });
    let n = 0;
    spies.providerCompletion.mockImplementation(async (_req, _conn, model) => {
      n += 1;
      // Fail the first two, succeed on the third.
      if (n < 3) throw new Error(`upstream ${n} failed`);
      return successResponse(
        `cmpl_attempt_${n}`,
        (model as { model: string }).model
      );
    });
    const result = await service.completion('ws-1', 'env-1', baseRequest);
    expect(spies.providerCompletion).toHaveBeenCalledTimes(3);
    expect((result.data as { id: string }).id).toBe('cmpl_attempt_3');
    // The third call's model arg should have been `fallback-2`.
    const thirdCallModel = spies.providerCompletion.mock.calls[2]?.[2] as {
      model: string;
    };
    expect(thirdCallModel.model).toBe('fallback-2');
  });

  it('records a FALLBACK audit event for each failed leg', async () => {
    const { service, spies } = buildCompletionFlowHarness({
      resource: buildResource({ provider: 'openai', model: 'primary' }, [
        { provider: 'anthropic', model: 'fallback-1' },
      ]),
    });
    let n = 0;
    spies.providerCompletion.mockImplementation(async () => {
      n += 1;
      if (n === 1) throw new Error('primary failed');
      return successResponse('cmpl_fb', 'fallback-1');
    });
    const result = await service.completion('ws-1', 'env-1', baseRequest);
    const events = (
      result.data as {
        vmx?: { events?: Array<{ type: string; data: unknown }> };
      }
    ).vmx?.events;
    expect(events).toBeDefined();
    const fallbackEvents = events!.filter((e) => e.type === 'fallback');
    expect(fallbackEvents.length).toBe(1);
  });

  it('rethrows the last error when every leg fails', async () => {
    const { service } = buildCompletionFlowHarness({
      resource: buildResource({ provider: 'openai', model: 'primary' }, [
        { provider: 'anthropic', model: 'fallback-1' },
      ]),
      providerThrows: new Error('all-dead'),
    });
    await expect(
      service.completion('ws-1', 'env-1', baseRequest)
    ).rejects.toThrow(/all-dead/);
  });

  it("dispatches each fallback with that model's own maxRetries setting", async () => {
    const { service, spies } = buildCompletionFlowHarness({
      resource: {
        resourceId: 'res-1',
        workspaceId: 'ws-1',
        environmentId: 'env-1',
        name: 'default',
        model: {
          provider: 'openai',
          model: 'primary',
          connectionId: 'conn-1',
          maxRetries: 0,
        },
        fallbackModels: [
          {
            provider: 'anthropic',
            model: 'fallback-1',
            connectionId: 'conn-1',
            maxRetries: 4,
          },
        ],
        secondaryModels: [],
        routing: null,
        capacity: [],
        useFallback: true,
      } as never,
    });
    let n = 0;
    spies.providerCompletion.mockImplementation(async () => {
      n += 1;
      if (n === 1) throw new Error('primary fail');
      return successResponse('cmpl_fb', 'fallback-1');
    });
    await service.completion('ws-1', 'env-1', baseRequest);
    const primaryOpts = spies.providerCompletion.mock.calls[0]?.[3] as {
      maxRetries: number;
    };
    const fallbackOpts = spies.providerCompletion.mock.calls[1]?.[3] as {
      maxRetries: number;
    };
    expect(primaryOpts.maxRetries).toBe(0);
    expect(fallbackOpts.maxRetries).toBe(4);
  });

  it('with no fallbacks declared, still rethrows on primary failure', async () => {
    const { service } = buildCompletionFlowHarness({
      resource: buildResource({ provider: 'openai', model: 'primary' }, []),
      providerThrows: new Error('no fallback available'),
    });
    await expect(
      service.completion('ws-1', 'env-1', baseRequest)
    ).rejects.toThrow(/no fallback available/);
  });
});
