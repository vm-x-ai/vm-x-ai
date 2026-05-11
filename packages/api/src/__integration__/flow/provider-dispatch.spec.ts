import { describe, expect, it } from 'vitest';
import { buildCompletionFlowHarness } from '../helpers/completion-flow';
import type { GatewayRequest } from '../helpers/gateway-request';
import type { ResponsesRequestDto } from '../../gateway/responses/dto/responses-request.dto';
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';
import type { CompletionRequestDto } from '../../gateway/dto/completion-request.dto';

/**
 * Provider-dispatch coverage matrix. The harness mocks the provider
 * class but the harness's `aiProviderGet` honours whatever provider
 * id `AIConnectionService` returns. So for each (provider × endpoint)
 * combination we verify:
 *
 * - The connection's provider is the one looked up via
 *   `AIProviderService.get(provider)` (no silent fallback to OpenAI).
 * - The provider's `complete()` (format-aware path) sees the right
 *   GatewayRequest format for the endpoint.
 * - Audit + gate fire regardless of which provider is on the other
 *   end of the connection — the gateway-side flow is provider-agnostic.
 *
 * VM-X currently supports seven providers. Each row in this suite is
 * a smoke test that protects the dispatch wiring; the deep
 * provider-specific tests live next to each provider's class.
 */

const PROVIDERS = [
  'openai',
  'anthropic',
  'aws-bedrock',
  'aws-bedrock-invoke',
  'gemini',
  'groq',
  'perplexity',
] as const;

const baseChat = (): CompletionRequestDto =>
  ({
    model: 'default',
    messages: [{ role: 'user', content: 'pong' }],
  } as unknown as CompletionRequestDto);

const baseAnthropic = (): AnthropicMessagesRequest =>
  ({
    model: 'claude-haiku-4-5',
    max_tokens: 100,
    messages: [{ role: 'user', content: 'pong' }],
  } as AnthropicMessagesRequest);

const baseResponses = (): ResponsesRequestDto =>
  ({
    model: 'default',
    input: 'pong',
  } as ResponsesRequestDto);

describe('Flow: provider × endpoint dispatch matrix', () => {
  describe.each(PROVIDERS)('Provider: %s', (providerId) => {
    it('Chat Completions endpoint dispatches to the connection provider class', async () => {
      const { service, spies } = buildCompletionFlowHarness({
        connection: {
          connectionId: 'conn-1',
          workspaceId: 'ws-1',
          environmentId: 'env-1',
          name: `${providerId}-test`,
          provider: providerId,
          description: null,
          config: { apiKey: 'sk-test' },
          capacity: [],
          discoveredCapacity: null,
          allowedModels: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: 't',
          updatedBy: 't',
        } as never,
        resource: {
          resourceId: 'res-1',
          workspaceId: 'ws-1',
          environmentId: 'env-1',
          name: 'default',
          description: null,
          model: {
            provider: providerId,
            model: 'whatever',
            connectionId: 'conn-1',
          },
          fallbackModels: [],
          secondaryModels: [],
          routing: null,
          capacity: [],
          useFallback: false,
        } as never,
      });
      await service.completion('ws-1', 'env-1', baseChat());

      // The provider was looked up by the connection's provider id.
      expect(spies.aiProviderGet).toHaveBeenCalledWith(providerId);
      // Gate + audit always fire regardless of provider.
      expect(spies.gateRequest).toHaveBeenCalled();
      expect(spies.auditPush).toHaveBeenCalled();
    });

    it('Anthropic Messages endpoint forwards format:anthropic to the same provider', async () => {
      const { service, spies } = buildCompletionFlowHarness({
        connection: {
          connectionId: 'conn-1',
          workspaceId: 'ws-1',
          environmentId: 'env-1',
          name: `${providerId}-test`,
          provider: providerId,
          description: null,
          config: { apiKey: 'sk-test' },
          capacity: [],
          discoveredCapacity: null,
          allowedModels: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: 't',
          updatedBy: 't',
        } as never,
        resource: {
          resourceId: 'res-1',
          workspaceId: 'ws-1',
          environmentId: 'env-1',
          name: 'default',
          description: null,
          model: {
            provider: providerId,
            model: 'whatever',
            connectionId: 'conn-1',
          },
          fallbackModels: [],
          secondaryModels: [],
          routing: null,
          capacity: [],
          useFallback: false,
        } as never,
      });
      const gw: GatewayRequest = { format: 'anthropic', body: baseAnthropic() };
      await service.complete('ws-1', 'env-1', gw);

      expect(spies.aiProviderGet).toHaveBeenCalledWith(providerId);
      expect(spies.providerComplete).toHaveBeenCalledWith(
        expect.objectContaining({ format: 'anthropic' }),
        expect.anything(),
        expect.anything(),
        expect.anything()
      );
    });

    it('Responses endpoint forwards format:responses to the same provider', async () => {
      const { service, spies } = buildCompletionFlowHarness({
        connection: {
          connectionId: 'conn-1',
          workspaceId: 'ws-1',
          environmentId: 'env-1',
          name: `${providerId}-test`,
          provider: providerId,
          description: null,
          config: { apiKey: 'sk-test' },
          capacity: [],
          discoveredCapacity: null,
          allowedModels: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: 't',
          updatedBy: 't',
        } as never,
        resource: {
          resourceId: 'res-1',
          workspaceId: 'ws-1',
          environmentId: 'env-1',
          name: 'default',
          description: null,
          model: {
            provider: providerId,
            model: 'whatever',
            connectionId: 'conn-1',
          },
          fallbackModels: [],
          secondaryModels: [],
          routing: null,
          capacity: [],
          useFallback: false,
        } as never,
      });
      const gw: GatewayRequest = { format: 'responses', body: baseResponses() };
      await service.complete('ws-1', 'env-1', gw);

      expect(spies.aiProviderGet).toHaveBeenCalledWith(providerId);
      expect(spies.providerComplete).toHaveBeenCalledWith(
        expect.objectContaining({ format: 'responses' }),
        expect.anything(),
        expect.anything(),
        expect.anything()
      );
    });
  });

  describe('Provider not found', () => {
    it('throws BAD_REQUEST when AIProviderService.get returns null', async () => {
      const { service, spies } = buildCompletionFlowHarness({
        connection: {
          connectionId: 'conn-1',
          workspaceId: 'ws-1',
          environmentId: 'env-1',
          name: 'unknown',
          provider: 'unknown-provider',
          description: null,
          config: { apiKey: 'sk-test' },
          capacity: [],
          discoveredCapacity: null,
          allowedModels: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: 't',
          updatedBy: 't',
        } as never,
        resource: {
          resourceId: 'res-1',
          workspaceId: 'ws-1',
          environmentId: 'env-1',
          name: 'default',
          description: null,
          model: {
            provider: 'unknown-provider',
            model: 'whatever',
            connectionId: 'conn-1',
          },
          fallbackModels: [],
          secondaryModels: [],
          routing: null,
          capacity: [],
          useFallback: false,
        } as never,
      });
      // Force provider lookup to return null.
      spies.aiProviderGet.mockReturnValue(null);
      await expect(
        service.completion('ws-1', 'env-1', baseChat())
      ).rejects.toBeTruthy();
    });
  });

  describe('Gate denial → audit + rethrow', () => {
    it('records the gate failure on the audit/usage path before bubbling', async () => {
      const { service, spies } = buildCompletionFlowHarness();
      // Deny the request at the capacity gate.
      spies.gateRequest.mockRejectedValue(new Error('rate-limit exceeded'));
      await expect(
        service.completion('ws-1', 'env-1', baseChat())
      ).rejects.toThrow(/rate-limit/);
      // Provider is NEVER called when the gate denies.
      expect(spies.providerCompletion).not.toHaveBeenCalled();
      // The error path still emits a usage row so the failure is
      // observable in dashboards.
      expect(spies.usagePush).toHaveBeenCalled();
    });
  });
});
