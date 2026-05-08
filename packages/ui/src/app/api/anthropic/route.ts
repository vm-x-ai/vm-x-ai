import { auth } from '@/auth';
import { headers } from 'next/headers';
import { AiResourceEntity } from '@/clients/api';
import { ChatMessage } from '@/components/Chat/types';

/**
 * BFF route for the gateway's `/anthropic/messages` endpoint. The
 * Playground's "Anthropic Messages" mode hits this so the request body
 * the gateway sees is the Anthropic Messages shape (model, messages,
 * max_tokens) rather than Chat Completions — exercising the Phase 11
 * format-aware path end-to-end.
 *
 * Non-streaming only for now. Streaming Anthropic SSE event mapping
 * (`message_start` / `content_block_delta` / `message_delta`) is a
 * Phase 11B follow-up; the gateway forwards OpenAI Chat Completion
 * stream events verbatim today.
 */
export type AnthropicChatRequest = {
  workspaceId: string;
  environmentId: string;
  resourceConfigOverrides: Partial<AiResourceEntity>;
  messages: ChatMessage[];
  /** Sent verbatim into the Anthropic body. Defaults to 1024. */
  maxTokens?: number;
  /**
   * Caller-side gateway envelope. Forwarded into `vmx` on the upstream
   * call so audit + metrics surface them.
   */
  correlationId?: string;
  metadata?: Record<string, string>;
};

// Allow up to 60s for non-streaming. Anthropic large-context calls can
// approach this — the 120s used by `/api/chat` covers streaming where
// the connection stays open longer.
export const maxDuration = 60;

export async function POST(req: Request) {
  const {
    workspaceId,
    environmentId,
    resourceConfigOverrides,
    messages,
    maxTokens,
    correlationId,
    metadata,
  }: AnthropicChatRequest = await req.json();

  const session = await auth();
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = `${process.env.API_BASE_URL}/api/v1/completion/${workspaceId}/${environmentId}/anthropic/messages`;
  const reqHeaders = await headers();
  const sourceIp = reqHeaders.get('x-forwarded-for');

  // Adapt the AI SDK chat history into Anthropic's shape:
  //   - assistants/users → role + content (text only for now)
  //   - max_tokens is required by Anthropic Messages API
  //   - model comes from the resource override; the gateway re-resolves
  //     by name, so an empty string when nothing is overridden is safe.
  const anthropicBody = {
    model: resourceConfigOverrides?.name ?? '',
    max_tokens: maxTokens ?? 1024,
    messages: messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role,
        content: m.parts.map((p) => (p.type === 'text' ? p.text : '')).join(''),
      })),
    vmx:
      resourceConfigOverrides ||
      correlationId ||
      (metadata && Object.keys(metadata).length > 0)
        ? {
            ...(resourceConfigOverrides ? { resourceConfigOverrides } : {}),
            ...(correlationId ? { correlationId } : {}),
            ...(metadata && Object.keys(metadata).length > 0
              ? { metadata }
              : {}),
          }
        : undefined,
  };

  const upstream = await fetch(url, {
    method: 'POST',
    signal: req.signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessToken}`,
      ...(sourceIp ? { 'x-forwarded-for': sourceIp } : {}),
    },
    body: JSON.stringify(anthropicBody),
  });

  if (!upstream.ok) {
    const errText = await upstream.text();
    return new Response(errText, {
      status: upstream.status,
      headers: {
        'Content-Type':
          upstream.headers.get('content-type') ?? 'application/json',
      },
    });
  }

  // Forward the gateway's headers (x-vmx-*, x-request-id, etc.) so the
  // playground UI can read the routed model/provider chips, plus the
  // body verbatim.
  const passthroughHeaders: Record<string, string> = {
    'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
  };
  for (const [k, v] of upstream.headers.entries()) {
    if (k.startsWith('x-vmx-') || k === 'x-request-id') {
      passthroughHeaders[k] = v;
    }
  }
  const body = await upstream.text();
  return new Response(body, {
    status: 200,
    headers: passthroughHeaders,
  });
}
