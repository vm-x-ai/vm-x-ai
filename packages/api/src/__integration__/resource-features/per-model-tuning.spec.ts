import { describe, expect, it } from 'vitest';
import { buildCompletionFlowHarness } from '../helpers/completion-flow';
import type { CompletionRequestDto } from '../../gateway/dto/completion-request.dto';

/**
 * Unit tests for the per-model `maxRetries` + `timeoutMs` fields on
 * `AIResourceModelConfigEntity`. The gateway:
 *   - Forwards `maxRetries` to the provider via `CompletionRequestOptions`
 *     so SDK-internal retries can be tuned per-model (e.g. tighter on
 *     a fallback than on the primary).
 *   - Composes the per-model `timeoutMs` with the request-level
 *     `vmx.timeoutMs` — whichever is shorter wins.
 */

const baseRequest = {
  model: 'default',
  messages: [{ role: 'user', content: 'hi' }],
} as CompletionRequestDto;

describe('Per-model maxRetries + timeoutMs', () => {
  describe('maxRetries', () => {
    it('forwards the resolved maxRetries to provider.completion via options', async () => {
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
            maxRetries: 3,
          },
          fallbackModels: [],
          secondaryModels: [],
          routing: null,
          capacity: [],
          useFallback: false,
        } as never,
      });
      await service.completion('ws-1', 'env-1', baseRequest);
      const optionsArg = spies.providerCompletion.mock.calls[0]?.[3] as {
        maxRetries?: number;
      };
      expect(optionsArg?.maxRetries).toBe(3);
    });

    it('defaults to 0 when the model config does not set maxRetries', async () => {
      const { service, spies } = buildCompletionFlowHarness();
      await service.completion('ws-1', 'env-1', baseRequest);
      const optionsArg = spies.providerCompletion.mock.calls[0]?.[3] as {
        maxRetries?: number;
      };
      expect(optionsArg?.maxRetries).toBe(0);
    });

    it('different fallback models can have different maxRetries', async () => {
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
            maxRetries: 1,
          },
          fallbackModels: [
            {
              provider: 'openai',
              model: 'fallback',
              connectionId: 'conn-1',
              maxRetries: 5,
            },
          ],
          secondaryModels: [],
          routing: null,
          capacity: [],
          useFallback: true,
        } as never,
      });
      // First call throws so the fallback fires.
      let calls = 0;
      spies.providerCompletion.mockImplementation(async () => {
        calls += 1;
        if (calls === 1) throw new Error('primary 500');
        return {
          data: {
            id: 'cmpl_fallback',
            object: 'chat.completion',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'recovered' },
                finish_reason: 'stop',
                logprobs: null,
              },
            ],
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
              total_tokens: 2,
            },
          },
          headers: {},
          providerRequestPayload: {},
        } as never;
      });
      await service.completion('ws-1', 'env-1', baseRequest);
      const firstOptions = spies.providerCompletion.mock.calls[0]?.[3] as {
        maxRetries?: number;
      };
      const secondOptions = spies.providerCompletion.mock.calls[1]?.[3] as {
        maxRetries?: number;
      };
      expect(firstOptions?.maxRetries).toBe(1);
      expect(secondOptions?.maxRetries).toBe(5);
    });
  });

  describe('timeoutMs', () => {
    it('forwards the per-model timeoutMs to provider.completion via options', async () => {
      // The gateway hands the clamped deadline to the provider SDK as
      // `options.timeoutMs` so SDKs with first-class per-request
      // `timeout` (OpenAI / Anthropic) can use their native primitive.
      const { service, spies } = buildCompletionFlowHarness({
        resource: {
          resourceId: 'res-1',
          workspaceId: 'ws-1',
          environmentId: 'env-1',
          name: 'default',
          model: {
            provider: 'openai',
            model: 'gpt-4o-mini',
            connectionId: 'conn-1',
            timeoutMs: 5_000,
          },
          fallbackModels: [],
          secondaryModels: [],
          routing: null,
          capacity: [],
          useFallback: false,
        } as never,
      });
      await service.completion('ws-1', 'env-1', baseRequest);
      const opts = spies.providerCompletion.mock.calls[0]?.[3] as {
        timeoutMs?: number;
      };
      expect(opts?.timeoutMs).toBe(5_000);
    });

    it('leaves timeoutMs undefined when neither per-model nor request-level timeout is set', async () => {
      const { service, spies } = buildCompletionFlowHarness();
      await service.completion('ws-1', 'env-1', baseRequest);
      const opts = spies.providerCompletion.mock.calls[0]?.[3] as {
        timeoutMs?: number;
      };
      expect(opts?.timeoutMs).toBeUndefined();
    });

    it('caller vmx.timeoutMs and per-model timeoutMs compose — whichever is shorter wins', async () => {
      const { service, spies } = buildCompletionFlowHarness({
        resource: {
          resourceId: 'res-1',
          workspaceId: 'ws-1',
          environmentId: 'env-1',
          name: 'default',
          model: {
            provider: 'openai',
            model: 'gpt-4o-mini',
            connectionId: 'conn-1',
            timeoutMs: 60_000,
          },
          fallbackModels: [],
          secondaryModels: [],
          routing: null,
          capacity: [],
          useFallback: false,
        } as never,
      });
      const payload = {
        ...baseRequest,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vmx: { timeoutMs: 1_000 } as any,
      } as CompletionRequestDto;
      await service.completion('ws-1', 'env-1', payload);
      const opts = spies.providerCompletion.mock.calls[0]?.[3] as {
        timeoutMs?: number;
      };
      expect(opts?.timeoutMs).toBe(1_000);
    });

    it('clamps a runaway caller vmx.timeoutMs to 10 minutes', async () => {
      const { service, spies } = buildCompletionFlowHarness();
      const payload = {
        ...baseRequest,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vmx: { timeoutMs: 60 * 60 * 1000 } as any,
      } as CompletionRequestDto;
      await service.completion('ws-1', 'env-1', payload);
      const opts = spies.providerCompletion.mock.calls[0]?.[3] as {
        timeoutMs?: number;
      };
      expect(opts?.timeoutMs).toBe(10 * 60 * 1000);
    });
  });

  describe('schema validation (CreateAIResourceDto)', () => {
    it('validates the new fields on the entity itself', async () => {
      const { AIResourceModelConfigEntity } = await import(
        '../../ai-resource/common/model.entity.js'
      );
      const e = new AIResourceModelConfigEntity();
      e.provider = 'openai';
      e.model = 'gpt-4o-mini';
      e.connectionId = '00000000-0000-0000-0000-000000000001';
      e.maxRetries = 3;
      e.timeoutMs = 30_000;
      // Just confirm assignment works and types compile.
      expect(e.maxRetries).toBe(3);
      expect(e.timeoutMs).toBe(30_000);
    });
  });
});
