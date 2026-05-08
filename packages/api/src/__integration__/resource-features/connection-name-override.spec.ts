import { describe, expect, it, vi } from 'vitest';
import { buildCompletionFlowHarness } from '../helpers/completion-flow';
import type { CompletionRequestDto } from '../../gateway/dto/completion-request.dto';
import type { AIResourceEntity } from '../../ai-resource/entities/ai-resource.entity';

/**
 * End-to-end coverage for the `connectionName` form on AI Resource
 * model configs. Two call sites:
 *
 *  1. **Per-request `vmx.resourceConfigOverrides`** — a caller sends
 *     `model: { provider, model, connectionName: 'my-conn' }` instead
 *     of looking up the connection UUID first. The orchestrator
 *     resolves the name to an ID before merging the override into
 *     the resource entity.
 *  2. **At-rest creation/update** is covered by the resolver's unit
 *     test in `model-resolver.spec.ts` — that path runs entirely in
 *     `AIResourceService` and doesn't need the full flow harness.
 *
 * The flow harness wires real `AIConnectionService` / `AIResourceService`
 * stubs, so this spec exercises the actual `getAIResource` path in
 * `CompletionService`.
 */

const baseResource: AIResourceEntity = {
  resourceId: 'res-1',
  workspaceId: 'ws-1',
  environmentId: 'env-1',
  name: 'default',
  description: null,
  model: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    connectionId: 'uuid-original',
  },
  fallbackModels: [],
  secondaryModels: [],
  routing: null,
  capacity: [],
  useFallback: false,
  enforceCapacity: false,
} as unknown as AIResourceEntity;

describe('vmx.resourceConfigOverrides — connectionName resolution', () => {
  it('resolves model.connectionName to a connectionId before dispatch', async () => {
    const { service, spies, aiConnectionService } = buildCompletionFlowHarness({
      resource: baseResource,
    });
    // Stub the per-name lookup. The flow harness's default
    // `getByName` returns null; override for this test.
    (
      aiConnectionService.getByName as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      connectionId: 'uuid-from-name',
      name: 'my-conn',
    });

    const payload = {
      model: 'default',
      messages: [{ role: 'user', content: 'hi' }],
      vmx: {
        resourceConfigOverrides: {
          model: {
            provider: 'openai',
            model: 'gpt-4o',
            connectionName: 'my-conn',
          },
        },
      },
    } as unknown as CompletionRequestDto;

    await service.completion('ws-1', 'env-1', payload);

    // Did the resolver get called with the right name?
    expect(aiConnectionService.getByName).toHaveBeenCalledWith(
      'ws-1',
      'env-1',
      'my-conn',
      false
    );
    // The dispatched call uses the resolved UUID — the orchestrator's
    // `getById` is the canonical way to fetch the connection for the
    // dispatcher; assert it was invoked with the resolved id.
    const getByIdCall = (
      aiConnectionService.getById as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(getByIdCall.connectionId).toBe('uuid-from-name');
    // Sanity: the provider was actually called.
    expect(spies.providerCompletion).toHaveBeenCalled();
  });

  it('connectionId on the override wins over connectionName (no name lookup)', async () => {
    const { service, aiConnectionService } = buildCompletionFlowHarness({
      resource: baseResource,
    });

    const payload = {
      model: 'default',
      messages: [{ role: 'user', content: 'hi' }],
      vmx: {
        resourceConfigOverrides: {
          model: {
            provider: 'openai',
            model: 'gpt-4o',
            connectionId: 'uuid-explicit',
            connectionName: 'my-conn',
          },
        },
      },
    } as unknown as CompletionRequestDto;

    await service.completion('ws-1', 'env-1', payload);

    expect(aiConnectionService.getByName).not.toHaveBeenCalled();
    const getByIdCall = (
      aiConnectionService.getById as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    expect(getByIdCall.connectionId).toBe('uuid-explicit');
  });

  it('a missing connectionName 400s before dispatch', async () => {
    const { service, spies, aiConnectionService } = buildCompletionFlowHarness({
      resource: baseResource,
    });
    (
      aiConnectionService.getByName as ReturnType<typeof vi.fn>
    ).mockResolvedValue(undefined);

    const payload = {
      model: 'default',
      messages: [{ role: 'user', content: 'hi' }],
      vmx: {
        resourceConfigOverrides: {
          model: {
            provider: 'openai',
            model: 'gpt-4o',
            connectionName: 'missing-conn',
          },
        },
      },
    } as unknown as CompletionRequestDto;

    await expect(
      service.completion('ws-1', 'env-1', payload)
    ).rejects.toMatchObject({
      // HttpException carries the status on `.status`; the inner
      // ServiceError details say which connection couldn't be resolved.
      status: 400,
    });
    expect(spies.providerCompletion).not.toHaveBeenCalled();
  });

  it('does not run the resolver when no override is set (zero overhead path)', async () => {
    const { service, aiConnectionService } = buildCompletionFlowHarness({
      resource: baseResource,
    });

    const payload = {
      model: 'default',
      messages: [{ role: 'user', content: 'hi' }],
    } as unknown as CompletionRequestDto;

    await service.completion('ws-1', 'env-1', payload);
    expect(aiConnectionService.getByName).not.toHaveBeenCalled();
    const getByIdCall = (
      aiConnectionService.getById as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    // Falls back to the resource's stored connectionId.
    expect(getByIdCall.connectionId).toBe('uuid-original');
  });

  it('resolves connectionName on every override slot — fallbackModels', async () => {
    const { service, spies, aiConnectionService } = buildCompletionFlowHarness({
      resource: {
        ...baseResource,
        fallbackModels: [
          {
            provider: 'openai',
            model: 'gpt-4o-mini',
            connectionId: 'uuid-original-fb',
          },
        ],
      } as unknown as AIResourceEntity,
    });
    (
      aiConnectionService.getByName as ReturnType<typeof vi.fn>
    ).mockImplementation(async (_ws, _env, name) => {
      if (name === 'fb-conn-by-name') {
        return { connectionId: 'uuid-fb-from-name', name };
      }
      return undefined;
    });

    // Make the primary fail so the fallback is exercised.
    spies.providerCompletion.mockImplementationOnce(() => {
      throw new Error('primary failed');
    });

    const payload = {
      model: 'default',
      messages: [{ role: 'user', content: 'hi' }],
      vmx: {
        resourceConfigOverrides: {
          fallbackModels: [
            {
              provider: 'openai',
              model: 'gpt-4o',
              connectionName: 'fb-conn-by-name',
            },
          ],
        },
      },
    } as unknown as CompletionRequestDto;

    await service.completion('ws-1', 'env-1', payload);

    // Both legs of the chain reached `getById`. The 2nd call (the
    // fallback) used the resolved UUID.
    const getByIdCalls = (
      aiConnectionService.getById as ReturnType<typeof vi.fn>
    ).mock.calls;
    expect(getByIdCalls.length).toBeGreaterThanOrEqual(2);
    expect(getByIdCalls[1][0].connectionId).toBe('uuid-fb-from-name');
  });
});
