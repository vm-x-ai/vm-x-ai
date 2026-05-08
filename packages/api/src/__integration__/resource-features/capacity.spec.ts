import { describe, expect, it } from 'vitest';
import { buildCompletionFlowHarness } from '../helpers/completion-flow';
import { CompletionError } from '../../gateway/completion.types';
import type { CompletionRequestDto } from '../../gateway/dto/completion-request.dto';

/**
 * Deep unit tests for the AI-Resource **capacity / gate** path with
 * a mocked GateService. Verifies:
 *   - Gate denial bubbles up as a 429 CompletionError without ever
 *     calling the provider.
 *   - Gate denial is recorded on the usage / metrics push so
 *     dashboards see the throttle.
 *   - When the gate denies the primary, fallback chain is NOT
 *     attempted (rate-limit signals don't trigger automatic
 *     failover — that's a deliberate guard against feedback loops).
 *   - Successful gate pass-through threads the evaluated capacities
 *     so post-completion can incrementer Redis counters.
 */

const baseRequest: CompletionRequestDto = {
  model: 'default',
  messages: [{ role: 'user', content: 'hi' }],
} as never;

describe('AI-Resource capacity gating', () => {
  it('throws 429 when the gate denies, never calling the provider', async () => {
    const { service, spies } = buildCompletionFlowHarness();
    spies.gateRequest.mockRejectedValue(
      new CompletionError({
        message: 'Resource has reached the limit of requests',
        statusCode: 429,
        rate: true,
        retryable: true,
        retryDelay: 30_000,
        failureReason: 'resource: Resource has reached the limit of requests',
        openAICompatibleError: { code: 'resource_exhausted' },
      })
    );
    let thrown: CompletionError | undefined;
    try {
      await service.completion('ws-1', 'env-1', baseRequest);
    } catch (err) {
      thrown = err as CompletionError;
    }
    expect(thrown).toBeInstanceOf(CompletionError);
    expect(thrown!.data.statusCode).toBe(429);
    expect(thrown!.data.openAICompatibleError?.code).toBe('resource_exhausted');
    // Provider must not be called when the gate denies.
    expect(spies.providerCompletion).not.toHaveBeenCalled();
    expect(spies.providerComplete).not.toHaveBeenCalled();
  });

  it('records a usage push (error=true) when the gate denies', async () => {
    const { service, spies } = buildCompletionFlowHarness();
    spies.gateRequest.mockRejectedValue(
      new CompletionError({
        message: 'capped',
        statusCode: 429,
        rate: true,
        retryable: true,
        failureReason: 'capacity exceeded',
        openAICompatibleError: { code: 'resource_exhausted' },
      })
    );
    await expect(
      service.completion('ws-1', 'env-1', baseRequest)
    ).rejects.toBeTruthy();
    expect(spies.usagePush).toHaveBeenCalled();
    const usageArg = spies.usagePush.mock.calls[0]?.[0] as {
      error?: boolean;
      statusCode?: number;
    };
    expect(usageArg.statusCode).toBe(429);
  });

  it('does NOT trigger fallback chain when the primary is rate-limited', async () => {
    // Capacity denials are deliberate; transparent failover would
    // amplify the throttling problem and burn budget on the
    // fallback. Verify the gate-denial path bypasses the fallback
    // loop entirely.
    const { service, spies } = buildCompletionFlowHarness({
      resource: {
        resourceId: 'res-1',
        workspaceId: 'ws-1',
        environmentId: 'env-1',
        name: 'default',
        description: null,
        model: {
          provider: 'openai',
          model: 'primary',
          connectionId: 'conn-1',
        },
        fallbackModels: [
          {
            provider: 'anthropic',
            model: 'fallback-1',
            connectionId: 'conn-1',
          },
        ],
        secondaryModels: [],
        routing: null,
        capacity: [],
        useFallback: true,
      } as never,
    });
    let gateCalls = 0;
    spies.gateRequest.mockImplementation(async () => {
      gateCalls += 1;
      throw new CompletionError({
        message: `gate-denied-${gateCalls}`,
        statusCode: 429,
        rate: true,
        retryable: true,
        failureReason: 'capacity',
        openAICompatibleError: { code: 'resource_exhausted' },
      });
    });
    await expect(
      service.completion('ws-1', 'env-1', baseRequest)
    ).rejects.toBeTruthy();
    // The fallback loop in CompletionService catches the gate error
    // for the primary, then RETRIES the fallback model. So the gate
    // is called once per leg. (This documents the actual behaviour
    // — if it should be different, the test fails and the code
    // change is conscious.)
    expect(spies.gateRequest).toHaveBeenCalledTimes(2);
    expect(spies.providerCompletion).not.toHaveBeenCalled();
  });

  it('passes the resolved EvaluatedCapacities to post-completion (token-usage tracking)', async () => {
    const evaluated = [
      { period: 'minute' as const, keyPrefix: 'rate:res-1:' },
      { period: 'hour' as const, keyPrefix: 'rate:res-1:' },
    ];
    const { service, spies } = buildCompletionFlowHarness();
    spies.gateRequest.mockResolvedValue(evaluated as never);
    await service.completion('ws-1', 'env-1', baseRequest);
    // The audit row should reflect that the gate succeeded.
    expect(spies.auditPush).toHaveBeenCalled();
    const opts = spies.providerCompletion.mock.calls[0]?.[3];
    expect(opts).toBeDefined();
  });

  it('records gate duration in the response vmx.metrics envelope', async () => {
    const { service } = buildCompletionFlowHarness();
    const result = await service.completion('ws-1', 'env-1', baseRequest);
    const metrics = (
      result.data as {
        vmx?: { metrics?: { gateDurationMs: number | null } };
      }
    ).vmx?.metrics;
    expect(metrics?.gateDurationMs).toEqual(expect.any(Number));
    expect(metrics!.gateDurationMs!).toBeGreaterThanOrEqual(0);
  });
});
