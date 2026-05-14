import { auth } from '@/auth';

/**
 * Tiny test-only BFF route that proxies a *non-streaming* Anthropic
 * Messages call through the gateway. Parallel to
 * `/api/test/completion`, which serves the Chat Completions side.
 *
 * Why a dedicated route: the playground's `/api/anthropic` route
 * returns an AI SDK UI Message Stream (SSE), which Playwright's
 * `APIRequestContext.post()` buffers in full before resolving, and
 * the test couldn't parse the streamed envelope back to a single
 * JSON object. This route forwards `stream: false` and returns the
 * gateway's Anthropic Messages JSON body verbatim.
 *
 * Mounted only when `NODE_ENV !== 'production'`.
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
  const { workspaceId, environmentId, resource, messages, maxTokens } =
    body as {
      workspaceId: string;
      environmentId: string;
      resource: string;
      messages: Array<{ role: 'user' | 'assistant'; content: string }>;
      maxTokens?: number;
    };

  const url = `${process.env.API_BASE_URL}/api/v1/completion/${workspaceId}/${environmentId}/anthropic/messages`;
  const upstream = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: resource,
      messages,
      max_tokens: maxTokens ?? 64,
      stream: false,
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
