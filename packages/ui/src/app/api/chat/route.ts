import { streamText, convertToModelMessages, smoothStream } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { AiResourceEntity } from '@/clients/api';
import { auth } from '@/auth';
import { ReadonlyHeaders } from 'next/dist/server/web/spec-extension/adapters/headers';
import { headers } from 'next/headers';
import { ChatMessage } from '@/components/Chat/types';

export type ChatRequest = {
  workspaceId: string;
  environmentId: string;
  resourceConfigOverrides: Partial<AiResourceEntity>;
  messages: ChatMessage[];
  /**
   * When true, the playground asks the gateway to enable web search.
   * For Chat Completions we forward as `web_search_options: {}`. OpenAI
   * search-class models pick this up; Perplexity sonar models always
   * search regardless of the flag; other providers ignore unknown fields.
   */
  webSearch?: boolean;
  /**
   * Pass-through gateway envelope. The playground UI doesn't surface
   * inputs for these today, but the BFF accepts them so the e2e suite
   * (and ad-hoc callers) can drive metadata-tagged traffic, share a
   * correlationId across calls, and pin a per-request timeout without
   * dropping out of the OIDC-authenticated playground path.
   */
  correlationId?: string;
  metadata?: Record<string, string>;
  timeoutMs?: number;
};

// Allow streaming responses up to 120 seconds
export const maxDuration = 120;

export async function POST(req: Request) {
  const {
    workspaceId,
    environmentId,
    resourceConfigOverrides,
    messages,
    webSearch,
    correlationId,
    metadata,
    timeoutMs,
  }: ChatRequest = await req.json();

  // API_BASE_URL points at the API host (no `/api` suffix — that lives in
  // BASE_PATH on the API). The OpenAPI codegen client gets the prefix from
  // its spec; this hand-built URL has to include it explicitly.
  const baseURL = `${process.env.API_BASE_URL}/api/v1/completion/${workspaceId}/${environmentId}`;
  const actionHeaders = await headers();
  const responseMetadata: ResponseMetadata = {};

  // Cancel cascade: when the browser closes its SSE consumer (page nav,
  // fetch AbortController), Next.js fires `req.signal.abort()`. Forwarding
  // it to `streamText` aborts the SDK's outbound fetch to the gateway, the
  // gateway's controller sees `res.raw` close before its `streamComplete`
  // flag flips, and the provider SDK call is aborted in turn. Token spend
  // stops at the source.
  const result = streamText({
    abortSignal: req.signal,
    model: await getLanguageModel(
      baseURL,
      actionHeaders,
      resourceConfigOverrides,
      responseMetadata,
      webSearch,
      { correlationId, metadata, timeoutMs }
    ),
    messages: convertToModelMessages(messages),
    experimental_transform: smoothStream({
      delayInMs: 20,
    }),
  });

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    messageMetadata: () => {
      return {
        model: responseMetadata.model ?? '',
        provider: responseMetadata.provider ?? '',
        connectionId: responseMetadata.connectionId ?? '',
        requestId: responseMetadata.requestId ?? '',
      };
    },
  });
}

type FallbackEvent = {
  type: 'fallback';
  timestamp: string;
  failedModel: string;
  failureReason: string;
};

type RoutingEvent = {
  type: 'routing';
  timestamp: string;
  originalProvider: string;
  originalModel: string;
  routedProvider: string;
  routedModel: string;
};

type ResponseMetadata = {
  model?: string | null;
  provider?: string | null;
  connectionId?: string | null;
  requestId?: string | null;
  events?: Array<FallbackEvent | RoutingEvent>;
};

type GatewayEnvelopeExtras = {
  correlationId?: string;
  metadata?: Record<string, string>;
  timeoutMs?: number;
};

async function getLanguageModel(
  baseURL: string,
  actionHeaders: ReadonlyHeaders,
  resourceConfigOverrides: Partial<AiResourceEntity>,
  responseMetadata: ResponseMetadata,
  webSearch?: boolean,
  envelope?: GatewayEnvelopeExtras
) {
  const session = await auth();
  if (!session) {
    throw new Error('Unauthorized');
  }

  return createOpenAI({
    apiKey: session.accessToken,
    baseURL,
    fetch: async (...args) => {
      const sourceIp = actionHeaders.get('x-forwarded-for');
      if (args[1] && sourceIp) {
        args[1].headers = {
          ...(args[1]?.headers ?? {}),
          'x-forwarded-for': sourceIp,
        };
      }

      if (args[1]?.body) {
        const body = JSON.parse(args[1].body as string);
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
        args[1].body = JSON.stringify({
          ...body,
          ...(Object.keys(vmxEnvelope).length > 0 ? { vmx: vmxEnvelope } : {}),
          // OpenAI's `web_search_options` field is the canonical opt-in
          // for search-class models. We pass an empty object — the model
          // picks defaults. Perplexity ignores it (sonar always searches).
          ...(webSearch ? { web_search_options: {} } : {}),
        });
      }

      const upstream = await fetch(...args);

      // OpenAI's web-search Chat Completions stream emits annotations
      // as `{type:'url_citation', url_citation:{start_index, end_index,
      // url, title}}`, but `@ai-sdk/openai`'s chunk schema (≤2.0.79)
      // still expects the legacy flat shape `{type:'url_citation',
      // start_index, …}` and rejects the response. Until the SDK
      // catches up, splice the nested fields back to the top level on
      // the way through. No-op for chunks that don't carry the nested
      // payload, so other providers are unaffected.
      const resp =
        upstream.body &&
        (upstream.headers.get('content-type') ?? '').includes(
          'text/event-stream'
        )
          ? new Response(
              upstream.body.pipeThrough(makeAnnotationFlattenerStream()),
              {
                status: upstream.status,
                statusText: upstream.statusText,
                headers: upstream.headers,
              }
            )
          : upstream;

      responseMetadata.model = resp.headers.get('x-vmx-model');
      responseMetadata.provider = resp.headers.get('x-vmx-provider');
      responseMetadata.connectionId = resp.headers.get('x-vmx-connection-id');
      responseMetadata.requestId = resp.headers.get('x-vmx-request-id');

      const eventCount = parseInt(
        resp.headers.get('x-vmx-event-count') ?? '0',
        10
      );

      if (eventCount > 0) {
        for (let i = 0; i < eventCount; i++) {
          const eventPath = `x-vmx-event-${i}`;
          const eventType = resp.headers.get(`${eventPath}-type`) ?? '';
          const eventTimestamp =
            resp.headers.get(`${eventPath}-timestamp`) ?? '';

          if (eventType === 'fallback') {
            responseMetadata.events?.push({
              type: eventType,
              timestamp: eventTimestamp,
              failedModel:
                resp.headers.get(`${eventPath}-fallback-failed-model`) ?? '',
              failureReason:
                resp.headers.get(`${eventPath}-fallback-failure-reason`) ?? '',
            });
          } else if (eventType === 'routing') {
            responseMetadata.events?.push({
              type: eventType,
              timestamp: eventTimestamp,
              originalProvider:
                resp.headers.get(`${eventPath}-routing-original-provider`) ??
                '',
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
      return resp;
    },
  }).chat(resourceConfigOverrides.name ?? '');
}

type StreamingAnnotation = {
  type?: string;
  url_citation?: Record<string, unknown>;
} & Record<string, unknown>;

/**
 * If a citation is nested under `url_citation`, splice its fields back
 * to the top level so the AI SDK's chunk schema validates. Idempotent:
 * an already-flat annotation is returned unchanged.
 */
function flattenAnnotation(
  annotation: StreamingAnnotation
): StreamingAnnotation {
  if (
    annotation &&
    typeof annotation === 'object' &&
    annotation.url_citation &&
    typeof annotation.url_citation === 'object'
  ) {
    const { url_citation, ...rest } = annotation;
    return { ...rest, ...url_citation };
  }
  return annotation;
}

function rewriteChunk(json: Record<string, unknown>): Record<string, unknown> {
  const choices = json?.choices;
  if (!Array.isArray(choices)) return json;
  for (const choice of choices) {
    const delta = (choice as { delta?: { annotations?: unknown } })?.delta;
    if (!delta || !Array.isArray(delta.annotations)) continue;
    delta.annotations = (delta.annotations as StreamingAnnotation[]).map(
      flattenAnnotation
    );
  }
  return json;
}

function rewriteSseEvent(event: string): string {
  // Cheap pre-check — most chunks are plain content deltas with no
  // annotations payload, so skip the JSON round-trip on those.
  if (!event.includes('annotations')) return event;
  return event
    .split('\n')
    .map((line) => {
      if (!line.startsWith('data: ')) return line;
      const body = line.slice(6);
      if (body === '[DONE]') return line;
      try {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        return 'data: ' + JSON.stringify(rewriteChunk(parsed));
      } catch {
        return line;
      }
    })
    .join('\n');
}

/**
 * Buffers the upstream SSE byte stream into complete events
 * (delimited by `\n\n`), rewrites each event's annotation payloads
 * if needed, and re-emits. Runs entirely in-stream — never holds the
 * whole response in memory.
 */
function makeAnnotationFlattenerStream(): TransformStream<
  Uint8Array,
  Uint8Array
> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        controller.enqueue(encoder.encode(rewriteSseEvent(event) + '\n\n'));
        boundary = buffer.indexOf('\n\n');
      }
    },
    flush(controller) {
      buffer += decoder.decode();
      if (buffer.length > 0) {
        controller.enqueue(encoder.encode(rewriteSseEvent(buffer)));
      }
    },
  });
}
