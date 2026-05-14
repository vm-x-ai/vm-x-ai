import {
  streamText,
  generateText,
  convertToModelMessages,
  smoothStream,
} from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
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
import {
  chatCompletionsOnlyModelErrorResponse,
  isOpenAIChatCompletionsOnlySearchModel,
} from '../_lib/openai-model-quirks';

/**
 * BFF route for the gateway's `/anthropic/messages` endpoint.
 *
 * Uses the AI SDK's `streamText` against `createAnthropic().messages()`
 * so the same `useChat` hook drives this tab as the chat-completions
 * and responses ones. The Anthropic provider POSTs to
 * `${baseURL}/messages`; our gateway exposes that under
 * `/api/v1/completion/<wid>/<eid>/anthropic/messages`, so the baseURL
 * just stops one segment earlier.
 *
 * Thinking streaming comes for free: the `@ai-sdk/anthropic` v3
 * provider unpacks Anthropic `thinking_delta` content-block deltas
 * into AI SDK `reasoning-delta` chunks the chat panel's Accordion
 * already renders.
 */
export type AnthropicChatRequest = {
  workspaceId: string;
  environmentId: string;
  resourceConfigOverrides: Partial<AiResourceEntity>;
  messages: ChatMessage[];
  /**
   * Web-search opt-in. The BFF injects Anthropic's canonical
   * `web_search_20250305` server tool into the outbound body; the
   * gateway then translates that shape per upstream provider —
   * Gemini → `{googleSearch:{}}`, Bedrock Converse → its hosted
   * search tool, OpenAI Responses → `web_search`, etc. The
   * `@ai-sdk/anthropic` SDK doesn't model server tools as
   * first-class entries, so we splice the wire shape directly via
   * the gateway-fetch `mutateBody` hook.
   */
  webSearch?: boolean;
  /**
   * Reasoning effort tier. Anthropic's `thinking` block takes a token
   * budget (not an effort enum), so the BFF maps the tier to a budget
   * via {@link reasoningEffortToBudgetTokens} and forwards it as
   * `providerOptions.anthropic.thinking`. Models that don't support
   * `thinking` (Haiku <4.5, Opus pre-4) ignore the field.
   */
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  /**
   * Streaming toggle. Defaults to `true`. When `false`, the BFF drives
   * the upstream call with `generateText` (single non-SSE request) and
   * re-encodes the result as a one-burst UI message stream — same
   * `useChat` protocol, no token-by-token animation.
   */
  stream?: boolean;
  correlationId?: string;
  metadata?: Record<string, string>;
  timeoutMs?: number;
};

function reasoningEffortToBudgetTokens(
  effort: 'minimal' | 'low' | 'medium' | 'high'
): number {
  switch (effort) {
    case 'minimal':
      return 1024;
    case 'low':
      return 2048;
    case 'medium':
      return 4096;
    case 'high':
      return 8192;
  }
}

export const maxDuration = 120;

export async function POST(req: Request) {
  const {
    workspaceId,
    environmentId,
    resourceConfigOverrides,
    messages,
    webSearch,
    reasoningEffort,
    stream = true,
    correlationId,
    metadata,
    timeoutMs,
  }: AnthropicChatRequest = await req.json();

  const session = await auth();
  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Hard-stop for OpenAI's Chat-Completions-only search-class models —
  // the Anthropic endpoint dispatches through OpenAI's Responses API
  // when the upstream is OpenAI, so the same incompatibility applies as
  // on the Responses BFF route.
  const upstreamModel =
    (resourceConfigOverrides as { model?: { model?: string } }).model?.model ??
    '';
  if (isOpenAIChatCompletionsOnlySearchModel(upstreamModel)) {
    return chatCompletionsOnlyModelErrorResponse(upstreamModel, 'anthropic');
  }

  // `@ai-sdk/anthropic`'s provider POSTs to `${baseURL}/messages`. Our
  // gateway exposes the Anthropic-shape endpoint at
  // `/api/v1/completion/<wid>/<eid>/anthropic/messages`, so the base
  // URL stops at `.../anthropic` to let the SDK append `/messages`.
  const baseURL = `${process.env.API_BASE_URL}/api/v1/completion/${workspaceId}/${environmentId}/anthropic`;
  const actionHeaders = await headers();
  const responseMetadata: GatewayResponseMetadata = {};

  // Use `authToken` (forces `Authorization: Bearer ...`) instead of
  // `apiKey` (which the Anthropic provider sends as `x-api-key` —
  // Anthropic-native auth that our gateway's AppGuard doesn't honour).
  const provider = createAnthropic({
    authToken: session.accessToken,
    baseURL,
    fetch: createGatewayFetch({
      actionHeaders,
      resourceConfigOverrides,
      envelope: { correlationId, metadata, timeoutMs },
      responseMetadata,
      // Web-search opt-in for the Anthropic endpoint. Inject the
      // canonical Anthropic `web_search_20250305` server tool into the
      // outbound `tools[]` so the gateway can translate it per
      // upstream provider — Gemini → `{googleSearch:{}}`, Bedrock
      // Converse → its hosted search tool, etc. Skipped when the
      // routed model is Anthropic's own search-class variant (none
      // today, but mirrors the Responses-route guard for parity).
      mutateBody: (body) => {
        if (!webSearch) return null;
        return {
          ...body,
          tools: [
            ...((body.tools as unknown[]) ?? []),
            { type: 'web_search_20250305', name: 'web_search' },
          ],
        };
      },
      transformResponse: composeAnthropicTransforms,
    }),
  });

  const thinkingBudget = reasoningEffort
    ? reasoningEffortToBudgetTokens(reasoningEffort)
    : 0;

  const modelMessages = await convertToModelMessages(messages);

  // Non-streaming branch: single non-SSE upstream call via
  // `generateText`, then a one-burst UI message stream so `useChat`
  // renders the reply (plus any reasoning) in one shot. Wrapped in
  // try/catch because the AI SDK Anthropic Zod schema can reject
  // provider-specific shapes that survive `composeAnthropicTransforms`
  // — without the catch, the error escapes the route handler and
  // Next.js returns 500 with an empty body, leaving the playground
  // showing a silent failure.
  if (!stream) {
    try {
      const result = await generateText({
        abortSignal: req.signal,
        model: provider.messages(resourceConfigOverrides.name ?? ''),
        messages: modelMessages,
        ...(reasoningEffort
          ? {
              // Anthropic's `thinking.budget_tokens` competes with the
              // model's `max_tokens` budget for the same output window —
              // the SDK handles raising `max_tokens` automatically when
              // `thinking` is on, so we don't need a manual bump here.
              providerOptions: {
                anthropic: {
                  thinking: {
                    type: 'enabled',
                    budgetTokens: thinkingBudget,
                  },
                },
              },
            }
          : {}),
      });
      return nonStreamingResultToUIMessageStreamResponse(result, {
        originalMessages: messages,
        sendReasoning: true,
        messageMetadata: uiMessageMetadataFromGateway(responseMetadata),
      });
    } catch (err) {
      return new Response(
        JSON.stringify({
          error: {
            message: err instanceof Error ? err.message : String(err),
            code: 'response_parse_error',
          },
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  }

  const result = streamText({
    abortSignal: req.signal,
    model: provider.messages(resourceConfigOverrides.name ?? ''),
    messages: modelMessages,
    ...(reasoningEffort
      ? {
          // Anthropic's `thinking.budget_tokens` competes with the
          // model's `max_tokens` budget for the same output window —
          // the SDK handles raising `max_tokens` automatically when
          // `thinking` is on, so we don't need a manual bump here.
          providerOptions: {
            anthropic: {
              thinking: {
                type: 'enabled',
                budgetTokens: thinkingBudget,
              },
            },
          },
        }
      : {}),
    experimental_transform: smoothStream({
      delayInMs: 20,
    }),
  });

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    sendReasoning: true,
    messageMetadata: () => uiMessageMetadataFromGateway(responseMetadata),
  });
}

// ─── message_start placeholder stripper ────────────────────────────────

/**
 * Two patches on the upstream Response, in order:
 *
 *   1. **Stream**: strip the non-spec `{type:'thinking', thinking:'',
 *      signature:''}` placeholder Anthropic puts in
 *      `message_start.message.content[]` when extended thinking is
 *      on. The AI SDK's `messageStart` chunk schema only allows
 *      `tool_use` pre-population and rejects the whole frame
 *      otherwise. Anthropic emits a proper `content_block_start` for
 *      the same block immediately after, so dropping the placeholder
 *      is lossless.
 *   2. **Error JSON**: when the gateway returns a non-2xx JSON error
 *      envelope (`{error:{message,code}}`), rewrite the response
 *      into a synthetic `text/event-stream` body carrying a single
 *      `{type:'error', error:{type, message}}` frame. The AI SDK
 *      Anthropic provider's chunk schema has a matching `error`
 *      variant, so the upstream error then surfaces as a normal
 *      error on the `useChat`'s `error` state instead of "Type
 *      validation failed" garbage.
 *
 * Non-streaming JSON success bodies pass through unchanged.
 */
function maybeStripMessageStartPlaceholders(
  upstream: Response,
  wantsStreaming: boolean
): Response {
  if (!upstream.body) return upstream;
  // SSE error-frame rewrite only applies to streaming callers. For
  // non-streaming `generateText` the AI SDK Anthropic provider expects
  // a JSON body back and converts a non-2xx into a typed `APICallError`
  // itself — SSE-encoding the error would yield an empty error in the
  // UI because the parser can't make sense of `text/event-stream` here.
  if (!upstream.ok && isJsonResponse(upstream) && wantsStreaming) {
    return rewriteJsonErrorAsSseFrame(upstream);
  }
  if (
    !(upstream.headers.get('content-type') ?? '').includes('text/event-stream')
  ) {
    return upstream;
  }
  return new Response(
    upstream.body.pipeThrough(makeMessageStartStripperStream()),
    {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: upstream.headers,
    }
  );
}

// ─── citations:null stripper (non-streaming Anthropic body) ──────────

/**
 * Cross-format providers without a native Anthropic API (Perplexity,
 * Gemini, Bedrock-Converse, etc.) build their Anthropic-shape response
 * via the gateway's `responseResponsesToAnthropic` / equivalent
 * converters, which emit `{type:'text', text, citations: null}`. The
 * official `@anthropic-ai/sdk` TypeScript types require the `null` —
 * but the Vercel `@ai-sdk/anthropic` v3 Zod schema declares `citations`
 * as `.optional()` (not `.nullable()`) and rejects the parse with
 * "Invalid input: expected array, received null". The error escapes
 * `generateText`, the BFF route doesn't catch, Next.js returns 500
 * with empty body — the symptom is a silent playground failure.
 *
 * Per the passthrough-fidelity rule the gateway keeps the legacy
 * `null` for SDK-native consumers; this BFF-side transform normalises
 * the field for the AI SDK by stripping it whenever it's `null` on a
 * 2xx JSON body. Streaming bodies pass through unchanged — the chunk
 * schema for `content_block_start` parses `citations: null` fine.
 */
function maybeStripNullCitations(upstream: Response): Response {
  if (!upstream.body) return upstream;
  if (!upstream.ok) return upstream;
  if (!isJsonResponse(upstream)) return upstream;
  const passThrough = new TransformStream<Uint8Array, Uint8Array>();
  const writer = passThrough.writable.getWriter();
  const encoder = new TextEncoder();
  void upstream
    .clone()
    .text()
    .then((raw) => {
      try {
        const parsed = JSON.parse(raw) as {
          content?: Array<{ type?: string; citations?: unknown }>;
        };
        if (Array.isArray(parsed.content)) {
          for (const block of parsed.content) {
            if (block && block.citations === null) {
              delete block.citations;
            }
          }
        }
        void writer.write(encoder.encode(JSON.stringify(parsed)));
      } catch {
        void writer.write(encoder.encode(raw));
      }
      void writer.close();
    })
    .catch(() => {
      void writer.close();
    });
  return new Response(passThrough.readable, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}

/**
 * Chain the two Anthropic response transforms: first apply the
 * message_start / JSON-error rewrites (which may turn a JSON error
 * body into an SSE stream and short-circuit the rest), then strip
 * `citations: null` from any remaining 2xx JSON body. Order matters
 * only because the first step can re-encode an error response as SSE
 * — the citations stripper sees the post-transform body and leaves
 * SSE alone.
 */
function composeAnthropicTransforms(
  upstream: Response,
  wantsStreaming: boolean
): Response {
  const afterMessageStart = maybeStripMessageStartPlaceholders(
    upstream,
    wantsStreaming
  );
  return maybeStripNullCitations(afterMessageStart);
}

function isJsonResponse(resp: Response): boolean {
  return (resp.headers.get('content-type') ?? '').includes('application/json');
}

/**
 * Build a one-frame SSE body that the AI SDK Anthropic chunk schema
 * can parse: `event: error\ndata: {"type":"error","error":{...}}\n\n`.
 * Returns HTTP 200 — the SDK already treats the parsed `error` chunk
 * as a fatal error and bubbles it up, but a non-2xx status would
 * short-circuit its body parsing entirely.
 */
function rewriteJsonErrorAsSseFrame(upstream: Response): Response {
  const passThrough = new TransformStream<Uint8Array, Uint8Array>();
  const writer = passThrough.writable.getWriter();
  const encoder = new TextEncoder();
  void upstream
    .clone()
    .text()
    .then((raw) => {
      const parsed = safeParseErrorBody(raw);
      const frame =
        `event: error\n` +
        `data: ${JSON.stringify({
          type: 'error',
          error: {
            type: parsed.code ?? 'api_error',
            message: parsed.message ?? raw,
          },
        })}\n\n`;
      void writer.write(encoder.encode(frame));
      void writer.close();
    })
    .catch((err) => {
      const frame =
        `event: error\n` +
        `data: ${JSON.stringify({
          type: 'error',
          error: {
            type: 'api_error',
            message: err instanceof Error ? err.message : String(err),
          },
        })}\n\n`;
      void writer.write(encoder.encode(frame));
      void writer.close();
    });
  return new Response(passThrough.readable, {
    status: 200,
    statusText: 'OK',
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

function safeParseErrorBody(raw: string): { message?: string; code?: string } {
  try {
    const json = JSON.parse(raw) as {
      error?: { message?: string; code?: string; type?: string };
    };
    if (json && typeof json === 'object' && json.error) {
      return {
        message: json.error.message,
        code: json.error.code ?? json.error.type,
      };
    }
  } catch {
    // Fall through to plain-text fallback.
  }
  return { message: raw };
}

function stripMessageStartContent(event: string): string {
  // Cheap pre-check — most events aren't `message_start`, so skip the
  // JSON round-trip on those.
  if (!event.includes('message_start')) return event;
  return event
    .split('\n')
    .map((line) => {
      if (!line.startsWith('data: ')) return line;
      const body = line.slice(6);
      try {
        const parsed = JSON.parse(body) as {
          type?: string;
          message?: { content?: Array<{ type?: string }> };
        };
        if (
          parsed.type === 'message_start' &&
          parsed.message?.content &&
          Array.isArray(parsed.message.content)
        ) {
          // Keep only `tool_use` entries — Anthropic's documented
          // pre-population shape; drop `thinking` and any future
          // placeholders the SDK doesn't model.
          parsed.message.content = parsed.message.content.filter(
            (p) => p?.type === 'tool_use'
          );
          return 'data: ' + JSON.stringify(parsed);
        }
        return line;
      } catch {
        return line;
      }
    })
    .join('\n');
}

function makeMessageStartStripperStream(): TransformStream<
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
        controller.enqueue(
          encoder.encode(stripMessageStartContent(event) + '\n\n')
        );
        boundary = buffer.indexOf('\n\n');
      }
    },
    flush(controller) {
      buffer += decoder.decode();
      if (buffer.length > 0) {
        controller.enqueue(encoder.encode(stripMessageStartContent(buffer)));
      }
    },
  });
}
