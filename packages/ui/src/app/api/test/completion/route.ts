import { auth } from '@/auth';

/**
 * Tiny test-only BFF route that proxies a *non-streaming* chat
 * completion through the gateway. Lets the e2e suite drive
 * metadata-tagged / correlationId-shared / timeout-bounded traffic
 * without dealing with the SSE pump that `/api/chat` returns
 * (Playwright's APIRequestContext buffers the entire body before
 * resolving, which stalls on streaming responses).
 *
 * Mounted only when `NODE_ENV !== 'production'` to avoid exposing a
 * helper API in real deployments.
 */
export const maxDuration = 120;

export async function POST(req: Request) {
  if (process.env.NODE_ENV === 'production') {
    return new Response('Not found', { status: 404 });
  }

  const session = await auth();
  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  const body = await req.json();
  const {
    workspaceId,
    environmentId,
    resource,
    messages,
    correlationId,
    metadata,
    timeoutMs,
    webSearch,
  } = body as {
    workspaceId: string;
    environmentId: string;
    resource: string;
    messages: Array<{ role: 'user' | 'system' | 'assistant'; content: string }>;
    correlationId?: string;
    metadata?: Record<string, string>;
    timeoutMs?: number;
    webSearch?: boolean;
  };

  const url = `${process.env.API_BASE_URL}/api/v1/completion/${workspaceId}/${environmentId}/chat/completions`;
  const upstream = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: resource,
      messages,
      stream: false,
      ...(correlationId || metadata || timeoutMs != null
        ? {
            vmx: {
              ...(correlationId ? { correlationId } : {}),
              ...(metadata ? { metadata } : {}),
              ...(timeoutMs != null ? { timeoutMs } : {}),
            },
          }
        : {}),
      // Mirrors the playground UI's webSearch toggle. The gateway
      // forwards `web_search_options: {}` to OpenAI search-class
      // models; other providers ignore unknown fields.
      ...(webSearch ? { web_search_options: {} } : {}),
    }),
  });

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      'Content-Type':
        upstream.headers.get('content-type') ?? 'application/json',
    },
  });
}
