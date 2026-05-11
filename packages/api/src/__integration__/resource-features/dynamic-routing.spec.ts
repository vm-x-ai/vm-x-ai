import { describe, expect, it } from 'vitest';
import { buildCompletionFlowHarness } from '../helpers/completion-flow';
import {
  RoutingAction,
  RoutingComparator,
  RoutingConditionType,
  RoutingMode,
  RoutingOperator,
} from '../../ai-resource/common/routing.entity';
import type { CompletionRequestDto } from '../../gateway/dto/completion-request.dto';
import { CompletionError } from '../../gateway/completion.types';

/**
 * Deep unit tests for the AI-Resource **dynamic routing** feature
 * with a mocked provider. Verifies the full request lifecycle when
 * a resource has routing enabled:
 *   - Matched route overrides the primary model.
 *   - The override emits a ROUTING audit event.
 *   - BLOCK action throws a 400 before the provider is called.
 *   - Routing is bypassed when the caller pinned `secondaryModelIndex`.
 *   - When no route matches, the primary model is used.
 *   - The routed model's per-model `maxRetries` / `timeoutMs` are
 *     applied (not the primary's).
 */

const baseRequest = {
  model: 'default',
  messages: [{ role: 'user', content: 'hi' }],
} as CompletionRequestDto;

const buildResource = (
  primary: { provider: string; model: string },
  conditions: unknown[],
  primaryExtras: Record<string, unknown> = {}
) =>
  ({
    resourceId: 'res-1',
    workspaceId: 'ws-1',
    environmentId: 'env-1',
    name: 'default',
    description: null,
    model: { ...primary, connectionId: 'conn-1', ...primaryExtras },
    fallbackModels: [],
    secondaryModels: [],
    routing: { enabled: true, conditions },
    capacity: [],
    useFallback: false,
  } as never);

const callModelGroup = (
  expression: string,
  expression_value: string,
  thenModel: { provider: string; model: string },
  extras: Record<string, unknown> = {}
) => ({
  mode: RoutingMode.UI,
  enabled: true,
  action: RoutingAction.CALL_MODEL,
  operator: RoutingOperator.AND,
  conditions: [
    {
      expression,
      comparator: RoutingComparator.EQUAL,
      value: {
        type: RoutingConditionType.STRING,
        expression: expression_value,
      },
    },
  ],
  then: { ...thenModel, connectionId: 'conn-1', ...extras },
});

describe('AI-Resource dynamic routing', () => {
  it('overrides primary model when a routing condition matches', async () => {
    const { service, spies } = buildCompletionFlowHarness({
      resource: buildResource({ provider: 'openai', model: 'primary' }, [
        callModelGroup('request.model', 'default', {
          provider: 'anthropic',
          model: 'routed',
        }),
      ]),
    });
    spies.routingEvaluate.mockResolvedValue({
      model: { provider: 'anthropic', model: 'routed', connectionId: 'conn-1' },
      matchedRoute: { description: 'route-test' },
    });
    const result = await service.completion('ws-1', 'env-1', baseRequest);
    expect(result.headers['x-vmx-model']).toBe('routed');
  });

  it('emits a ROUTING audit event with originalModel + routedModel', async () => {
    const { service, spies } = buildCompletionFlowHarness({
      resource: buildResource({ provider: 'openai', model: 'primary' }, [
        callModelGroup('request.model', 'default', {
          provider: 'anthropic',
          model: 'routed',
        }),
      ]),
    });
    spies.routingEvaluate.mockResolvedValue({
      model: { provider: 'anthropic', model: 'routed', connectionId: 'conn-1' },
      matchedRoute: { description: 'route-test' },
    });
    const result = await service.completion('ws-1', 'env-1', baseRequest);
    const events = (
      result.data as {
        vmx?: {
          events?: Array<{ type: string; data: Record<string, unknown> }>;
        };
      }
    ).vmx?.events;
    const routingEvent = events?.find((e) => e.type === 'routing');
    expect(routingEvent).toBeDefined();
    expect((routingEvent!.data.originalModel as { model: string }).model).toBe(
      'primary'
    );
    expect((routingEvent!.data.routedModel as { model: string }).model).toBe(
      'routed'
    );
  });

  it('BLOCK action throws CompletionError(400) before provider is called', async () => {
    const { service, spies } = buildCompletionFlowHarness({
      resource: buildResource({ provider: 'openai', model: 'primary' }, [
        {
          mode: RoutingMode.UI,
          enabled: true,
          action: RoutingAction.BLOCK,
          operator: RoutingOperator.AND,
          conditions: [],
          then: {} as never,
          description: 'block prompt-injection probes',
        },
      ]),
    });
    // Routing service throws (BLOCK action) — make the spy do that.
    spies.routingEvaluate.mockRejectedValue(
      new CompletionError({
        message: 'Request blocked by routing condition',
        statusCode: 400,
        rate: false,
        retryable: false,
        failureReason: 'Blocked by routing condition',
        openAICompatibleError: { code: 'blocked_by_routing_condition' },
      })
    );
    await expect(
      service.completion('ws-1', 'env-1', baseRequest)
    ).rejects.toBeInstanceOf(CompletionError);
    expect(spies.providerCompletion).not.toHaveBeenCalled();
  });

  it('skips routing when secondaryModelIndex is set (caller pin overrides)', async () => {
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
        },
        fallbackModels: [],
        secondaryModels: [
          null!,
          {
            provider: 'gemini',
            model: 'pinned-secondary',
            connectionId: 'conn-1',
          },
        ],
        routing: { enabled: true, conditions: [] },
        capacity: [],
        useFallback: false,
      } as never,
    });
    const payload = {
      ...baseRequest,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vmx: { secondaryModelIndex: 1 } as any,
    } as CompletionRequestDto;
    const result = await service.completion('ws-1', 'env-1', payload);
    expect(spies.routingEvaluate).not.toHaveBeenCalled();
    expect(result.headers['x-vmx-model']).toBe('pinned-secondary');
  });

  it('uses the primary model when routing returns null (no match)', async () => {
    const { service, spies } = buildCompletionFlowHarness({
      resource: buildResource({ provider: 'openai', model: 'primary' }, [
        callModelGroup('request.model', 'will-never-match', {
          provider: 'anthropic',
          model: 'routed',
        }),
      ]),
    });
    spies.routingEvaluate.mockResolvedValue(null);
    const result = await service.completion('ws-1', 'env-1', baseRequest);
    expect(result.headers['x-vmx-model']).toBe('primary');
  });

  it("applies the routed model's per-model maxRetries (not the primary's)", async () => {
    const { service, spies } = buildCompletionFlowHarness({
      resource: buildResource(
        { provider: 'openai', model: 'primary' },
        [
          callModelGroup(
            'request.model',
            'default',
            { provider: 'anthropic', model: 'routed' },
            { maxRetries: 7 }
          ),
        ],
        { maxRetries: 1 }
      ),
    });
    spies.routingEvaluate.mockResolvedValue({
      model: {
        provider: 'anthropic',
        model: 'routed',
        connectionId: 'conn-1',
        maxRetries: 7,
      },
      matchedRoute: { description: 'route-test' },
    });
    await service.completion('ws-1', 'env-1', baseRequest);
    const opts = spies.providerCompletion.mock.calls[0]?.[3] as {
      maxRetries: number;
    };
    expect(opts.maxRetries).toBe(7);
  });
});
