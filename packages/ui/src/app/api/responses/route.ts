import { auth } from '@/auth';
import { headers } from 'next/headers';
import { AiResourceEntity } from '@/clients/api';
import { ChatMessage } from '@/components/Chat/types';

/**
 * BFF route for the AI Resource playground's Responses-API tab.
 *
 * Why we don't reuse the Vercel AI SDK here (as `/api/chat/route.ts` does):
 * `streamText` is hard-wired to the Chat Completions chunk shape. The
 * Responses API emits typed events (`response.output_text.delta`,
 * `response.completed`, etc) that don't fit. We forward the SSE stream
 * verbatim so the playground can render the typed events directly.
 *
 * Phase 1 (this commit) supports text-only multi-turn conversations.
 * Tool calls and reasoning surfaces are tracked as follow-ups.
 */

export type ResponsesRequest = {
  workspaceId: string;
  environmentId: string;
  resourceConfigOverrides: Partial<AiResourceEntity>;
  messages: ChatMessage[];
  /**
   * When true, add OpenAI Responses' canonical web-search tool to the
   * request. Other providers either search by default (Perplexity) or
   * ignore unknown tool entries — so it's safe-ish to always forward.
   */
  webSearch?: boolean;
  /**
   * Caller-side gateway envelope. Forwarded into `vmx` on the upstream
   * call so audit + metrics surface them.
   */
  correlationId?: string;
  metadata?: Record<string, string>;
};

export const maxDuration = 120;

export async function POST(req: Request) {
  const session = await auth();
  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  const {
    workspaceId,
    environmentId,
    resourceConfigOverrides,
    messages,
    webSearch,
    correlationId,
    metadata,
  }: ResponsesRequest = await req.json();

  const actionHeaders = await headers();
  const sourceIp = actionHeaders.get('x-forwarded-for');

  // Convert the chat-style message list to Responses-API `input` items.
  const input = messages.map((m) => {
    if (m.role === 'user') {
      return {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: m.parts
              .filter((p) => p.type === 'text')
              .map((p) => p.text)
              .join(''),
          },
        ],
      };
    }
    return {
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'output_text',
          text: m.parts
            .filter((p) => p.type === 'text')
            .map((p) => p.text)
            .join(''),
        },
      ],
    };
  });

  // API_BASE_URL points at the API host (no `/api` suffix — that lives in
  // BASE_PATH on the API). The OpenAPI codegen client gets the prefix from
  // its spec; this hand-built URL has to include it explicitly.
  const upstreamUrl = `${process.env.API_BASE_URL}/api/v1/completion/${workspaceId}/${environmentId}/responses`;

  // Cancel cascade: the full chain we're building is
  //
  //   browser → BFF stream → upstream fetch → gateway → provider SDK
  //
  // When the browser closes the SSE consumer (page nav, fetch
  // AbortController), the BFF's outbound `Response`'s underlying
  // ReadableStream gets `cancel()`-ed. We bridge that into
  // `upstreamAbort.abort()`, which closes the fetch to the gateway.
  // The gateway's controller then sees its `res.raw` `close` event
  // before its `streamComplete` flag is set and aborts the provider
  // SDK call. Token spend stops at the source.
  const upstreamAbort = new AbortController();

  const upstream = await fetch(upstreamUrl, {
    method: 'POST',
    signal: upstreamAbort.signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessToken}`,
      ...(sourceIp ? { 'x-forwarded-for': sourceIp } : {}),
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      // The Responses API converter resolves resource config overrides via
      // the same `vmx` envelope as the chat-completions endpoint. The
      // playground may also tag the request with `correlationId` /
      // `metadata` for downstream audit + metrics surfacing.
      vmx: {
        resourceConfigOverrides,
        ...(correlationId ? { correlationId } : {}),
        ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
      },
      // Use the resource name as the model — the gateway will resolve.
      model: resourceConfigOverrides.name ?? 'default',
      input,
      stream: true,
      // Web-search opt-in. The OpenAI Responses-API tool name is
      // `web_search_preview`; for other providers the converter currently
      // strips non-function tools, so this is effectively an OpenAI flag
      // (and a no-op for Perplexity sonar, which always searches).
      ...(webSearch ? { tools: [{ type: 'web_search_preview' }] } : {}),
    }),
  });

  // If upstream errored before streaming started, surface the body verbatim.
  if (!upstream.ok || !upstream.body) {
    const errBody = await upstream.text();
    return new Response(errBody, {
      status: upstream.status,
      headers: {
        'Content-Type':
          upstream.headers.get('content-type') ?? 'application/json',
      },
    });
  }

  // Wrap the upstream body so a downstream cancel (browser
  // disconnect) also aborts the upstream fetch. Without this the
  // gateway keeps streaming bytes nobody reads, and the gateway's
  // `close` listener fires too late to stop the provider call.
  const reader = upstream.body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (done) {
          controller.close();
        } else if (value) {
          controller.enqueue(value);
        }
      } catch (err) {
        controller.error(err);
      }
    },
    cancel(reason) {
      upstreamAbort.abort(reason);
      reader.cancel(reason).catch(() => {
        // Reader cancel after abort can throw — already torn down.
      });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Mirror VM-X response headers the chat panel renders (model,
      // provider, connectionId) so the UI can label the conversation.
      ...Object.fromEntries(
        ['x-vmx-model', 'x-vmx-provider', 'x-vmx-connection-id']
          .map((k) => [k, upstream.headers.get(k)])
          .filter(([, v]) => !!v) as [string, string][]
      ),
    },
  });
}
