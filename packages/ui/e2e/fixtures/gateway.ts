import type { APIRequestContext } from '@playwright/test';

/**
 * Drive a non-streaming chat completion through the test-only BFF
 * (`/api/test/completion`) using the authenticated session.
 *
 * Why not `/api/chat`: that route uses the Vercel AI SDK's
 * `streamText`, which returns a Server-Sent Events body. Playwright's
 * `APIRequestContext.post()` buffers the entire response body before
 * resolving, which stalls on streamed responses. The test BFF instead
 * forwards `stream: false` and returns plain JSON.
 *
 * Why not call `/api/v1/completion/.../chat/completions` directly with
 * an API key: the gateway's API-key guard requires a `:resource` URL
 * param the chat-completions route doesn't have, so API-key auth
 * always 401s on this endpoint. The BFF reuses the user's OIDC session.
 *
 * The BFF accepts a small `vmx` envelope (correlationId, metadata,
 * timeoutMs) so the e2e suite can drive metadata-tagged traffic,
 * share a correlationId across calls, and exercise the timeout abort.
 */
export type ChatCompletionInput = {
  resourceName: string;
  workspaceId: string;
  environmentId: string;
  messages?: Array<{
    role: 'user' | 'system' | 'assistant';
    content: string;
  }>;
  correlationId?: string;
  metadata?: Record<string, string>;
  timeoutMs?: number;
  /**
   * Mirrors the playground UI's webSearch toggle. Forwarded to the
   * gateway as `web_search_options: {}` (OpenAI / Perplexity); other
   * providers ignore the field.
   */
  webSearch?: boolean;
};

export type ChatCompletionResult = {
  status: number;
  body: string;
};

const UI_BASE = process.env.BASE_URL ?? 'http://localhost:3001';

export async function chatCompletion(
  request: APIRequestContext,
  input: ChatCompletionInput
): Promise<ChatCompletionResult> {
  const response = await request.post(`${UI_BASE}/api/test/completion`, {
    timeout: 120_000,
    data: {
      workspaceId: input.workspaceId,
      environmentId: input.environmentId,
      resource: input.resourceName,
      messages: input.messages ?? [
        {
          role: 'user' as const,
          content: 'Reply with just the word "ok" and nothing else.',
        },
      ],
      correlationId: input.correlationId,
      metadata: input.metadata,
      timeoutMs: input.timeoutMs,
      webSearch: input.webSearch,
    },
  });

  const body = await response.text();
  return { status: response.status(), body };
}

/**
 * Drive a non-streaming Anthropic Messages completion through the
 * playground's BFF (`/api/anthropic`) using the authenticated session.
 * The BFF wraps the gateway's `/anthropic/messages` endpoint, which is
 * the Phase 11 format-aware path — same auth/audit/routing pipeline as
 * `/chat/completions`, just with Anthropic Messages shape on the wire.
 *
 * Returns the raw text body so callers can `JSON.parse` and inspect
 * the Anthropic-shape fields (`content[0].text`, `usage.input_tokens`,
 * etc.) without binding to a specific schema upfront.
 */
export type AnthropicMessageInput = {
  /**
   * Resource name forwarded as Anthropic's `model` field. The gateway
   * resolves it to a real connection/model the same way it does for
   * Chat Completions, so a workspace's auto-resource (`<connection>-default`)
   * is a valid value.
   */
  resourceName: string;
  workspaceId: string;
  environmentId: string;
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxTokens?: number;
};

export async function anthropicMessage(
  request: APIRequestContext,
  input: AnthropicMessageInput
): Promise<ChatCompletionResult> {
  const response = await request.post(`${UI_BASE}/api/anthropic`, {
    timeout: 120_000,
    data: {
      workspaceId: input.workspaceId,
      environmentId: input.environmentId,
      // The BFF reads the Anthropic `model` value off
      // `resourceConfigOverrides.name`, matching how the playground
      // synthesises ephemeral resources (`<conn>/<model>` slug). For
      // the e2e suite, passing the auto-resource name directly is the
      // shortest path — the gateway looks it up as a real Resource.
      resourceConfigOverrides: { name: input.resourceName },
      messages: (
        input.messages ?? [
          {
            role: 'user' as const,
            content: 'Reply with just the word "ok" and nothing else.',
          },
        ]
      ).map((m) => ({
        id: `msg-${Math.random().toString(36).slice(2)}`,
        role: m.role,
        parts: [{ type: 'text', text: m.content }],
      })),
      maxTokens: input.maxTokens ?? 64,
    },
  });

  const body = await response.text();
  return { status: response.status(), body };
}
