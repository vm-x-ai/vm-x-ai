import { describe, expect, it } from 'vitest';
import { buildCompletionFlowHarness } from '../helpers/completion-flow';
import type { GatewayRequest } from '../helpers/gateway-request';
import type { ResponsesRequestDto } from '../../gateway/responses/dto/responses-request.dto';

/**
 * End-to-end integration tests for the **OpenAI Responses API**
 * gateway endpoint (`POST /v1/responses`). Mirrors the chat-completions
 * + anthropic-messages flow tests but exercises the third format VM-X
 * supports.
 *
 * Phase-12 architecture note: the Responses API request gets converted
 * to OpenAI Chat Completions internally for routing/audit/scoping
 * reasons (the gateway's audit + cost columns assume Chat Completions
 * usage tokens). The provider call still goes through `complete()`
 * with the original `format: 'responses'` `GatewayRequest` so a
 * provider with native Responses support could opt into passthrough
 * — at the time of writing only OpenAIProvider has a passthrough
 * branch. The response is then converted from Chat Completions back
 * to Responses shape before returning to the client.
 */

const baseResponsesRequest = (
  overrides: Partial<ResponsesRequestDto> = {}
): ResponsesRequestDto =>
  ({
    model: 'default',
    input: 'pong',
    ...overrides,
  } as ResponsesRequestDto);

describe('Flow: OpenAI Responses endpoint', () => {
  it('runs the full pipeline against a Responses-shape request body', async () => {
    const { service, spies } = buildCompletionFlowHarness();
    const gw: GatewayRequest = {
      format: 'responses',
      body: baseResponsesRequest(),
    };
    const out = await service.complete('ws-1', 'env-1', gw);

    expect(spies.resourceGetByName).toHaveBeenCalled();
    expect(spies.connectionGetById).toHaveBeenCalled();
    expect(spies.gateRequest).toHaveBeenCalled();
    expect(spies.providerComplete).toHaveBeenCalled();
    expect(spies.auditPush).toHaveBeenCalled();
    expect(out.format).toBe('responses');
  });

  it('hands the provider the native Responses body so passthrough providers can opt in', async () => {
    const { service, spies } = buildCompletionFlowHarness();
    const responsesBody = baseResponsesRequest({
      input: 'hello',
      instructions: 'be brief',
      temperature: 0.2,
      max_output_tokens: 50,
    });
    const gw: GatewayRequest = { format: 'responses', body: responsesBody };
    await service.complete('ws-1', 'env-1', gw);

    const dispatchedRequest = spies.providerComplete.mock.calls[0]?.[0];
    expect(dispatchedRequest).toMatchObject({
      format: 'responses',
      body: expect.objectContaining({
        instructions: 'be brief',
        temperature: 0.2,
        max_output_tokens: 50,
      }),
    });
  });

  it('converts the OpenAI ChatCompletion response back into Responses output items', async () => {
    const { service } = buildCompletionFlowHarness({
      providerResponse: {
        id: 'cmpl_test',
        model: 'gpt-4o-mini',
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
      format: 'responses',
      body: baseResponsesRequest(),
    };
    const out = await service.complete('ws-1', 'env-1', gw);

    // Responses API uses `output` (array) and `output_text`, not
    // `choices` / `message`.
    const data = out.data as {
      object?: string;
      output?: Array<{ type: string; content?: unknown[] }>;
      id?: string;
    };
    expect(data.object).toBe('response');
    expect(data.id).toMatch(/^resp_/);
    expect(Array.isArray(data.output)).toBe(true);
    expect(data.output?.length ?? 0).toBeGreaterThan(0);
    expect(data.output?.[0]?.type).toBe('message');
  });

  it('records the original Responses body on the audit row (not the converted Chat Completions body)', async () => {
    const { service, spies } = buildCompletionFlowHarness();
    const responsesBody = baseResponsesRequest({
      instructions: 'preserve me',
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'verbatim input item' }],
        } as never,
      ],
    });
    const gw: GatewayRequest = { format: 'responses', body: responsesBody };
    await service.complete('ws-1', 'env-1', gw);

    const auditCall = spies.auditPush.mock.calls[0]?.[0] as {
      requestPayload?: Record<string, unknown>;
    };
    expect(auditCall.requestPayload).toMatchObject({
      instructions: 'preserve me',
    });
    // Responses uses `input` (not `messages`) — confirm the original
    // shape is what's stored on the audit row.
    expect(auditCall.requestPayload?.input).toBeDefined();
  });

  it('streaming Responses request — converts OpenAI chunks to Responses event stream', async () => {
    const { service, spies } = buildCompletionFlowHarness({
      providerStream: [
        {
          id: 'chunk_1',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'gpt-4o-mini',
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
          model: 'gpt-4o-mini',
          choices: [
            { index: 0, delta: {}, finish_reason: 'stop', logprobs: null },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
        } as never,
      ],
    });
    const gw: GatewayRequest = {
      format: 'responses',
      body: baseResponsesRequest({ stream: true }),
    };
    const out = await service.complete('ws-1', 'env-1', gw);
    expect(out.format).toBe('responses');
    expect(Symbol.asyncIterator in (out.data as object)).toBe(true);

    const events: Array<{ type?: string }> = [];
    for await (const event of out.data as AsyncIterable<unknown>) {
      events.push(event as { type?: string });
    }
    // Responses stream emits typed events: `response.created`,
    // `response.output_item.added`, deltas, then `response.completed`.
    // The exact set depends on the converter; assert we get at least
    // one created + one completed event.
    const types = events.map((e) => e.type).filter(Boolean) as string[];
    expect(types).toContain('response.created');
    expect(
      types.some((t) => /response\.completed|response\.failed/.test(t))
    ).toBe(true);
    expect(spies.auditPush).toHaveBeenCalled();
  });

  it('echoes client-provided fields (instructions, metadata) on the response object', async () => {
    const { service } = buildCompletionFlowHarness();
    const responsesBody = baseResponsesRequest({
      instructions: 'echo me',
      metadata: { trace: 'integration-test' } as never,
    });
    const gw: GatewayRequest = { format: 'responses', body: responsesBody };
    const out = await service.complete('ws-1', 'env-1', gw);
    const data = out.data as {
      instructions?: string;
      metadata?: Record<string, string>;
    };
    expect(data.instructions).toBe('echo me');
    expect(data.metadata).toEqual({ trace: 'integration-test' });
  });

  // Regression: when `provider.openAIResponse` returns a native
  // `Response` shape (which the dispatch helper does today, and which
  // the future native passthrough will do via `client.responses.create`),
  // `mapCompletionResponseToFormat` MUST NOT re-run
  // `chatCompletionToResponse` — the converter would read missing
  // `choices` and emit a degenerate Response with empty `output` and
  // missing usage. The orchestrator detects native shape and forwards
  // verbatim instead.
  it('does not double-convert when openAIResponse returns native Response shape', async () => {
    const { service, spies } = buildCompletionFlowHarness({
      providerResponse: {
        id: 'cmpl_native_test',
        model: 'gpt-4o-mini',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'native-shape-pong',
              refusal: null,
            },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
        usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
      },
    });
    const gw: GatewayRequest = {
      format: 'responses',
      body: baseResponsesRequest(),
    };
    const out = await service.complete('ws-1', 'env-1', gw);

    expect(out.format).toBe('responses');
    const data = out.data as {
      object?: string;
      output?: Array<{
        type?: string;
        content?: Array<{ type?: string; text?: string }>;
      }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    // The native Response shape has `object: 'response'` and an
    // `output` array of items. The harness's `providerOpenAIResponse`
    // converts ChatCompletion → Response (mirroring the dispatch
    // helper); the orchestrator must then forward verbatim, not run
    // `chatCompletionToResponse` a second time.
    expect(data.object).toBe('response');
    expect(Array.isArray(data.output)).toBe(true);
    const messageItem = data.output!.find((i) => i.type === 'message');
    expect(messageItem).toBeDefined();
    const textPart = messageItem!.content?.find(
      (c) => c.type === 'output_text'
    );
    expect(textPart?.text).toBe('native-shape-pong');
    // Usage must survive the orchestrator's per-shape extractor.
    // Audit push receives the full call args; the cost calculation
    // runs against the normalised CompletionUsage shape.
    expect(spies.costCalculate).toHaveBeenCalled();
    const costCall = spies.costCalculate.mock.calls[0]?.[0];
    expect(costCall).toMatchObject({ promptTokens: 7, outputTokens: 3 });
  });
});
