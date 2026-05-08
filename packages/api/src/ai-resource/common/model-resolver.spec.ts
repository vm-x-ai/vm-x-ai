import { describe, expect, it, vi, beforeEach } from 'vitest';
import { HttpException } from '@nestjs/common';
import {
  resolveAllModelConnections,
  resolveModelConfig,
} from './model-resolver';
import { ErrorCode } from '../../error-code';
import {
  RoutingItemType,
  RoutingAction,
  RoutingMode,
  RoutingOperator,
} from './routing.entity';
import type { AIConnectionService } from '../../ai-connection/ai-connection.service';

/**
 * Pull the ServiceError payload off a throwServiceError-thrown
 * HttpException so tests can assert on `errorCode` + the structured
 * `details` map (which carries `context` / `connectionName`).
 */
function getServiceError(e: unknown): {
  errorCode: ErrorCode;
  details: Record<string, unknown>;
  statusCode: number;
} {
  if (!(e instanceof HttpException)) {
    throw new Error(`expected HttpException, got ${e}`);
  }
  const response = e.getResponse() as {
    errorCode: ErrorCode;
    details: Record<string, unknown>;
  };
  return {
    errorCode: response.errorCode,
    details: response.details,
    statusCode: e.getStatus(),
  };
}

/**
 * Class-layer unit tests for the connection-name resolver. The resolver
 * is the linchpin of the new "send `connectionName` instead of
 * `connectionId`" UX — it runs in two places (create / update on the
 * AI Resource service, and the per-request `vmx.resourceConfigOverrides`
 * merge in the gateway), so it has to handle nested model configs
 * deeply: primary `model`, every fallback / secondary, and every
 * routing `then.<model>` reachable via nested condition groups.
 */

const WORKSPACE_ID = 'ws-1';
const ENVIRONMENT_ID = 'env-1';

function makeAIConnectionService(connections: Record<string, string>) {
  return {
    getByName: vi.fn(async (_ws: string, _env: string, name: string) => {
      const connectionId = connections[name];
      return connectionId ? { connectionId, name } : undefined;
    }),
  } as unknown as AIConnectionService;
}

describe('resolveModelConfig', () => {
  it('returns the input unchanged when connectionId is set', async () => {
    const svc = makeAIConnectionService({});
    const out = await resolveModelConfig(
      { provider: 'openai', model: 'gpt-4o', connectionId: 'uuid-1' },
      WORKSPACE_ID,
      ENVIRONMENT_ID,
      svc
    );
    expect(out.connectionId).toBe('uuid-1');
    expect(svc.getByName).not.toHaveBeenCalled();
  });

  it('connectionId wins over connectionName when both are set (no lookup)', async () => {
    const svc = makeAIConnectionService({ 'my-conn': 'uuid-from-name' });
    const out = await resolveModelConfig(
      {
        provider: 'openai',
        model: 'gpt-4o',
        connectionId: 'uuid-explicit',
        connectionName: 'my-conn',
      },
      WORKSPACE_ID,
      ENVIRONMENT_ID,
      svc
    );
    expect(out.connectionId).toBe('uuid-explicit');
    expect(svc.getByName).not.toHaveBeenCalled();
  });

  it('resolves connectionName → connectionId when only the name is set', async () => {
    const svc = makeAIConnectionService({ 'my-conn': 'uuid-resolved' });
    const out = await resolveModelConfig(
      {
        provider: 'openai',
        model: 'gpt-4o',
        connectionName: 'my-conn',
      },
      WORKSPACE_ID,
      ENVIRONMENT_ID,
      svc
    );
    expect(out.connectionId).toBe('uuid-resolved');
    expect(svc.getByName).toHaveBeenCalledWith(
      WORKSPACE_ID,
      ENVIRONMENT_ID,
      'my-conn',
      false
    );
  });

  it('throws AI_CONNECTION_NOT_FOUND when neither field is set', async () => {
    const svc = makeAIConnectionService({});
    let caught: unknown;
    try {
      await resolveModelConfig(
        { provider: 'openai', model: 'gpt-4o' } as never,
        WORKSPACE_ID,
        ENVIRONMENT_ID,
        svc
      );
    } catch (e) {
      caught = e;
    }
    const err = getServiceError(caught);
    expect(err.statusCode).toBe(400);
    expect(err.errorCode).toBe(ErrorCode.AI_CONNECTION_NOT_FOUND);
    expect(err.details.reason).toMatch(/connectionId.*connectionName/);
  });

  it('throws AI_CONNECTION_NOT_FOUND when connectionName is set but does not exist', async () => {
    const svc = makeAIConnectionService({ 'real-conn': 'uuid-1' });
    let caught: unknown;
    try {
      await resolveModelConfig(
        { provider: 'openai', model: 'gpt-4o', connectionName: 'missing-conn' },
        WORKSPACE_ID,
        ENVIRONMENT_ID,
        svc
      );
    } catch (e) {
      caught = e;
    }
    const err = getServiceError(caught);
    expect(err.errorCode).toBe(ErrorCode.AI_CONNECTION_NOT_FOUND);
    expect(err.details).toMatchObject({ connectionName: 'missing-conn' });
  });

  it('does not mutate the input config (returns a copy)', async () => {
    const svc = makeAIConnectionService({ 'my-conn': 'uuid-1' });
    const input = {
      provider: 'openai',
      model: 'gpt-4o',
      connectionName: 'my-conn',
    };
    const out = await resolveModelConfig(
      input,
      WORKSPACE_ID,
      ENVIRONMENT_ID,
      svc
    );
    expect(input).not.toHaveProperty('connectionId');
    expect(out.connectionId).toBe('uuid-1');
  });

  it('error context labels which slot failed', async () => {
    const svc = makeAIConnectionService({});
    let caught: unknown;
    try {
      await resolveModelConfig(
        { provider: 'openai', model: 'gpt-4o' } as never,
        WORKSPACE_ID,
        ENVIRONMENT_ID,
        svc,
        'fallbackModels[2]'
      );
    } catch (e) {
      caught = e;
    }
    expect(getServiceError(caught).details).toMatchObject({
      context: 'fallbackModels[2]',
    });
  });
});

describe('resolveAllModelConnections', () => {
  let svc: ReturnType<typeof makeAIConnectionService>;

  beforeEach(() => {
    svc = makeAIConnectionService({
      primary: 'uuid-primary',
      'fb-1': 'uuid-fb-1',
      'fb-2': 'uuid-fb-2',
      'sec-1': 'uuid-sec-1',
      'route-fast': 'uuid-route-fast',
      'route-cheap': 'uuid-route-cheap',
    });
  });

  it('resolves the primary model only when it is the only slot set', async () => {
    const out = await resolveAllModelConnections(
      {
        model: {
          provider: 'openai',
          model: 'gpt-4o',
          connectionName: 'primary',
        },
      },
      WORKSPACE_ID,
      ENVIRONMENT_ID,
      svc
    );
    expect(out.model?.connectionId).toBe('uuid-primary');
    expect(out.fallbackModels).toBeUndefined();
    expect(out.secondaryModels).toBeUndefined();
    expect(out.routing).toBeUndefined();
  });

  it('resolves every fallbackModel + secondaryModel by name', async () => {
    const out = await resolveAllModelConnections(
      {
        model: {
          provider: 'openai',
          model: 'gpt-4o',
          connectionId: 'uuid-existing',
        },
        fallbackModels: [
          { provider: 'openai', model: 'gpt-4o-mini', connectionName: 'fb-1' },
          {
            provider: 'anthropic',
            model: 'claude-haiku-4-5',
            connectionName: 'fb-2',
          },
        ],
        secondaryModels: [
          { provider: 'openai', model: 'gpt-4o', connectionName: 'sec-1' },
        ],
      },
      WORKSPACE_ID,
      ENVIRONMENT_ID,
      svc
    );
    expect(out.fallbackModels?.[0].connectionId).toBe('uuid-fb-1');
    expect(out.fallbackModels?.[1].connectionId).toBe('uuid-fb-2');
    expect(out.secondaryModels?.[0].connectionId).toBe('uuid-sec-1');
  });

  it('resolves nested routing condition group `then.connectionName` references', async () => {
    const out = await resolveAllModelConnections(
      {
        model: {
          provider: 'openai',
          model: 'gpt-4o',
          connectionId: 'uuid-existing',
        },
        routing: {
          enabled: true,
          conditions: [
            {
              type: RoutingItemType.GROUP,
              operator: RoutingOperator.AND,
              action: RoutingAction.CALL_MODEL,
              mode: RoutingMode.UI,
              conditions: [],
              then: {
                provider: 'openai',
                model: 'gpt-4o-mini',
                connectionName: 'route-fast',
              },
            },
          ],
        },
      },
      WORKSPACE_ID,
      ENVIRONMENT_ID,
      svc
    );
    expect(out.routing?.conditions?.[0].then.connectionId).toBe(
      'uuid-route-fast'
    );
  });

  it('walks deeply nested routing groups', async () => {
    const out = await resolveAllModelConnections(
      {
        routing: {
          enabled: true,
          conditions: [
            {
              type: RoutingItemType.GROUP,
              operator: RoutingOperator.AND,
              action: RoutingAction.CALL_MODEL,
              mode: RoutingMode.UI,
              then: {
                provider: 'openai',
                model: 'gpt-4o-mini',
                connectionName: 'route-fast',
              },
              conditions: [
                {
                  type: RoutingItemType.GROUP,
                  operator: RoutingOperator.OR,
                  action: RoutingAction.CALL_MODEL,
                  mode: RoutingMode.UI,
                  conditions: [],
                  then: {
                    provider: 'openai',
                    model: 'gpt-4o',
                    connectionName: 'route-cheap',
                  },
                },
              ],
            },
          ],
        },
      },
      WORKSPACE_ID,
      ENVIRONMENT_ID,
      svc
    );
    const outer = out.routing?.conditions?.[0];
    expect(outer?.then.connectionId).toBe('uuid-route-fast');
    const inner = outer?.conditions?.[0] as {
      then?: { connectionId?: string };
    };
    expect(inner?.then?.connectionId).toBe('uuid-route-cheap');
  });

  it('returns an empty result when the resource has no model slots set', async () => {
    const out = await resolveAllModelConnections(
      {},
      WORKSPACE_ID,
      ENVIRONMENT_ID,
      svc
    );
    expect(out).toEqual({});
    expect(svc.getByName).not.toHaveBeenCalled();
  });

  it('error from a nested fallback bubbles up with its slot label', async () => {
    let caught: unknown;
    try {
      await resolveAllModelConnections(
        {
          fallbackModels: [
            {
              provider: 'openai',
              model: 'gpt-4o-mini',
              connectionName: 'fb-1',
            },
            {
              provider: 'openai',
              model: 'gpt-4o',
              connectionName: 'does-not-exist',
            },
          ],
        },
        WORKSPACE_ID,
        ENVIRONMENT_ID,
        svc
      );
    } catch (e) {
      caught = e;
    }
    expect(getServiceError(caught).details).toMatchObject({
      context: 'fallbackModels[1]',
      connectionName: 'does-not-exist',
    });
  });
});
