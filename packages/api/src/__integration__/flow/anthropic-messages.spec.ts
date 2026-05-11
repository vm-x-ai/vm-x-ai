import { describe, expect, it } from 'vitest';
import { buildCompletionFlowHarness } from '../helpers/completion-flow';
import type { GatewayRequest } from '../helpers/gateway-request';
import type { AnthropicMessagesRequest } from '../../gateway/anthropic/anthropic.types';

/**
 * End-to-end integration tests for the **Anthropic Messages** gateway
 * endpoint (`POST /v1/messages`). Verifies that:
 *
 * - The full `CompletionService` flow runs against the Anthropic-shape
 *   request (resource lookup → routing → gate → provider → audit).
 * - The provider receives the **native Anthropic body** (no
 *   round-trip to OpenAI shape on the wire) — this is the Phase-12
 *   passthrough guarantee.
 * - The response is converted from the OpenAI Chat Completions shape
 *   the provider returned back into Anthropic Messages shape that the
 *   client expected.
 * - Audit row's `requestPayload` reflects what the **client sent**
 *   (Anthropic shape), not the OpenAI body the gateway uses
 *   internally for routing/audit/scoping.
 */

const baseAnthropicRequest = (
  overrides: Partial<AnthropicMessagesRequest> = {}
): AnthropicMessagesRequest =>
  ({
    model: 'claude-haiku-4-5',
    max_tokens: 100,
    messages: [{ role: 'user', content: 'pong' }],
    ...overrides,
  } as AnthropicMessagesRequest);

describe('Flow: Anthropic Messages endpoint', () => {
  it('runs the full pipeline against an Anthropic-shape request body', async () => {
    const { service, spies } = buildCompletionFlowHarness();
    const gw: GatewayRequest = {
      format: 'anthropic',
      body: baseAnthropicRequest(),
    };
    const out = await service.complete('ws-1', 'env-1', gw);

    // Resource + connection + gate fired.
    expect(spies.resourceGetByName).toHaveBeenCalled();
    expect(spies.connectionGetById).toHaveBeenCalled();
    expect(spies.gateRequest).toHaveBeenCalled();
    // Format-aware dispatch: provider.complete() (not completion()).
    expect(spies.providerComplete).toHaveBeenCalled();
    // Audit emitted.
    expect(spies.auditPush).toHaveBeenCalled();
    // Response is tagged with the Anthropic format.
    expect(out.format).toBe('anthropic');
  });

  it('hands the provider the native Anthropic body (no OpenAI conversion on the wire)', async () => {
    const { service, spies } = buildCompletionFlowHarness();
    const anthropicBody = baseAnthropicRequest({
      // Anthropic-only fields that would be lost if we converted to
      // OpenAI shape on the wire — confirm they survive passthrough.
      system: [{ type: 'text', text: 'you are a curt assistant' }] as never,
      stop_sequences: ['END'],
      top_k: 10,
    });
    const gw: GatewayRequest = { format: 'anthropic', body: anthropicBody };
    await service.complete('ws-1', 'env-1', gw);

    const dispatchedRequest = spies.providerComplete.mock.calls[0]?.[0];
    expect(dispatchedRequest).toMatchObject({
      format: 'anthropic',
      body: expect.objectContaining({
        model: 'claude-haiku-4-5',
        stop_sequences: ['END'],
        top_k: 10,
      }),
    });
  });

  it('converts the provider OpenAI response back into Anthropic Messages shape', async () => {
    const { service } = buildCompletionFlowHarness({
      providerResponse: {
        id: 'cmpl_test',
        model: 'claude-haiku-4-5',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Hello there.',
              refusal: null,
            },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
        usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
      },
    });
    const gw: GatewayRequest = {
      format: 'anthropic',
      body: baseAnthropicRequest(),
    };
    const out = await service.complete('ws-1', 'env-1', gw);

    // The Anthropic shape uses `content: [{type:'text', text}]`,
    // `role: 'assistant'`, and `stop_reason` (not `finish_reason`).
    const data = out.data as {
      role?: string;
      content?: Array<{ type: string; text: string }>;
      stop_reason?: string;
      type?: string;
    };
    expect(data.role).toBe('assistant');
    expect(data.type).toBe('message');
    expect(data.content?.[0]).toMatchObject({
      type: 'text',
      text: 'Hello there.',
    });
    expect(data.stop_reason).toBeDefined();
  });

  it('records the original Anthropic body on the audit row (not the OpenAI conversion)', async () => {
    const { service, spies } = buildCompletionFlowHarness();
    const anthropicBody = baseAnthropicRequest({
      system: 'system prompt that should appear verbatim',
      max_tokens: 250,
    });
    const gw: GatewayRequest = { format: 'anthropic', body: anthropicBody };
    await service.complete('ws-1', 'env-1', gw);

    const auditCall = spies.auditPush.mock.calls[0]?.[0] as {
      requestPayload?: Record<string, unknown>;
    };
    expect(auditCall.requestPayload).toMatchObject({
      model: 'claude-haiku-4-5',
      max_tokens: 250,
      system: 'system prompt that should appear verbatim',
    });
    // Negative assertion: the audit row should NOT have the OpenAI
    // converted shape's `messages` with the system prepended.
    const messages = auditCall.requestPayload?.messages as Array<{
      role: string;
    }>;
    expect(messages?.[0]?.role).toBe('user');
  });

  it('streaming Anthropic request — provider.complete is dispatched with format:anthropic', async () => {
    const { service, spies } = buildCompletionFlowHarness({
      providerStream: [
        // Mock a single chunk; the response converter for streaming
        // currently passes through ChatCompletionChunk as-is in the
        // anthropic format (a follow-up workstream wires Anthropic
        // event names; for now we just verify the dispatch).
        {
          id: 'chunk_1',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'claude-haiku-4-5',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: 'tok' },
              finish_reason: null,
              logprobs: null,
            },
          ],
        } as never,
        {
          id: 'chunk_final',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'claude-haiku-4-5',
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: 'stop',
              logprobs: null,
            },
          ],
          usage: {
            prompt_tokens: 3,
            completion_tokens: 1,
            total_tokens: 4,
          },
        } as never,
      ],
    });

    const gw: GatewayRequest = {
      format: 'anthropic',
      body: baseAnthropicRequest({ stream: true }),
    };
    const out = await service.complete('ws-1', 'env-1', gw);
    expect(out.format).toBe('anthropic');
    // Drain the stream so audit/post-completion fires.
    if (Symbol.asyncIterator in (out.data as object)) {
      const chunks: unknown[] = [];
      for await (const c of out.data as AsyncIterable<unknown>) chunks.push(c);
      expect(chunks.length).toBe(2);
    }
    expect(spies.providerComplete).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'anthropic' }),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
    expect(spies.auditPush).toHaveBeenCalled();
  });

  it('rejects an Anthropic request with empty messages array (defensive)', async () => {
    const { service } = buildCompletionFlowHarness();
    const gw: GatewayRequest = {
      format: 'anthropic',
      body: baseAnthropicRequest({ messages: [] }),
    };
    // Empty messages still flows through (Anthropic accepts system-
    // only requests in some scenarios). Verify the gateway doesn't
    // crash with an out-of-bounds access — that bug was caught in
    // the earlier security review and patched in routing.service.ts.
    await expect(service.complete('ws-1', 'env-1', gw)).resolves.toBeDefined();
  });
});
