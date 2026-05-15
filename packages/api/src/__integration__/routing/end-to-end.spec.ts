import { describe, expect, it, vi } from 'vitest';
import { PinoLogger } from 'nestjs-pino';
import { ResourceRoutingService } from '../../gateway/routing.service';
import { CompletionMetricsService } from '../../gateway/metrics/metrics.service';
import {
  RoutingAction,
  RoutingComparator,
  RoutingConditionType,
  RoutingMode,
  RoutingOperator,
} from '../../ai-resource/common/routing.entity';
import type { AIResourceEntity } from '../../ai-resource/entities/ai-resource.entity';
import type { ChatCompletionCreateParams } from 'openai/resources/index.js';
import { chatCompletionsToResponsesRequest } from '../../gateway/responses/from-chat-completions';
import type { RoutingContext } from '../../gateway/routing.context';

/**
 * Cross-component integration tests for {@link ResourceRoutingService}.
 *
 * The unit spec next to the source covers comparator semantics in
 * isolation. This suite exercises the higher-level wiring:
 *
 * 1. The `errorRate` template variable threading through the
 *    `CompletionMetricsService` collaborator (verifying the call
 *    actually arrives at metrics with the right tenant scope).
 * 2. `RoutingMode.ADVANCED` mode that lets operators write a free-form
 *    EJS expression instead of UI-built condition groups.
 * 3. Multiple sequential groups — the first matching group wins, the
 *    rest are skipped.
 * 4. Nested AND/OR groups — the recursive evaluator must handle group
 *    nodes and condition leaves interchangeably.
 */

function makeService(
  getErrorRate = vi.fn().mockResolvedValue({ errorRate: 0 })
): {
  service: ResourceRoutingService;
  metrics: ReturnType<typeof vi.fn>;
} {
  const logger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as PinoLogger;
  const metrics = { getErrorRate };
  const capacity = {
    getCapacityUsage: vi.fn().mockResolvedValue({
      totalRequests: 0,
      totalTokens: 0,
      remainingSeconds: 60,
      requestsLimit: null,
      tokensLimit: null,
      requestsLimitSource: null,
      tokensLimitSource: null,
      remainingRequests: null,
      remainingTokens: null,
      requestsUsagePercent: null,
      tokensUsagePercent: null,
    }),
  };
  const aiConnection = {
    getById: vi.fn().mockResolvedValue(undefined),
  };
  const service = new ResourceRoutingService(
    logger,
    metrics as unknown as CompletionMetricsService,
    capacity as never,
    aiConnection as never
  );
  return { service, metrics: getErrorRate };
}

const baseRequest = (
  overrides: Partial<ChatCompletionCreateParams> = {}
): RoutingContext => {
  const body = {
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'hi' }],
    ...overrides,
  } as ChatCompletionCreateParams;
  return {
    format: 'chat-completions',
    responses: chatCompletionsToResponsesRequest(body),
    native: body,
  };
};

const buildResource = (groups: unknown[]): AIResourceEntity =>
  ({
    resourceId: 'res-1',
    workspaceId: 'ws-1',
    environmentId: 'env-1',
    name: 'integration-test',
    model: { provider: 'openai', model: 'fallback', connectionId: 'conn-1' },
    routing: { mode: RoutingMode.UI, conditions: groups },
  } as unknown as AIResourceEntity);

describe('ResourceRoutingService — integration', () => {
  describe('errorRate variable', () => {
    it('invokes CompletionMetricsService with the workspace/env/resource scope', async () => {
      // Per-condition expressions are rendered with `{ async: true }`
      // (UI mode), so an `<%= await errorRate(...) %>` placeholder
      // resolves before the comparator runs. ADVANCED mode renders
      // sync and is exercised separately below.
      const getErrorRate = vi.fn().mockResolvedValue({ errorRate: 12 });
      const { service, metrics } = makeService(getErrorRate);
      const resource = buildResource([
        {
          mode: RoutingMode.UI,
          enabled: true,
          action: RoutingAction.CALL_MODEL,
          operator: RoutingOperator.AND,
          conditions: [
            {
              expression: '<%= await errorRate(5, 500) %>',
              comparator: RoutingComparator.GREATER_THAN,
              value: { type: RoutingConditionType.NUMBER, expression: '10' },
            },
          ],
          then: {
            provider: 'openai',
            model: 'failover',
            connectionId: 'conn-2',
          },
        },
      ]);
      const result = await service.evaluateRoutingConditions(
        'ws-1',
        'env-1',
        baseRequest(),
        10,
        resource
      );
      expect(result?.model.model).toBe('failover');
      expect(metrics).toHaveBeenCalledWith(
        'ws-1',
        'env-1',
        'res-1',
        'conn-1', // default connection from resource.model.connectionId
        'fallback', // default model from resource.model.model
        5, // window
        500 // statusCode
      );
    });
  });

  describe('ADVANCED mode (free-form EJS)', () => {
    it('renders the expression and matches when result is truthy', async () => {
      const { service } = makeService();
      const resource = buildResource([
        {
          mode: RoutingMode.ADVANCED,
          enabled: true,
          action: RoutingAction.CALL_MODEL,
          expression: '<% if (request.messagesCount > 0) { %>matched<% } %>',
          conditions: [],
          then: {
            provider: 'openai',
            model: 'advanced-route',
            connectionId: 'conn-2',
          },
          operator: RoutingOperator.AND,
        },
      ]);
      const result = await service.evaluateRoutingConditions(
        'ws-1',
        'env-1',
        baseRequest(),
        10,
        resource
      );
      expect(result?.model.model).toBe('advanced-route');
    });

    it('skips when the expression evaluates to empty / falsy', async () => {
      const { service } = makeService();
      const resource = buildResource([
        {
          mode: RoutingMode.ADVANCED,
          enabled: true,
          action: RoutingAction.CALL_MODEL,
          expression: '<% if (false) { %>nope<% } %>',
          conditions: [],
          then: {
            provider: 'openai',
            model: 'advanced',
            connectionId: 'conn-2',
          },
          operator: RoutingOperator.AND,
        },
      ]);
      const result = await service.evaluateRoutingConditions(
        'ws-1',
        'env-1',
        baseRequest(),
        10,
        resource
      );
      expect(result).toBeNull();
    });
  });

  describe('multiple groups (priority)', () => {
    it('picks the first matching group and ignores subsequent ones', async () => {
      const { service } = makeService();
      const resource = buildResource([
        {
          mode: RoutingMode.UI,
          enabled: true,
          action: RoutingAction.CALL_MODEL,
          operator: RoutingOperator.AND,
          conditions: [
            {
              expression: 'request.model',
              comparator: RoutingComparator.EQUAL,
              value: {
                type: RoutingConditionType.STRING,
                expression: 'gpt-4o-mini',
              },
            },
          ],
          then: {
            provider: 'openai',
            model: 'first-match',
            connectionId: 'conn-2',
          },
        },
        {
          mode: RoutingMode.UI,
          enabled: true,
          action: RoutingAction.CALL_MODEL,
          operator: RoutingOperator.AND,
          conditions: [
            {
              expression: 'request.model',
              comparator: RoutingComparator.EQUAL,
              value: {
                type: RoutingConditionType.STRING,
                expression: 'gpt-4o-mini',
              },
            },
          ],
          then: {
            provider: 'openai',
            model: 'second-match',
            connectionId: 'conn-3',
          },
        },
      ]);
      const result = await service.evaluateRoutingConditions(
        'ws-1',
        'env-1',
        baseRequest(),
        10,
        resource
      );
      expect(result?.model.model).toBe('first-match');
    });

    it('falls through to a later group when the earlier one does not match', async () => {
      const { service } = makeService();
      const resource = buildResource([
        {
          mode: RoutingMode.UI,
          enabled: true,
          action: RoutingAction.CALL_MODEL,
          operator: RoutingOperator.AND,
          conditions: [
            {
              expression: 'request.model',
              comparator: RoutingComparator.EQUAL,
              value: {
                type: RoutingConditionType.STRING,
                expression: 'no-match',
              },
            },
          ],
          then: {
            provider: 'openai',
            model: 'skipped',
            connectionId: 'conn-2',
          },
        },
        {
          mode: RoutingMode.UI,
          enabled: true,
          action: RoutingAction.CALL_MODEL,
          operator: RoutingOperator.AND,
          conditions: [
            {
              expression: 'request.model',
              comparator: RoutingComparator.EQUAL,
              value: {
                type: RoutingConditionType.STRING,
                expression: 'gpt-4o-mini',
              },
            },
          ],
          then: {
            provider: 'openai',
            model: 'fallthrough-match',
            connectionId: 'conn-3',
          },
        },
      ]);
      const result = await service.evaluateRoutingConditions(
        'ws-1',
        'env-1',
        baseRequest(),
        10,
        resource
      );
      expect(result?.model.model).toBe('fallthrough-match');
    });
  });

  describe('nested groups (AND containing OR sub-group)', () => {
    it('evaluates a sub-group recursively via the OR branch', async () => {
      const { service } = makeService();
      const resource = buildResource([
        {
          mode: RoutingMode.UI,
          enabled: true,
          action: RoutingAction.CALL_MODEL,
          operator: RoutingOperator.AND,
          conditions: [
            // First leaf: must match.
            {
              expression: 'request.lastMessage.role',
              comparator: RoutingComparator.EQUAL,
              value: { type: RoutingConditionType.STRING, expression: 'user' },
            },
            // Second leaf wrapped in an OR sub-group: either model
            // matches or a token-budget condition matches.
            {
              enabled: true,
              operator: RoutingOperator.OR,
              conditions: [
                {
                  expression: 'request.model',
                  comparator: RoutingComparator.EQUAL,
                  value: {
                    type: RoutingConditionType.STRING,
                    expression: 'no-match',
                  },
                },
                {
                  expression: 'tokens.input',
                  comparator: RoutingComparator.GREATER_THAN,
                  value: {
                    type: RoutingConditionType.NUMBER,
                    expression: '5',
                  },
                },
              ],
            },
          ],
          then: {
            provider: 'openai',
            model: 'nested-match',
            connectionId: 'conn-2',
          },
        },
      ]);
      const result = await service.evaluateRoutingConditions(
        'ws-1',
        'env-1',
        baseRequest(),
        10, // tokens — drives the OR branch
        resource
      );
      expect(result?.model.model).toBe('nested-match');
    });
  });
});
