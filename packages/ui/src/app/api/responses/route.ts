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
import {
  chatCompletionsOnlyModelErrorResponse,
  isOpenAIChatCompletionsOnlySearchModel,
} from '../_lib/openai-model-quirks';

/**
 * BFF route for the gateway's OpenAI **Responses** endpoint.
 *
 * Uses the AI SDK's `streamText` against `createOpenAI().responses()`
 * so the same `useChat` hook drives this tab as the chat-completions
 * one — the only difference is the upstream wire shape (input items
 * + typed events vs. messages + chunks). Reasoning streaming comes
 * for free: the `@ai-sdk/openai` v3 provider unpacks
 * `response.reasoning_summary_text.delta` events into `reasoning-delta`
 * chunks the chat panel's Accordion already knows how to render.
 */
export type ResponsesRequest = {
  workspaceId: string;
  environmentId: string;
  resourceConfigOverrides: Partial<AiResourceEntity>;
  messages: ChatMessage[];
  /**
   * When true, the BFF asks OpenAI for web search by attaching the
   * Responses-API canonical tool. Other providers either search by
   * default (Perplexity) or strip non-function tools — so it's
   * effectively an OpenAI flag.
   */
  webSearch?: boolean;
  /**
   * Reasoning effort tier. Forwarded as `providerOptions.openai`
   * (`reasoningEffort` + `reasoningSummary: 'auto'`) so the upstream
   * emits both the request-side `reasoning.effort` knob and the
   * `response.reasoning_summary_text.delta` events.
   */
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  /**
   * Streaming toggle. Defaults to `true`. When `false`, the BFF
   * drives the upstream call with `generateText` (single non-SSE
   * request) and re-encodes the result as a one-burst UI message
   * stream — same `useChat` protocol, no token-by-token animation.
   */
  stream?: boolean;
  correlationId?: string;
  metadata?: Record<string, string>;
  timeoutMs?: number;
};

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
  }: ResponsesRequest = await req.json();

  const session = await auth();
  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Hard-stop for OpenAI's Chat-Completions-only search-class models
  // (`gpt-5-search-api` and the deprecated `gpt-4o[-mini]-search-preview`
  // pair). These can't run on the Responses API at all — OpenAI returns
  // 500 on a plain prompt and 400 with any tool variant — so let the
  // caller know to switch endpoints instead of surfacing a confusing
  // upstream error.
  const upstreamModel =
    (resourceConfigOverrides as { model?: { model?: string } }).model?.model ??
    '';
  if (isOpenAIChatCompletionsOnlySearchModel(upstreamModel)) {
    return chatCompletionsOnlyModelErrorResponse(upstreamModel, 'responses');
  }

  // `@ai-sdk/openai`'s `.responses()` POSTs to `${baseURL}/responses`.
  // Our gateway exposes that endpoint under the same
  // `/api/v1/completion/<wid>/<eid>/...` prefix the chat-completions
  // BFF uses, so the baseURL is identical.
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
      // Web-search opt-in. `tools: [{type: 'web_search'}]` is the
      // current OpenAI Responses-API canonical entry; the legacy
      // `web_search_preview` still works for older integrations but
      // the docs recommend `web_search` for new code. Other providers
      // either strip non-function tools or always search.
      //
      // Chat-Completions-only search-class models (`gpt-5-search-api`,
      // `gpt-4o-search-preview`, `gpt-4o-mini-search-preview`) are
      // already rejected up top by `isOpenAIChatCompletionsOnlySearchModel`,
      // so they never reach this branch.
      //
      // @see https://developers.openai.com/api/docs/guides/tools-web-search#limitations
      mutateBody: (body) => {
        if (!webSearch) return null;
        return {
          ...body,
          tools: [...((body.tools as unknown[]) ?? []), { type: 'web_search' }],
        };
      },
      transformResponse: composeResponsesTransforms,
    }),
  });

  const modelMessages = await convertToModelMessages(messages);
  // `summary: 'auto'` is mandatory to get user-visible reasoning text
  // on the wire. Without it the model still reasons internally but
  // the BFF sees no `response.reasoning_summary_text.delta` events
  // and the chat Accordion stays empty.
  //
  // `forceReasoning: true` overrides the SDK's
  // `modelCapabilities.isReasoningModel` check, which keys off the
  // model id string. Our model id is the VM-X resource name (the
  // gateway re-routes by name), so the SDK can't tell whether the
  // upstream is a reasoning model — without this flag it silently
  // strips the `reasoning` field from the outbound body.
  const providerOptions = reasoningEffort
    ? {
        providerOptions: {
          openai: {
            reasoningEffort,
            reasoningSummary: 'auto',
            forceReasoning: true,
          },
        },
      }
    : {};

  // Non-streaming branch: single non-SSE upstream call via
  // `generateText`, then a one-burst UI message stream so `useChat`
  // renders the reply in one shot. Wrapped in try/catch because the
  // AI SDK's Responses Zod schema can reject provider-specific shapes
  // (Perplexity's `{type:'search_results'}` output item being the
  // canonical example) — without the catch the error escapes the
  // route handler and Next.js returns 500 with an empty body, leaving
  // the playground showing a silent failure. Re-encoding the error as
  // a one-burst UI message stream lets `useChat`'s `error` callback
  // surface a useful message.
  if (!stream) {
    try {
      const result = await generateText({
        abortSignal: req.signal,
        model: provider.responses(resourceConfigOverrides.name ?? ''),
        messages: modelMessages,
        ...providerOptions,
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
    model: provider.responses(resourceConfigOverrides.name ?? ''),
    messages: modelMessages,
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

// ─── JSON error → SSE error frame (Responses shape) ──────────────────────

/**
 * When the gateway returns a non-2xx JSON error envelope
 * (`{error:{message,code}}`), rewrite the response into a synthetic
 * `text/event-stream` body carrying a single Responses-shape error
 * event: `{type:'error', sequence_number:0, error:{type, message}}`.
 * The `@ai-sdk/openai` Responses chunk schema has a matching `error`
 * variant — the upstream error then surfaces on `useChat`'s `error`
 * state instead of "Type validation failed" union-mismatch garbage.
 *
 * Non-streaming JSON success bodies and SSE streams pass through.
 */
function maybeRewriteJsonErrorAsSse(
  upstream: Response,
  wantsStreaming: boolean
): Response {
  if (!upstream.body) return upstream;
  if (upstream.ok) return upstream;
  if (
    !(upstream.headers.get('content-type') ?? '').includes('application/json')
  ) {
    return upstream;
  }
  // Only the streaming path needs the SSE wrapper — `generateText`
  // already knows how to parse a non-2xx JSON error envelope.
  if (!wantsStreaming) return upstream;
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
          sequence_number: 0,
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
          sequence_number: 0,
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

// ─── Non-canonical output-item stripper (Perplexity, etc.) ──────────────

/**
 * Types the AI SDK's Responses Zod schema accepts as discriminators on
 * `response.output[]`. Items with any other `type` (Perplexity emits
 * `{type:'search_results', queries, results}`, other OpenAI-compat
 * providers may invent their own) fail Zod validation and the SDK
 * throws on parse — surfacing as a silent 500 in the playground.
 *
 * Per the passthrough-fidelity rule, the gateway keeps the upstream
 * shape verbatim; this BFF-side filter is the right normalisation
 * seam to keep the AI SDK happy without rewriting at the provider
 * adapter layer.
 */
const RESPONSES_OUTPUT_ITEM_TYPES: ReadonlySet<string> = new Set([
  'message',
  'reasoning',
  'function_call',
  'web_search_call',
  'code_interpreter_call',
  'image_generation_call',
  'computer_call',
]);

/**
 * On a 2xx non-streaming Responses body, drop entries from `output[]`
 * whose `type` isn't in the AI SDK's accepted discriminator union.
 * The data isn't lost — Perplexity also stamps `citations` and
 * `search_results` at the response top level, so playground / SDK
 * consumers can still read the sources; this only removes the
 * duplicate `output[]` entry that breaks Zod parsing.
 *
 * Streaming bodies, 4xx/5xx errors, and non-JSON content pass through.
 */
function maybeStripUnknownOutputItems(upstream: Response): Response {
  if (!upstream.body) return upstream;
  if (!upstream.ok) return upstream;
  if (
    !(upstream.headers.get('content-type') ?? '').includes('application/json')
  ) {
    return upstream;
  }
  const passThrough = new TransformStream<Uint8Array, Uint8Array>();
  const writer = passThrough.writable.getWriter();
  const encoder = new TextEncoder();
  void upstream
    .clone()
    .text()
    .then((raw) => {
      try {
        const parsed = JSON.parse(raw) as { output?: unknown[] };
        if (Array.isArray(parsed.output)) {
          parsed.output = parsed.output.filter((item) => {
            const t = (item as { type?: string })?.type;
            return typeof t === 'string' && RESPONSES_OUTPUT_ITEM_TYPES.has(t);
          });
        }
        void writer.write(encoder.encode(JSON.stringify(parsed)));
      } catch {
        // Non-JSON or unparseable — pass through verbatim. Better to
        // let the SDK surface its own parse error than to silently
        // mutate a body we don't understand.
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
 * Compose the two response-transform steps the Responses BFF needs:
 * (1) the JSON-error → SSE rewrite for streaming pre-flight errors,
 * (2) the non-canonical output-item filter for non-streaming success
 * bodies. The two are mutually exclusive (one fires on non-2xx, the
 * other on 2xx), so order doesn't matter — but funnelling them through
 * one entry-point keeps the createGatewayFetch call site readable.
 */
function composeResponsesTransforms(
  upstream: Response,
  wantsStreaming: boolean
): Response {
  const afterError = maybeRewriteJsonErrorAsSse(upstream, wantsStreaming);
  return maybeStripUnknownOutputItems(afterError);
}
