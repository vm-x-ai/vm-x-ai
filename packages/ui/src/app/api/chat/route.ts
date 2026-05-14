import {
  streamText,
  generateText,
  convertToModelMessages,
  smoothStream,
} from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { AiResourceEntity } from '@/clients/api';
import { auth } from '@/auth';
import { headers } from 'next/headers';
import { ChatMessage } from '@/components/Chat/types';
import {
  createGatewayFetch,
  uiMessageMetadataFromGateway,
  type GatewayResponseMetadata,
} from '../_lib/gateway-fetch';
import { nonStreamingResultToUIMessageStreamResponse } from '../_lib/non-streaming-response';

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
   * Streaming toggle from the playground header. Defaults to `true`
   * (current behaviour). When `false`, the BFF switches to
   * `generateText` so the upstream provider call is non-streaming,
   * and re-encodes the single result as a one-burst UI message stream
   * — `useChat` still consumes the same protocol, but the reply lands
   * on the wire in one shot instead of token-by-token.
   */
  stream?: boolean;
  /**
   * Reasoning effort tier. Forwarded as
   * `providerOptions.openai.reasoningEffort` on `streamText` so the
   * AI SDK's OpenAI provider attaches `reasoning_effort` to the
   * outbound Chat Completions body. The gateway translates that to
   * the right field per upstream provider (Anthropic
   * `thinking.budget_tokens`, Gemini reasoning, etc.). Models without
   * reasoning support ignore it.
   */
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
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

// Allow streaming responses up to 120 seconds.
export const maxDuration = 120;

export async function POST(req: Request) {
  const {
    workspaceId,
    environmentId,
    resourceConfigOverrides,
    messages,
    webSearch,
    stream = true,
    reasoningEffort,
    correlationId,
    metadata,
    timeoutMs,
  }: ChatRequest = await req.json();

  const session = await auth();
  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  // API_BASE_URL points at the API host (no `/api` suffix — that
  // lives in BASE_PATH on the API). The OpenAPI codegen client gets
  // the prefix from its spec; this hand-built URL has to include it
  // explicitly. The `@ai-sdk/openai` provider POSTs to
  // `${baseURL}/chat/completions` for `.chat()` calls.
  const baseURL = `${process.env.API_BASE_URL}/api/v1/completion/${workspaceId}/${environmentId}`;
  const actionHeaders = await headers();
  const responseMetadata: GatewayResponseMetadata = {};

  const provider = createOpenAI({
    apiKey: session.accessToken,
    baseURL,
    fetch: createGatewayFetch({
      actionHeaders,
      resourceConfigOverrides,
      envelope: { correlationId, metadata, timeoutMs },
      responseMetadata,
      mutateBody: (body) =>
        webSearch ? { ...body, web_search_options: {} } : null,
      transformResponse: maybeNestAnnotations,
    }),
  });

  const modelMessages = await convertToModelMessages(messages);
  const providerOptions = reasoningEffort
    ? { providerOptions: { openai: { reasoningEffort } } }
    : {};

  // Non-streaming branch: drive the upstream call via `generateText`
  // so the gateway makes a single non-SSE request, then re-encode the
  // complete result as a one-burst UI message stream that `useChat`
  // consumes identically to the streaming path.
  if (!stream) {
    const result = await generateText({
      abortSignal: req.signal,
      model: provider.chat(resourceConfigOverrides.name ?? ''),
      messages: modelMessages,
      ...providerOptions,
    });
    return nonStreamingResultToUIMessageStreamResponse(result, {
      originalMessages: messages,
      messageMetadata: uiMessageMetadataFromGateway(responseMetadata),
    });
  }

  // Cancel cascade: when the browser closes its SSE consumer, Next.js
  // fires `req.signal.abort()`. Forwarding it to `streamText` aborts
  // the SDK's outbound fetch to the gateway, the gateway's controller
  // sees `res.raw` close before its `streamComplete` flag flips, and
  // the provider SDK call is aborted in turn. Token spend stops at
  // the source.
  const result = streamText({
    abortSignal: req.signal,
    model: provider.chat(resourceConfigOverrides.name ?? ''),
    messages: modelMessages,
    // Forwarded as `reasoning_effort` on the outbound Chat Completions
    // request. The `@ai-sdk/openai` v3 provider also unpacks any
    // upstream `reasoning_content` deltas into `reasoning-delta`
    // chunks, which `useChat` accumulates into `ReasoningUIPart`
    // entries on the assistant message.
    ...providerOptions,
    experimental_transform: smoothStream({
      delayInMs: 20,
    }),
  });

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    messageMetadata: () => uiMessageMetadataFromGateway(responseMetadata),
  });
}

// ─── url_citation annotation flattener (chat-completions only) ───────────

type StreamingAnnotation = {
  type?: string;
  url_citation?: Record<string, unknown>;
} & Record<string, unknown>;

/**
 * OpenAI's web-search Chat Completions stream emits annotations as a
 * flat shape: `{type:'url_citation', start_index, end_index, url,
 * title}`. `@ai-sdk/openai` v3's chunk schema expects the nested
 * shape `{type:'url_citation', url_citation:{start_index, end_index,
 * url, title}}` and rejects the flat form. Splice the citation
 * fields under a `url_citation` sub-object on the way through.
 * Idempotent: an already-nested annotation passes unchanged. Only
 * fires on `text/event-stream` bodies.
 */
function maybeNestAnnotations(upstream: Response): Response {
  if (!upstream.body) return upstream;
  if (
    !(upstream.headers.get('content-type') ?? '').includes('text/event-stream')
  ) {
    return upstream;
  }
  return new Response(upstream.body.pipeThrough(makeAnnotationNesterStream()), {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}

const URL_CITATION_FIELDS = [
  'start_index',
  'end_index',
  'url',
  'title',
] as const;

function nestAnnotation(annotation: StreamingAnnotation): StreamingAnnotation {
  if (
    !annotation ||
    typeof annotation !== 'object' ||
    annotation.type !== 'url_citation'
  ) {
    return annotation;
  }
  // Already nested (v3 wire shape) — pass through.
  if (annotation.url_citation && typeof annotation.url_citation === 'object') {
    return annotation;
  }
  const nested: Record<string, unknown> = {};
  const rest: Record<string, unknown> = { type: 'url_citation' };
  for (const [k, v] of Object.entries(annotation)) {
    if (k === 'type') continue;
    if ((URL_CITATION_FIELDS as readonly string[]).includes(k)) {
      nested[k] = v;
    } else {
      rest[k] = v;
    }
  }
  rest.url_citation = nested;
  return rest as StreamingAnnotation;
}

function rewriteChunk(json: Record<string, unknown>): Record<string, unknown> {
  const choices = json?.choices;
  if (!Array.isArray(choices)) return json;
  for (const choice of choices) {
    const delta = (choice as { delta?: { annotations?: unknown } })?.delta;
    if (!delta || !Array.isArray(delta.annotations)) continue;
    delta.annotations = (delta.annotations as StreamingAnnotation[]).map(
      nestAnnotation
    );
  }
  return json;
}

function rewriteSseEvent(event: string): string {
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

function makeAnnotationNesterStream(): TransformStream<Uint8Array, Uint8Array> {
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
