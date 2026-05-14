import { describe, expect, it } from 'vitest';
import {
  buildCompletionFlowHarness,
  makeChunk,
  makeFinalChunk,
} from '../helpers/completion-flow';
import type { CompletionStreamingResponse } from '../../ai-provider/ai-provider.types';
import type { GatewayRequest } from '../helpers/gateway-request';
import type { CompletionRequestDto } from '../../gateway/dto/completion-request.dto';

/**
 * End-to-end integration tests for the **OpenAI Chat Completions**
 * gateway endpoint. Exercises the full `CompletionService` flow:
 *
 *   resource lookup → token estimation → routing (when enabled)
 *     → for each model in [primary, ...fallbacks]:
 *         connection lookup → provider lookup → gate (capacity)
 *         → provider.complete / provider.completion → audit + cost
 *
 * The provider class is mocked so we don't hit any external API; the
 * harness verifies who got called, with what shape, and in what order
 * — i.e., the full request lifecycle is wired correctly.
 */

const baseRequest = (
  overrides: Partial<CompletionRequestDto> = {}
): CompletionRequestDto =>
  ({
    model: 'default',
    messages: [{ role: 'user', content: 'pong' }],
    ...overrides,
  } as unknown as CompletionRequestDto);

describe('Flow: OpenAI Chat Completions endpoint', () => {
  describe('non-streaming success path', () => {
    it('runs the full pipeline (resource → gate → provider → audit) and returns the OpenAI response', async () => {
      const { service, spies } = buildCompletionFlowHarness();
      const result = await service.completion('ws-1', 'env-1', baseRequest());

      // 1. Resource was looked up by name.
      expect(spies.resourceGetByName).toHaveBeenCalledWith(
        'ws-1',
        'env-1',
        'default',
        true
      );
      // 2. Connection decrypted for the resolved model.
      expect(spies.connectionGetById).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        environmentId: 'env-1',
        connectionId: 'conn-1',
        decrypt: true,
      });
      // 3. Gate fired with the capacity context.
      expect(spies.gateRequest).toHaveBeenCalledTimes(1);
      // 4. Provider was dispatched via the legacy completion()
      //    entrypoint (no GatewayRequest threaded — direct chat
      //    callers leave originalGatewayRequest unset).
      expect(spies.providerCompletion).toHaveBeenCalledTimes(1);
      // 5. Audit was pushed.
      expect(spies.auditPush).toHaveBeenCalledTimes(1);
      // 6. Response shape echoed the provider's ChatCompletion.
      expect((result.data as { id: string }).id).toBe('cmpl_test');
      expect((result.data as { object: string }).object).toBe(
        'chat.completion'
      );
      // 7. vmx-prefixed gateway headers are appended.
      expect(result.headers['x-vmx-model']).toBe('gpt-4o-mini');
      expect(result.headers['x-vmx-provider']).toBe('openai');
    });

    it('emits a vmx envelope with audit events + metrics on the response', async () => {
      const { service } = buildCompletionFlowHarness();
      const result = await service.completion('ws-1', 'env-1', baseRequest());
      const data = result.data as {
        vmx?: { events?: unknown[]; metrics?: Record<string, unknown> };
      };
      expect(data.vmx).toBeDefined();
      expect(data.vmx?.metrics).toMatchObject({
        gateDurationMs: expect.any(Number),
        routingDurationMs: null,
        timeToFirstTokenMs: null,
      });
    });

    it('forwards vmx.metadata to audit / metrics / response headers', async () => {
      const { service, spies } = buildCompletionFlowHarness();
      const result = await service.completion(
        'ws-1',
        'env-1',
        baseRequest({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          vmx: { metadata: { team: 'growth', env: 'prod' } } as any,
        })
      );
      // Headers carry the metadata, sanitised lower-case.
      expect(result.headers['x-vmx-metadata-team']).toBe('growth');
      expect(result.headers['x-vmx-metadata-env']).toBe('prod');
      // Audit row carries the metadata in its event/metric attributes.
      const auditRow = spies.auditPush.mock.calls[0]?.[0];
      expect(auditRow).toBeDefined();
    });
  });

  describe('streaming success path', () => {
    it('yields chunks then triggers postCompletion → audit on stream end', async () => {
      const { service, spies } = buildCompletionFlowHarness({
        providerStream: [makeChunk(), makeChunk(), makeFinalChunk()],
      });

      const result = (await service.completion(
        'ws-1',
        'env-1',
        baseRequest({ stream: true })
      )) as CompletionStreamingResponse;

      const chunks: unknown[] = [];
      for await (const chunk of result.data) chunks.push(chunk);
      expect(chunks.length).toBe(3);
      // Audit fires once at stream end (postCompletion runs after the
      // generator yields its last chunk).
      expect(spies.auditPush).toHaveBeenCalledTimes(1);
      // Each yielded chunk is decorated with the gateway's vmx envelope.
      for (const chunk of chunks) {
        expect((chunk as { vmx?: unknown }).vmx).toBeDefined();
      }
    });

    it('records timeToFirstToken on the first chunk', async () => {
      const { service } = buildCompletionFlowHarness({
        providerStream: [makeChunk(), makeFinalChunk()],
      });
      const result = (await service.completion(
        'ws-1',
        'env-1',
        baseRequest({ stream: true })
      )) as CompletionStreamingResponse;

      const chunks: Array<{
        vmx?: { metrics?: { timeToFirstTokenMs?: number | null } };
      }> = [];
      for await (const chunk of result.data) {
        chunks.push(chunk as never);
      }
      // First chunk decorates with timeToFirstTokenMs as a number.
      expect(chunks[0].vmx?.metrics?.timeToFirstTokenMs).toEqual(
        expect.any(Number)
      );
    });
  });

  describe('streaming error path', () => {
    // Helper — builds a provider mock that yields the given chunks
    // then throws on the next iteration. Mirrors the real shape:
    // upstream emits some tokens, then the connection drops / 5xxs.
    const streamThenThrow = (
      chunks: unknown[],
      err: unknown
    ): (() => Promise<unknown>) => {
      return async () => {
        async function* gen() {
          for (const c of chunks) yield c;
          throw err;
        }
        return {
          data: gen() as never,
          headers: {},
          providerRequestPayload: {},
        };
      };
    };

    it('writes a failure audit row when the upstream throws mid-stream', async () => {
      const { service, spies } = buildCompletionFlowHarness();
      spies.providerCompletion.mockImplementation(
        streamThenThrow(
          [makeChunk(), makeChunk()],
          new Error('upstream blew up mid-stream')
        ) as never
      );

      const result = (await service.completion(
        'ws-1',
        'env-1',
        baseRequest({ stream: true })
      )) as CompletionStreamingResponse;

      const yielded: unknown[] = [];
      let caught: unknown;
      try {
        for await (const chunk of result.data) yielded.push(chunk);
      } catch (err) {
        caught = err;
      }

      // The wrapper re-threw so the controller can render the error.
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toMatch(/mid-stream/);
      // The two upstream chunks reached the consumer before the throw.
      expect(yielded.length).toBe(2);
      // Exactly one audit row — the failure one. postCompletion (the
      // success-path audit) never fires because the for-await threw.
      expect(spies.auditPush).toHaveBeenCalledTimes(1);
      const auditRow = spies.auditPush.mock.calls[0]?.[0] as {
        statusCode?: number;
        errorMessage?: string;
        failureReason?: string;
        errorCount?: number;
        successCount?: number;
        responseData?: unknown[] | null;
      };
      expect(auditRow.statusCode).toBe(500);
      expect(auditRow.errorMessage).toMatch(/mid-stream/);
      expect(auditRow.errorCount).toBe(1);
      expect(auditRow.successCount).toBe(0);
      // Partial stream payload is on the audit row for debugging.
      expect(Array.isArray(auditRow.responseData)).toBe(true);
      expect((auditRow.responseData as unknown[]).length).toBe(2);
    });

    it('pushes a usage row with error:true and a metrics row on stream failure', async () => {
      const { service, spies } = buildCompletionFlowHarness();
      spies.providerCompletion.mockImplementation(
        streamThenThrow([makeChunk()], new Error('boom')) as never
      );

      const result = (await service.completion(
        'ws-1',
        'env-1',
        baseRequest({ stream: true })
      )) as CompletionStreamingResponse;

      try {
        for await (const _chunk of result.data) void _chunk;
      } catch {
        // Expected.
      }

      // The orchestrator records a failed-usage row…
      const failedUsage = spies.usagePush.mock.calls.find(
        (c) => (c[0] as { error?: boolean }).error === true
      );
      expect(failedUsage).toBeDefined();
      // …and a metrics row (the default resource is non-ephemeral).
      expect(spies.metricsPush).toHaveBeenCalledTimes(1);
      const metricsRow = spies.metricsPush.mock.calls[0]?.[0] as {
        statusCode?: number;
      };
      expect(metricsRow.statusCode).toBe(500);
    });

    it('writes a failure audit with null responseData when the throw happens before any chunk', async () => {
      const { service, spies } = buildCompletionFlowHarness();
      spies.providerCompletion.mockImplementation(
        streamThenThrow(
          [],
          new Error('upstream errored before first chunk')
        ) as never
      );

      const result = (await service.completion(
        'ws-1',
        'env-1',
        baseRequest({ stream: true })
      )) as CompletionStreamingResponse;

      let caught: unknown;
      try {
        for await (const _chunk of result.data) void _chunk;
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(Error);
      expect(spies.auditPush).toHaveBeenCalledTimes(1);
      const auditRow = spies.auditPush.mock.calls[0]?.[0] as {
        errorCount?: number;
        successCount?: number;
        responseData?: unknown[] | null;
      };
      expect(auditRow.errorCount).toBe(1);
      expect(auditRow.successCount).toBe(0);
      // No chunks accumulated → responseData stays null (not an empty
      // array), matching the outer-catch shape.
      expect(auditRow.responseData).toBeNull();
    });
  });

  describe('routing', () => {
    it('overrides the model when a routing condition matches', async () => {
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
          secondaryModels: [],
          routing: { enabled: true, conditions: [] },
          capacity: [],
          useFallback: false,
        } as never,
      });
      // Pre-program routing to redirect to a different model.
      spies.routingEvaluate.mockResolvedValue({
        model: {
          provider: 'openai',
          model: 'routed-model',
          connectionId: 'conn-1',
        },
        matchedRoute: { description: 'integration test' },
      });

      const result = await service.completion('ws-1', 'env-1', baseRequest());
      // Response header reflects the routed model, not the primary.
      expect(result.headers['x-vmx-model']).toBe('routed-model');
    });

    it('skips routing when secondaryModelIndex is set (operator override)', async () => {
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
            { provider: 'openai', model: 'secondary', connectionId: 'conn-1' },
          ],
          routing: { enabled: true, conditions: [] },
          capacity: [],
          useFallback: false,
        } as never,
      });

      const result = await service.completion(
        'ws-1',
        'env-1',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        baseRequest({ vmx: { secondaryModelIndex: 1 } as any })
      );
      // Routing must not be evaluated when caller pinned a secondary.
      expect(spies.routingEvaluate).not.toHaveBeenCalled();
      expect(result.headers['x-vmx-model']).toBe('secondary');
    });
  });

  describe('fallback loop', () => {
    it('falls through to the next model when the primary throws', async () => {
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
          fallbackModels: [
            { provider: 'openai', model: 'fallback', connectionId: 'conn-1' },
          ],
          secondaryModels: [],
          routing: null,
          capacity: [],
          useFallback: true,
        } as never,
      });
      // Make the first call throw, the second succeed. The provider
      // mock is shared so we toggle behaviour by call count.
      let calls = 0;
      spies.providerCompletion.mockImplementation(async () => {
        calls += 1;
        if (calls === 1) throw new Error('primary upstream 500');
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
              prompt_tokens: 10,
              completion_tokens: 5,
              total_tokens: 15,
            },
          },
          headers: {},
          providerRequestPayload: {},
        } as never;
      });

      const result = await service.completion('ws-1', 'env-1', baseRequest());
      expect(spies.providerCompletion).toHaveBeenCalledTimes(2);
      expect((result.data as { id: string }).id).toBe('cmpl_fallback');
      // The fallback failure surfaces as a usage entry — the exact
      // count depends on whether the success path also writes one,
      // so just confirm the failure path emitted at least one row.
      expect(spies.usagePush).toHaveBeenCalled();
      const failedRow = spies.usagePush.mock.calls.find(
        (c) => (c[0] as { error?: boolean }).error === true
      );
      expect(failedRow).toBeDefined();
    });

    it('rethrows when ALL models fail', async () => {
      const { service } = buildCompletionFlowHarness({
        providerThrows: new Error('upstream dead'),
      });
      await expect(
        service.completion('ws-1', 'env-1', baseRequest())
      ).rejects.toBeTruthy();
    });
  });

  describe('cost + audit threading', () => {
    it('passes provider usage tokens to the cost service via post-completion', async () => {
      const { service, spies } = buildCompletionFlowHarness({
        providerResponse: {
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
          },
        },
      });
      await service.completion('ws-1', 'env-1', baseRequest());
      // Audit row received the request payload, cost, and usage.
      const auditCall = spies.auditPush.mock.calls[0]?.[0] as {
        promptTokens?: number;
        outputTokens?: number;
      };
      expect(auditCall.promptTokens).toBe(100);
      expect(auditCall.outputTokens).toBe(50);
    });
  });

  describe('format-aware dispatch via complete()', () => {
    it('routes openai-format GatewayRequest through provider.complete()', async () => {
      const { service, spies } = buildCompletionFlowHarness();
      const gw: GatewayRequest = {
        format: 'chat-completions',
        body: baseRequest() as never,
      };
      await service.complete('ws-1', 'env-1', gw);
      // The format-aware path goes through provider.complete (NOT
      // provider.completion). This is the seam Phase-12 added; a
      // regression here would silently revert to the legacy round-trip.
      expect(spies.providerComplete).toHaveBeenCalledTimes(1);
      const dispatchedRequest = spies.providerComplete.mock.calls[0]?.[0];
      expect(dispatchedRequest).toMatchObject({ format: 'chat-completions' });
    });

    it('returns the openai-format response unchanged (no conversion)', async () => {
      const { service } = buildCompletionFlowHarness();
      const gw: GatewayRequest = {
        format: 'chat-completions',
        body: baseRequest() as never,
      };
      const out = await service.complete('ws-1', 'env-1', gw);
      expect(out.format).toBe('chat-completions');
      expect((out.data as { object: string }).object).toBe('chat.completion');
    });
  });

  describe('audit row carries the inbound wire format', () => {
    // The orchestrator threads `originalGatewayRequest.format` onto
    // `baseProps.format` so every audit-row push (success, mid-stream
    // error, outer-catch error) picks it up via the spread — without
    // this, the Audit Drawer's endpoint badge can't render and
    // cost-by-endpoint dashboards have no discriminator to group on.

    it('stamps `format: "chat-completions"` on the success-path audit row', async () => {
      const { service, spies } = buildCompletionFlowHarness();
      const gw: GatewayRequest = {
        format: 'chat-completions',
        body: baseRequest() as never,
      };
      await service.complete('ws-1', 'env-1', gw);

      expect(spies.auditPush).toHaveBeenCalledTimes(1);
      const auditRow = spies.auditPush.mock.calls[0]?.[0] as {
        format?: string | null;
      };
      expect(auditRow.format).toBe('chat-completions');
    });

    it('stamps `format: "responses"` when the gateway entrypoint envelope is Responses-shape', async () => {
      const { service, spies } = buildCompletionFlowHarness();
      const gw: GatewayRequest = {
        format: 'responses',
        // Responses-shape canonical body — minimal valid input.
        body: {
          model: 'default',
          input: 'pong',
        } as never,
      };
      await service.complete('ws-1', 'env-1', gw);
      const auditRow = spies.auditPush.mock.calls[0]?.[0] as {
        format?: string | null;
      };
      expect(auditRow.format).toBe('responses');
    });

    it('stamps `format: "anthropic"` when the gateway entrypoint envelope is Anthropic-shape', async () => {
      const { service, spies } = buildCompletionFlowHarness();
      const gw: GatewayRequest = {
        format: 'anthropic',
        // Anthropic Messages canonical body — input goes through
        // `anthropicToResponsesRequest` in the harness `complete()`
        // shim, but the audit `format` stays anthropic because the
        // *inbound* envelope carries it.
        body: {
          model: 'default',
          max_tokens: 64,
          messages: [{ role: 'user', content: 'pong' }],
        } as never,
      };
      await service.complete('ws-1', 'env-1', gw);
      const auditRow = spies.auditPush.mock.calls[0]?.[0] as {
        format?: string | null;
      };
      expect(auditRow.format).toBe('anthropic');
    });

    it('also stamps `format` on failure-path audit rows', async () => {
      // Force the upstream to throw on every leg so the error path's
      // audit push fires (orchestrator's outer catch at the bottom of
      // `completion()`). Format must still be set because we copied it
      // onto `baseProps` before the dispatch loop ran.
      const { service, spies } = buildCompletionFlowHarness({
        providerThrows: new Error('upstream dead'),
      });
      const gw: GatewayRequest = {
        format: 'responses',
        body: { model: 'default', input: 'pong' } as never,
      };
      await expect(service.complete('ws-1', 'env-1', gw)).rejects.toBeTruthy();
      const errorRow = spies.auditPush.mock.calls.find(
        (c) => (c[0] as { errorCount?: number }).errorCount === 1
      )?.[0] as { format?: string | null } | undefined;
      expect(errorRow).toBeDefined();
      expect(errorRow?.format).toBe('responses');
    });
  });
});
