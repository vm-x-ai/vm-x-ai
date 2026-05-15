import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { PinoLogger } from 'nestjs-pino';
import { ResourceRoutingService } from './routing.service';
import { CompletionMetricsService } from './metrics/metrics.service';
import {
  AIResourceRoutingCondition,
  RoutingAction,
  RoutingComparator,
  RoutingConditionType,
  RoutingMode,
  RoutingOperator,
} from '../ai-resource/common/routing.entity';
import { CompletionError } from './completion.types';
import type { ChatCompletionCreateParams } from 'openai/resources/index.js';
import type { AIResourceEntity } from '../ai-resource/entities/ai-resource.entity';
import { chatCompletionsToResponsesRequest } from './responses/from-chat-completions';
import type { RoutingContext } from './routing.context';

/**
 * Unit tests for {@link ResourceRoutingService}. Covers:
 * - the comparator branches (EQUAL, CONTAINS, IN, GREATER_THAN, …)
 * - parseRoutingValue for each `RoutingConditionType`
 * - the AND / OR group logic in `recursiveEvaluateRoutingConditions`
 * - `RoutingAction.BLOCK` short-circuiting the dispatcher with a 400
 * - traffic-split sampling (`then.traffic`)
 * - the `request.firstMessage` / `lastMessage` template variables
 *   defaulting to `undefined` on empty `messages`
 *
 * The service does not touch the DB; all collaborators are mocked. The
 * `matchCondition` private method is exercised through the public
 * `evaluateRoutingConditions` wrapper because it's the realistic seam.
 */

function makeService(): {
  service: ResourceRoutingService;
  metrics: { getErrorRate: ReturnType<typeof vi.fn> };
  capacity: { getCapacityUsage: ReturnType<typeof vi.fn> };
  aiConnection: { getById: ReturnType<typeof vi.fn> };
} {
  const logger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as PinoLogger;
  const metrics = {
    getErrorRate: vi.fn().mockResolvedValue({ errorRate: 0 }),
  };
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
    getById: vi.fn().mockResolvedValue({
      connectionId: 'conn-1',
      provider: 'openai',
      capacity: [],
      discoveredCapacity: null,
    }),
  };
  const service = new ResourceRoutingService(
    logger,
    metrics as unknown as CompletionMetricsService,
    capacity as never,
    aiConnection as never
  );
  return { service, metrics, capacity, aiConnection };
}

/**
 * Build a `RoutingContext` from a Chat-Completions-shape body. Tests
 * still construct requests in CC shape because that's the most natural
 * way to spell out a multi-turn conversation; the converter produces
 * the Responses-shape canonical body the routing engine actually
 * evaluates against.
 */
const baseRequest = (
  overrides: Partial<ChatCompletionCreateParams> = {}
): RoutingContext => {
  const body = {
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'hello' }],
    ...overrides,
  } as ChatCompletionCreateParams;
  return {
    format: 'chat-completions',
    responses: chatCompletionsToResponsesRequest(body),
    native: body,
  };
};

const buildResource = (
  conditions: Array<{
    description?: string;
    enabled?: boolean;
    operator: RoutingOperator;
    conditions: AIResourceRoutingCondition[];
    action?: RoutingAction;
    mode?: RoutingMode;
    expression?: string;
    then: {
      provider?: string;
      model?: string;
      connectionId?: string;
      traffic?: number;
    };
  }>
): AIResourceEntity =>
  ({
    resourceId: 'res-1',
    workspaceId: 'ws-1',
    environmentId: 'env-1',
    name: 'test',
    model: { provider: 'openai', model: 'fallback', connectionId: 'conn-1' },
    routing: {
      mode: RoutingMode.UI,
      conditions: conditions.map((c) => ({
        action: RoutingAction.CALL_MODEL,
        mode: RoutingMode.UI,
        ...c,
      })) as never,
    },
  } as unknown as AIResourceEntity);

const cond = (
  expression: string,
  comparator: RoutingComparator,
  value: { type: RoutingConditionType; expression?: string }
): AIResourceRoutingCondition =>
  ({
    expression,
    comparator,
    value,
  } as AIResourceRoutingCondition);

describe('ResourceRoutingService.evaluateRoutingConditions', () => {
  describe('comparator: EQUAL / NOT_EQUAL', () => {
    it('matches EQUAL on a request property', async () => {
      const { service } = makeService();
      const resource = buildResource([
        {
          operator: RoutingOperator.AND,
          conditions: [
            cond('request.model', RoutingComparator.EQUAL, {
              type: RoutingConditionType.STRING,
              expression: 'gpt-4o-mini',
            }),
          ],
          then: {
            provider: 'openai',
            model: 'matched-model',
            connectionId: 'conn-1',
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
      expect(result?.model.model).toBe('matched-model');
    });

    it('does not match NOT_EQUAL when values are identical', async () => {
      const { service } = makeService();
      const resource = buildResource([
        {
          operator: RoutingOperator.AND,
          conditions: [
            cond('request.model', RoutingComparator.NOT_EQUAL, {
              type: RoutingConditionType.STRING,
              expression: 'gpt-4o-mini',
            }),
          ],
          then: { model: 'no-match', connectionId: 'conn-1' },
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

  describe('comparator: CONTAINS / STARTS_WITH / ENDS_WITH', () => {
    const make = (comparator: RoutingComparator, expr: string) =>
      buildResource([
        {
          operator: RoutingOperator.AND,
          conditions: [
            cond('request.lastMessage.content', comparator, {
              type: RoutingConditionType.STRING,
              expression: expr,
            }),
          ],
          then: { model: 'chosen', connectionId: 'conn-1' },
        },
      ]);

    it('CONTAINS matches a substring', async () => {
      const { service } = makeService();
      const result = await service.evaluateRoutingConditions(
        'ws-1',
        'env-1',
        baseRequest({ messages: [{ role: 'user', content: 'hello world' }] }),
        10,
        make(RoutingComparator.CONTAINS, 'world')
      );
      expect(result?.model.model).toBe('chosen');
    });

    it('STARTS_WITH matches a prefix only', async () => {
      const { service } = makeService();
      const matched = await service.evaluateRoutingConditions(
        'ws-1',
        'env-1',
        baseRequest({ messages: [{ role: 'user', content: 'hello world' }] }),
        10,
        make(RoutingComparator.STARTS_WITH, 'hello')
      );
      expect(matched).not.toBeNull();
      const unmatched = await service.evaluateRoutingConditions(
        'ws-1',
        'env-1',
        baseRequest({ messages: [{ role: 'user', content: 'hello world' }] }),
        10,
        make(RoutingComparator.STARTS_WITH, 'world')
      );
      expect(unmatched).toBeNull();
    });

    it('ENDS_WITH matches a suffix only', async () => {
      const { service } = makeService();
      const result = await service.evaluateRoutingConditions(
        'ws-1',
        'env-1',
        baseRequest({ messages: [{ role: 'user', content: 'hello world' }] }),
        10,
        make(RoutingComparator.ENDS_WITH, 'world')
      );
      expect(result).not.toBeNull();
    });
  });

  describe('comparator: PATTERN (regex)', () => {
    it('matches a regex against the resolved expression value', async () => {
      const { service } = makeService();
      const resource = buildResource([
        {
          operator: RoutingOperator.AND,
          conditions: [
            cond('request.model', RoutingComparator.PATTERN, {
              type: RoutingConditionType.STRING,
              expression: '^gpt-4o',
            }),
          ],
          then: { model: 'matched', connectionId: 'conn-1' },
        },
      ]);
      const result = await service.evaluateRoutingConditions(
        'ws-1',
        'env-1',
        baseRequest(),
        10,
        resource
      );
      expect(result?.model.model).toBe('matched');
    });
  });

  describe('comparator: IN / NOT_IN', () => {
    it('matches IN against a JSON_ARRAY of strings', async () => {
      const { service } = makeService();
      const resource = buildResource([
        {
          operator: RoutingOperator.AND,
          conditions: [
            cond('request.model', RoutingComparator.IN, {
              type: RoutingConditionType.JSON_ARRAY,
              expression: '["gpt-4o", "gpt-4o-mini", "gpt-4o-nano"]',
            }),
          ],
          then: { model: 'matched', connectionId: 'conn-1' },
        },
      ]);
      const result = await service.evaluateRoutingConditions(
        'ws-1',
        'env-1',
        baseRequest(),
        10,
        resource
      );
      expect(result).not.toBeNull();
    });

    it('returns false on NOT_IN when value is in the list', async () => {
      const { service } = makeService();
      const resource = buildResource([
        {
          operator: RoutingOperator.AND,
          conditions: [
            cond('request.model', RoutingComparator.NOT_IN, {
              type: RoutingConditionType.JSON_ARRAY,
              expression: '["gpt-4o-mini"]',
            }),
          ],
          then: { model: 'no-match', connectionId: 'conn-1' },
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

    it('matches IN against a comma-delimited list', async () => {
      const { service } = makeService();
      const resource = buildResource([
        {
          operator: RoutingOperator.AND,
          conditions: [
            cond('request.model', RoutingComparator.IN, {
              type: RoutingConditionType.COMMA_DELIMITED_LIST,
              expression: 'gpt-4o,gpt-4o-mini,gpt-4o-nano',
            }),
          ],
          then: { model: 'comma-list-match', connectionId: 'conn-1' },
        },
      ]);
      const result = await service.evaluateRoutingConditions(
        'ws-1',
        'env-1',
        baseRequest(),
        10,
        resource
      );
      expect(result?.model.model).toBe('comma-list-match');
    });
  });

  describe('comparator: numeric (GREATER_THAN, LESS_THAN_OR_EQUAL, ...)', () => {
    const numericResource = (
      comparator: RoutingComparator,
      threshold: string
    ) =>
      buildResource([
        {
          operator: RoutingOperator.AND,
          conditions: [
            cond('tokens.input', comparator, {
              type: RoutingConditionType.NUMBER,
              expression: threshold,
            }),
          ],
          then: { model: 'numeric-match', connectionId: 'conn-1' },
        },
      ]);

    it('GREATER_THAN matches strictly greater', async () => {
      const { service } = makeService();
      const above = await service.evaluateRoutingConditions(
        'ws-1',
        'env-1',
        baseRequest(),
        100,
        numericResource(RoutingComparator.GREATER_THAN, '50')
      );
      expect(above).not.toBeNull();
      const equal = await service.evaluateRoutingConditions(
        'ws-1',
        'env-1',
        baseRequest(),
        50,
        numericResource(RoutingComparator.GREATER_THAN, '50')
      );
      expect(equal).toBeNull();
    });

    it('GREATER_THAN_OR_EQUAL accepts equality at the boundary', async () => {
      const { service } = makeService();
      const result = await service.evaluateRoutingConditions(
        'ws-1',
        'env-1',
        baseRequest(),
        50,
        numericResource(RoutingComparator.GREATER_THAN_OR_EQUAL, '50')
      );
      expect(result).not.toBeNull();
    });

    it('LESS_THAN_OR_EQUAL drops above the boundary', async () => {
      const { service } = makeService();
      const below = await service.evaluateRoutingConditions(
        'ws-1',
        'env-1',
        baseRequest(),
        50,
        numericResource(RoutingComparator.LESS_THAN_OR_EQUAL, '50')
      );
      expect(below).not.toBeNull();
      const above = await service.evaluateRoutingConditions(
        'ws-1',
        'env-1',
        baseRequest(),
        51,
        numericResource(RoutingComparator.LESS_THAN_OR_EQUAL, '50')
      );
      expect(above).toBeNull();
    });
  });

  describe('comparator: EXISTS', () => {
    it('matches when the expression resolves to a truthy value', async () => {
      const { service } = makeService();
      const resource = buildResource([
        {
          operator: RoutingOperator.AND,
          conditions: [
            // EXISTS uses the resolvedValue check too; supply a sentinel
            // expression that resolves truthy so the helper proceeds.
            cond('request.model', RoutingComparator.EXISTS, {
              type: RoutingConditionType.STRING,
              expression: 'gpt-4o-mini',
            }),
          ],
          then: { model: 'exists-match', connectionId: 'conn-1' },
        },
      ]);
      const result = await service.evaluateRoutingConditions(
        'ws-1',
        'env-1',
        baseRequest(),
        10,
        resource
      );
      expect(result).not.toBeNull();
    });
  });

  describe('AND / OR groups', () => {
    it('AND requires every condition to match', async () => {
      const { service } = makeService();
      const resource = buildResource([
        {
          operator: RoutingOperator.AND,
          conditions: [
            cond('request.model', RoutingComparator.EQUAL, {
              type: RoutingConditionType.STRING,
              expression: 'gpt-4o-mini',
            }),
            cond('request.lastMessage.role', RoutingComparator.EQUAL, {
              type: RoutingConditionType.STRING,
              expression: 'user',
            }),
          ],
          then: { model: 'both-matched', connectionId: 'conn-1' },
        },
      ]);
      const result = await service.evaluateRoutingConditions(
        'ws-1',
        'env-1',
        baseRequest(),
        10,
        resource
      );
      expect(result?.model.model).toBe('both-matched');
    });

    it('AND drops when any condition fails', async () => {
      const { service } = makeService();
      const resource = buildResource([
        {
          operator: RoutingOperator.AND,
          conditions: [
            cond('request.model', RoutingComparator.EQUAL, {
              type: RoutingConditionType.STRING,
              expression: 'gpt-4o-mini',
            }),
            cond('request.lastMessage.role', RoutingComparator.EQUAL, {
              type: RoutingConditionType.STRING,
              expression: 'system',
            }),
          ],
          then: { model: 'no-match', connectionId: 'conn-1' },
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

    it('OR matches when at least one condition matches', async () => {
      const { service } = makeService();
      const resource = buildResource([
        {
          operator: RoutingOperator.OR,
          conditions: [
            cond('request.model', RoutingComparator.EQUAL, {
              type: RoutingConditionType.STRING,
              expression: 'totally-different',
            }),
            cond('request.lastMessage.role', RoutingComparator.EQUAL, {
              type: RoutingConditionType.STRING,
              expression: 'user',
            }),
          ],
          then: { model: 'or-match', connectionId: 'conn-1' },
        },
      ]);
      const result = await service.evaluateRoutingConditions(
        'ws-1',
        'env-1',
        baseRequest(),
        10,
        resource
      );
      expect(result?.model.model).toBe('or-match');
    });
  });

  describe('disabled groups + falling through', () => {
    it('skips a group with `enabled: false`', async () => {
      const { service } = makeService();
      const resource = buildResource([
        {
          enabled: false,
          operator: RoutingOperator.AND,
          conditions: [
            cond('request.model', RoutingComparator.EQUAL, {
              type: RoutingConditionType.STRING,
              expression: 'gpt-4o-mini',
            }),
          ],
          then: { model: 'should-not-match', connectionId: 'conn-1' },
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

    it('returns null when no group matches', async () => {
      const { service } = makeService();
      const resource = buildResource([
        {
          operator: RoutingOperator.AND,
          conditions: [
            cond('request.model', RoutingComparator.EQUAL, {
              type: RoutingConditionType.STRING,
              expression: 'no-such-model',
            }),
          ],
          then: { model: 'unmatched', connectionId: 'conn-1' },
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

  describe('action: BLOCK', () => {
    it('throws CompletionError(400) on a matched BLOCK group', async () => {
      const { service } = makeService();
      const resource = buildResource([
        {
          description: 'block fishy prompts',
          operator: RoutingOperator.AND,
          action: RoutingAction.BLOCK,
          conditions: [
            cond('request.lastMessage.content', RoutingComparator.CONTAINS, {
              type: RoutingConditionType.STRING,
              expression: 'phish',
            }),
          ],
          then: {} as never,
        },
      ]);
      await expect(
        service.evaluateRoutingConditions(
          'ws-1',
          'env-1',
          baseRequest({
            messages: [{ role: 'user', content: 'phishing test' }],
          }),
          10,
          resource
        )
      ).rejects.toBeInstanceOf(CompletionError);
    });
  });

  describe('traffic split', () => {
    const realRandom = Math.random;
    beforeEach(() => {
      Math.random = realRandom;
    });
    afterEach(() => {
      Math.random = realRandom;
    });

    it('takes the route when sample falls under the traffic %', async () => {
      const { service } = makeService();
      Math.random = () => 0.1; // 10% — under a 50% threshold
      const resource = buildResource([
        {
          operator: RoutingOperator.AND,
          conditions: [
            cond('request.model', RoutingComparator.EQUAL, {
              type: RoutingConditionType.STRING,
              expression: 'gpt-4o-mini',
            }),
          ],
          then: {
            model: 'fifty-percent-route',
            connectionId: 'conn-1',
            traffic: 50,
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
      expect(result?.model.model).toBe('fifty-percent-route');
    });

    it('skips the route when sample exceeds the traffic %', async () => {
      const { service } = makeService();
      Math.random = () => 0.9;
      const resource = buildResource([
        {
          operator: RoutingOperator.AND,
          conditions: [
            cond('request.model', RoutingComparator.EQUAL, {
              type: RoutingConditionType.STRING,
              expression: 'gpt-4o-mini',
            }),
          ],
          then: {
            model: 'twenty-percent-route',
            connectionId: 'conn-1',
            traffic: 20,
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
      expect(result).toBeNull();
    });
  });

  describe('capacityUsage template helper', () => {
    const capacityResource = (expression: string, threshold: string) =>
      buildResource([
        {
          operator: RoutingOperator.AND,
          conditions: [
            cond(expression, RoutingComparator.GREATER_THAN, {
              type: RoutingConditionType.NUMBER,
              expression: threshold,
            }),
          ],
          then: { model: 'overflow', connectionId: 'conn-2' },
        },
      ]);

    it('routes when tokensUsagePercent exceeds the threshold', async () => {
      const { service, capacity } = makeService();
      capacity.getCapacityUsage.mockResolvedValue({
        totalRequests: 5,
        totalTokens: 8500,
        remainingSeconds: 30,
        requestsLimit: 100,
        tokensLimit: 10000,
        requestsLimitSource: 'connection',
        tokensLimitSource: 'connection',
        remainingRequests: 95,
        remainingTokens: 1500,
        requestsUsagePercent: 5,
        tokensUsagePercent: 85,
      });
      const result = await service.evaluateRoutingConditions(
        'ws-1',
        'env-1',
        baseRequest(),
        10,
        capacityResource(
          '<% return (await capacityUsage("minute"))?.tokensUsagePercent %>',
          '80'
        )
      );
      expect(result?.model.model).toBe('overflow');
    });

    it('does not route when usage is below threshold', async () => {
      const { service, capacity } = makeService();
      capacity.getCapacityUsage.mockResolvedValue({
        totalRequests: 5,
        totalTokens: 1000,
        remainingSeconds: 30,
        requestsLimit: 100,
        tokensLimit: 10000,
        requestsLimitSource: 'connection',
        tokensLimitSource: 'connection',
        remainingRequests: 95,
        remainingTokens: 9000,
        requestsUsagePercent: 5,
        tokensUsagePercent: 10,
      });
      const result = await service.evaluateRoutingConditions(
        'ws-1',
        'env-1',
        baseRequest(),
        10,
        capacityResource(
          '<% return (await capacityUsage("minute"))?.tokensUsagePercent %>',
          '80'
        )
      );
      expect(result).toBeNull();
    });

    it('is inert when the axis has no configured limit (percent is null)', async () => {
      const { service, capacity } = makeService();
      capacity.getCapacityUsage.mockResolvedValue({
        totalRequests: 5,
        totalTokens: 5000,
        remainingSeconds: 30,
        requestsLimit: null,
        tokensLimit: null,
        requestsLimitSource: null,
        tokensLimitSource: null,
        remainingRequests: null,
        remainingTokens: null,
        requestsUsagePercent: null,
        tokensUsagePercent: null,
      });
      const result = await service.evaluateRoutingConditions(
        'ws-1',
        'env-1',
        baseRequest(),
        10,
        capacityResource(
          '<% return (await capacityUsage("minute"))?.tokensUsagePercent %>',
          '0'
        )
      );
      expect(result).toBeNull();
    });

    it('memoises per (period, conn, model) — multiple groups touching the same axis hit one Redis read', async () => {
      const { service, capacity } = makeService();
      capacity.getCapacityUsage.mockResolvedValue({
        totalRequests: 0,
        totalTokens: 9500,
        remainingSeconds: 30,
        requestsLimit: 100,
        tokensLimit: 10000,
        requestsLimitSource: 'connection',
        tokensLimitSource: 'connection',
        remainingRequests: 100,
        remainingTokens: 500,
        requestsUsagePercent: 0,
        tokensUsagePercent: 95,
      });
      const resource = buildResource([
        {
          operator: RoutingOperator.AND,
          conditions: [
            cond(
              '<% return (await capacityUsage("minute"))?.tokensUsagePercent %>',
              RoutingComparator.GREATER_THAN,
              { type: RoutingConditionType.NUMBER, expression: '999' }
            ),
          ],
          then: { model: 'unmatched', connectionId: 'conn-1' },
        },
        {
          operator: RoutingOperator.AND,
          conditions: [
            cond(
              '<% return (await capacityUsage("minute"))?.remainingTokens %>',
              RoutingComparator.LESS_THAN,
              { type: RoutingConditionType.NUMBER, expression: '1000' }
            ),
          ],
          then: { model: 'matched', connectionId: 'conn-2' },
        },
      ]);
      const result = await service.evaluateRoutingConditions(
        'ws-1',
        'env-1',
        baseRequest(),
        10,
        resource
      );
      expect(result?.model.model).toBe('matched');
      expect(capacity.getCapacityUsage).toHaveBeenCalledTimes(1);
    });

    it('drops out gracefully when the connection cannot be resolved', async () => {
      const { service, capacity, aiConnection } = makeService();
      aiConnection.getById.mockResolvedValue(undefined);
      const result = await service.evaluateRoutingConditions(
        'ws-1',
        'env-1',
        baseRequest(),
        10,
        capacityResource(
          '<% return (await capacityUsage("minute", "missing-conn"))?.tokensUsagePercent %>',
          '0'
        )
      );
      expect(result).toBeNull();
      // No connection means no Redis call — fail fast.
      expect(capacity.getCapacityUsage).not.toHaveBeenCalled();
    });
  });

  describe('metadata-dimensioned routing', () => {
    // The routing engine reads `metadata` from the explicit parameter
    // on `evaluateRoutingConditions`, not from the request body. So
    // each test just builds a vanilla context here and passes the
    // metadata map separately below.
    const requestContext = (): RoutingContext =>
      baseRequest({ messages: [{ role: 'user', content: 'hi' }] });

    const buildMetadataResource = (
      expression: string,
      threshold: string
    ): AIResourceEntity =>
      buildResource([
        {
          operator: RoutingOperator.AND,
          conditions: [
            cond(expression, RoutingComparator.EQUAL, {
              type: RoutingConditionType.STRING,
              expression: threshold,
            }),
          ],
          then: { model: 'metadata-route', connectionId: 'conn-2' },
        },
      ]);

    it("matches the new clean-path shape `metadata['team']`", async () => {
      const { service } = makeService();
      const result = await service.evaluateRoutingConditions(
        'ws-1',
        'env-1',
        requestContext(),
        10,
        buildMetadataResource("metadata['team']", 'growth'),
        undefined,
        undefined,
        { team: 'growth' }
      );
      expect(result?.model.model).toBe('metadata-route');
    });

    it("matches the legacy `request.metadata?.['team']` shape — `?.` stripped before `lodash.get`", async () => {
      const { service } = makeService();
      const result = await service.evaluateRoutingConditions(
        'ws-1',
        'env-1',
        requestContext(),
        10,
        buildMetadataResource("request.metadata?.['team']", 'growth'),
        undefined,
        undefined,
        { team: 'growth' }
      );
      expect(result?.model.model).toBe('metadata-route');
    });

    it('does not route when the metadata value mismatches', async () => {
      const { service } = makeService();
      const result = await service.evaluateRoutingConditions(
        'ws-1',
        'env-1',
        requestContext(),
        10,
        buildMetadataResource("metadata['team']", 'growth'),
        undefined,
        undefined,
        { team: 'platform' }
      );
      expect(result).toBeNull();
    });

    it('does not route when metadata is entirely absent (field missing)', async () => {
      const { service } = makeService();
      const result = await service.evaluateRoutingConditions(
        'ws-1',
        'env-1',
        requestContext(),
        10,
        buildMetadataResource("metadata['team']", 'growth'),
        undefined,
        undefined,
        undefined
      );
      expect(result).toBeNull();
    });
  });

  describe('empty messages', () => {
    it('does not crash when request.messages is empty (firstMessage/lastMessage default to undefined)', async () => {
      const { service } = makeService();
      const resource = buildResource([
        {
          operator: RoutingOperator.AND,
          conditions: [
            cond('request.messagesCount', RoutingComparator.EQUAL, {
              type: RoutingConditionType.NUMBER,
              expression: '0',
            }),
          ],
          then: { model: 'empty-route', connectionId: 'conn-1' },
        },
      ]);
      const result = await service.evaluateRoutingConditions(
        'ws-1',
        'env-1',
        baseRequest({ messages: [] }),
        10,
        resource
      );
      expect(result?.model.model).toBe('empty-route');
    });
  });
});
