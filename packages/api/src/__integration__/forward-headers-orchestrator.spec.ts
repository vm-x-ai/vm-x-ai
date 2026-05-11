import { describe, expect, it } from 'vitest';
import { buildCompletionFlowHarness } from './helpers/completion-flow';
import type { GatewayRequest } from './helpers/gateway-request';
import type { CompletionRequestOptions } from '../ai-provider/ai-provider.types';
import { anthropicToResponsesRequest } from '../gateway/responses/from-anthropic';
import { chatCompletionsToResponsesRequest } from '../gateway/responses/from-chat-completions';

/**
 * Wiring test: the gateway orchestrator must extract whitelisted
 * inbound HTTP headers (`anthropic-beta`, `openai-beta`, etc.) off
 * the FastifyRequest and pass them to the AI provider via
 * `requestOptions.forwardHeaders`. Without this, Anthropic /
 * OpenAI / Gemini reject body fields that are gated behind a beta
 * opt-in header — e.g. Anthropic returns "Extra inputs are not
 * permitted" for `context_management` when `anthropic-beta:
 * context-management-2025-06-27` is missing.
 */

const baseAnthropicBody = {
  model: 'claude-haiku-4-5',
  max_tokens: 32,
  messages: [{ role: 'user', content: 'hi' }],
};

function makeFastifyRequest(
  headers: Record<string, string | string[] | undefined>
): { headers: typeof headers } {
  return { headers };
}

function lastProviderOptions(
  spy: ReturnType<
    typeof buildCompletionFlowHarness
  >['spies']['providerCompletion']
): CompletionRequestOptions | undefined {
  const lastCall = spy.mock.calls.at(-1);
  return lastCall?.[3] as CompletionRequestOptions | undefined;
}

describe('Orchestrator: forward whitelisted inbound headers', () => {
  it('threads `anthropic-beta` through to the provider via requestOptions.forwardHeaders', async () => {
    const { service, spies } = buildCompletionFlowHarness();
    const gw: GatewayRequest = { format: 'anthropic', body: baseAnthropicBody };

    // Drive the orchestrator with a request that has Anthropic beta opt-in.
    // We bypass `service.complete` (which doesn't take a request) and
    // call `service.completion()` directly with a fake FastifyRequest.
    const canonical = anthropicToResponsesRequest(gw.body as never);

    await service.completion(
      'ws-1',
      'env-1',
      canonical as never,
      undefined,
      makeFastifyRequest({
        'anthropic-beta': 'context-management-2025-06-27,effort-2025-11-24',
        'anthropic-version': '2023-06-01',
      }) as never,
      undefined,
      undefined,
      undefined,
      gw.body,
      gw as never
    );

    const opts = lastProviderOptions(spies.providerCompletion);
    expect(opts?.forwardHeaders).toEqual({
      'anthropic-beta': 'context-management-2025-06-27,effort-2025-11-24',
      'anthropic-version': '2023-06-01',
    });
  });

  it('does NOT forward Authorization (would override gateway upstream key)', async () => {
    const { service, spies } = buildCompletionFlowHarness();
    const canonical = anthropicToResponsesRequest(baseAnthropicBody as never);

    await service.completion(
      'ws-1',
      'env-1',
      canonical as never,
      undefined,
      makeFastifyRequest({
        authorization: 'Bearer caller-supplied-key',
        'anthropic-beta': 'context-management-2025-06-27',
      }) as never,
      undefined,
      undefined,
      undefined,
      baseAnthropicBody,
      { format: 'anthropic', body: baseAnthropicBody } as never
    );

    const opts = lastProviderOptions(spies.providerCompletion);
    expect(opts?.forwardHeaders).toEqual({
      'anthropic-beta': 'context-management-2025-06-27',
    });
    expect(opts?.forwardHeaders).not.toHaveProperty('authorization');
  });

  it('omits forwardHeaders entirely when no allowlist headers are present', async () => {
    const { service, spies } = buildCompletionFlowHarness();
    const canonical = anthropicToResponsesRequest(baseAnthropicBody as never);

    await service.completion(
      'ws-1',
      'env-1',
      canonical as never,
      undefined,
      makeFastifyRequest({
        'content-type': 'application/json',
        host: 'gateway.example.com',
        'x-api-key': 'caller-key',
      }) as never,
      undefined,
      undefined,
      undefined,
      baseAnthropicBody,
      { format: 'anthropic', body: baseAnthropicBody } as never
    );

    const opts = lastProviderOptions(spies.providerCompletion);
    expect(opts).toBeDefined();
    expect(opts).not.toHaveProperty('forwardHeaders');
  });

  it('header-derived metadata lands on the success-path audit row', async () => {
    // Regression: success-path audit was reading metadata from the
    // original wire body (`requestPayload`) instead of the canonical
    // (`payload`). When the caller sent `x-vmx-metadata-*` headers,
    // the canonical's `vmx.metadata` got the values via
    // `applyVmxHeadersToCanonical`, but the original body never did
    // — so the audit metadata table came up empty for header-only
    // metadata. The fix routes metadata via `baseEventProps.metadata`
    // (sourced from the canonical at the call site).
    const { service, spies } = buildCompletionFlowHarness();
    const ccBody = {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
    };
    const canonical = chatCompletionsToResponsesRequest(ccBody as never);
    // Manually mirror what the per-format service does: apply
    // header vmx onto the canonical before calling the orchestrator.
    // (Goes through `applyVmxHeadersToCanonical` in production.)
    (canonical as { vmx?: unknown }).vmx = {
      metadata: {
        team: 'growth',
        user_id: 'u_42',
        feature: 'audit-metadata-regression',
      },
    };

    await service.completion(
      'ws-1',
      'env-1',
      canonical as never,
      undefined,
      makeFastifyRequest({}) as never,
      undefined,
      undefined,
      undefined,
      ccBody,
      { format: 'chat-completions', body: ccBody } as never
    );

    // The success-path audit push must carry the metadata from the
    // canonical, not from the (header-stripped) original body.
    const successCall = spies.auditPush.mock.calls.find(
      (c) =>
        (c[0] as { statusCode?: number; successCount?: number })
          ?.successCount === 1
    );
    expect(successCall).toBeDefined();
    expect(
      (successCall![0] as { metadata?: Record<string, string> }).metadata
    ).toEqual({
      team: 'growth',
      user_id: 'u_42',
      feature: 'audit-metadata-regression',
    });
  });

  it('passes through openai-beta + openai-organization on a chat-completions request', async () => {
    const { service, spies } = buildCompletionFlowHarness();
    const ccBody = {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
    };
    const canonical = chatCompletionsToResponsesRequest(ccBody as never);

    await service.completion(
      'ws-1',
      'env-1',
      canonical as never,
      undefined,
      makeFastifyRequest({
        'openai-beta': 'assistants=v2',
        'openai-organization': 'org_X',
      }) as never,
      undefined,
      undefined,
      undefined,
      ccBody,
      { format: 'chat-completions', body: ccBody } as never
    );

    const opts = lastProviderOptions(spies.providerCompletion);
    expect(opts?.forwardHeaders).toEqual({
      'openai-beta': 'assistants=v2',
      'openai-organization': 'org_X',
    });
  });
});
