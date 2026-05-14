import type { ReadonlyHeaders } from 'next/dist/server/web/spec-extension/adapters/headers';
import type { AiResourceEntity } from '@/clients/api';

/**
 * Shared `fetch` override used by every BFF route that talks to the
 * VM-X gateway (chat-completions, responses, anthropic). Three
 * responsibilities:
 *
 *   1. Forward the caller's `x-forwarded-for` so the gateway's audit
 *      row records the real client IP, not the BFF's.
 *   2. Splice the gateway envelope (`vmx`) into every outbound body
 *      so per-request resource overrides, correlation ids, caller
 *      metadata and timeouts flow through.
 *   3. Capture VM-X response headers (`x-vmx-model`, `x-vmx-provider`,
 *      `x-vmx-connection-id`, `x-vmx-request-id`) plus any
 *      `x-vmx-event-*` fallback/routing records so the route handler
 *      can stamp them on `toUIMessageStreamResponse.messageMetadata`.
 *
 * Each route may layer extra body fields (e.g. `web_search_options`
 * for chat-completions, `tools: [{type:'web_search_preview'}]` for
 * responses, plus its own thinking/reasoning shape) via the optional
 * `mutateBody` hook.
 */
export type GatewayResponseMetadata = {
  model?: string | null;
  provider?: string | null;
  connectionId?: string | null;
  requestId?: string | null;
  events?: Array<FallbackEvent | RoutingEvent>;
};

export type FallbackEvent = {
  type: 'fallback';
  timestamp: string;
  failedModel: string;
  failureReason: string;
};

export type RoutingEvent = {
  type: 'routing';
  timestamp: string;
  originalProvider: string;
  originalModel: string;
  routedProvider: string;
  routedModel: string;
};

export type GatewayEnvelopeExtras = {
  correlationId?: string;
  metadata?: Record<string, string>;
  timeoutMs?: number;
};

export type CreateGatewayFetchOptions = {
  actionHeaders: ReadonlyHeaders;
  resourceConfigOverrides: Partial<AiResourceEntity>;
  envelope?: GatewayEnvelopeExtras;
  /**
   * Sink for the captured response metadata. The route handler
   * passes the same reference to `toUIMessageStreamResponse`'s
   * `messageMetadata` callback so the UI sees the routed
   * model/provider chips + the audit row id.
   */
  responseMetadata: GatewayResponseMetadata;
  /**
   * Hook for per-route body mutations (e.g. web search opt-ins).
   * Receives the parsed outbound body and returns the body to send.
   * Return `null` to leave the body unchanged.
   */
  mutateBody?: (
    body: Record<string, unknown>
  ) => Record<string, unknown> | null;
  /**
   * Hook for transforming the upstream Response before it returns
   * to the SDK — used by the chat-completions route to flatten
   * nested `url_citation` annotations the AI SDK's chunk schema
   * doesn't accept. Returning the input is a no-op.
   *
   * The `wantsStreaming` flag is `true` when the outbound request
   * body had `stream: true`. Routes that rewrite non-2xx JSON error
   * envelopes into synthetic SSE frames use this to gate the
   * rewrite: a non-streaming caller (`generateText`) expects JSON
   * back, and SSE-encoding the error body would turn it into an
   * unparseable empty error in the SDK.
   */
  transformResponse?: (resp: Response, wantsStreaming: boolean) => Response;
};

export function createGatewayFetch({
  actionHeaders,
  resourceConfigOverrides,
  envelope,
  responseMetadata,
  mutateBody,
  transformResponse,
}: CreateGatewayFetchOptions): typeof fetch {
  return async function gatewayFetch(...args) {
    const sourceIp = actionHeaders.get('x-forwarded-for');
    if (args[1] && sourceIp) {
      args[1].headers = {
        ...(args[1]?.headers ?? {}),
        'x-forwarded-for': sourceIp,
      };
    }

    // Track whether the request itself was streaming — passed to
    // transformResponse so per-route hooks can branch their error-
    // rewriting on stream vs. non-stream (a JSON error body needs
    // SSE re-encoding for streamText but breaks generateText).
    let wantsStreaming = false;

    if (args[1]?.body) {
      const body = JSON.parse(args[1].body as string);
      wantsStreaming = body?.stream === true;
      const vmxEnvelope: Record<string, unknown> = {};
      if (resourceConfigOverrides) {
        vmxEnvelope.resourceConfigOverrides = resourceConfigOverrides;
      }
      if (envelope?.correlationId) {
        vmxEnvelope.correlationId = envelope.correlationId;
      }
      if (envelope?.metadata) {
        vmxEnvelope.metadata = envelope.metadata;
      }
      if (envelope?.timeoutMs != null) {
        vmxEnvelope.timeoutMs = envelope.timeoutMs;
      }
      const withEnvelope: Record<string, unknown> = {
        ...body,
        ...(Object.keys(vmxEnvelope).length > 0 ? { vmx: vmxEnvelope } : {}),
      };
      const final = mutateBody
        ? mutateBody(withEnvelope) ?? withEnvelope
        : withEnvelope;
      args[1].body = JSON.stringify(final);
    }

    const upstream = await fetch(...args);
    const resp = transformResponse
      ? transformResponse(upstream, wantsStreaming)
      : upstream;

    captureMetadata(resp, responseMetadata);

    return resp;
  };
}

function captureMetadata(
  resp: Response,
  responseMetadata: GatewayResponseMetadata
): void {
  responseMetadata.model = resp.headers.get('x-vmx-model');
  responseMetadata.provider = resp.headers.get('x-vmx-provider');
  responseMetadata.connectionId = resp.headers.get('x-vmx-connection-id');
  responseMetadata.requestId = resp.headers.get('x-vmx-request-id');

  const eventCount = parseInt(resp.headers.get('x-vmx-event-count') ?? '0', 10);
  if (eventCount <= 0) return;

  responseMetadata.events = responseMetadata.events ?? [];
  for (let i = 0; i < eventCount; i++) {
    const eventPath = `x-vmx-event-${i}`;
    const eventType = resp.headers.get(`${eventPath}-type`) ?? '';
    const eventTimestamp = resp.headers.get(`${eventPath}-timestamp`) ?? '';

    if (eventType === 'fallback') {
      responseMetadata.events.push({
        type: 'fallback',
        timestamp: eventTimestamp,
        failedModel:
          resp.headers.get(`${eventPath}-fallback-failed-model`) ?? '',
        failureReason:
          resp.headers.get(`${eventPath}-fallback-failure-reason`) ?? '',
      });
    } else if (eventType === 'routing') {
      responseMetadata.events.push({
        type: 'routing',
        timestamp: eventTimestamp,
        originalProvider:
          resp.headers.get(`${eventPath}-routing-original-provider`) ?? '',
        originalModel:
          resp.headers.get(`${eventPath}-routing-original-model`) ?? '',
        routedProvider:
          resp.headers.get(`${eventPath}-routing-routed-provider`) ?? '',
        routedModel:
          resp.headers.get(`${eventPath}-routing-routed-model`) ?? '',
      });
    }
  }
}

/**
 * Common `messageMetadata` callback for `toUIMessageStreamResponse`
 * that stamps the captured VM-X metadata onto every UI message — so
 * `ChatMessage.metadata.model` / `provider` / `connectionId` /
 * `requestId` get populated identically across all three BFF routes.
 */
export function uiMessageMetadataFromGateway(
  responseMetadata: GatewayResponseMetadata
): {
  model: string;
  provider: string;
  connectionId: string;
  requestId: string;
} {
  return {
    model: responseMetadata.model ?? '',
    provider: responseMetadata.provider ?? '',
    connectionId: responseMetadata.connectionId ?? '',
    requestId: responseMetadata.requestId ?? '',
  };
}
