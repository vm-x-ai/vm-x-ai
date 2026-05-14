/**
 * Per OpenAI's web-search limitations doc, three models are
 * **Chat-Completions-only** search variants: they have web search baked
 * into the model and are not accessible on the Responses API. Routing
 * them through Responses (or our Anthropic dispatcher, which converts to
 * Responses for OpenAI upstream) returns a 500 (plain prompt) or a 400
 * `Tool 'web_search_preview' is not supported` (with any tool variant).
 *
 * @see https://developers.openai.com/api/docs/guides/tools-web-search#limitations
 *
 * `gpt-4o-search-preview` and `gpt-4o-mini-search-preview` are scheduled
 * for shutdown on 2026-07-23; `gpt-5-search-api` is the current GA
 * search-class model. Matching by exact id keeps the guard tight — a
 * loose `/search/i` regex would false-positive on hypothetical future
 * non-OpenAI models like `gemini-search-grounded`.
 */
const OPENAI_CHAT_COMPLETIONS_ONLY_MODELS = new Set([
  'gpt-5-search-api',
  'gpt-4o-search-preview',
  'gpt-4o-mini-search-preview',
]);

export function isOpenAIChatCompletionsOnlySearchModel(
  upstreamModel: string | null | undefined
): boolean {
  if (!upstreamModel) return false;
  return OPENAI_CHAT_COMPLETIONS_ONLY_MODELS.has(upstreamModel);
}

export function chatCompletionsOnlyModelErrorResponse(
  upstreamModel: string,
  endpoint: 'responses' | 'anthropic'
): Response {
  const message =
    `\`${upstreamModel}\` is a Chat-Completions-only search model and ` +
    `cannot be used on the ${
      endpoint === 'responses' ? 'Responses' : 'Anthropic Messages'
    } ` +
    `endpoint. Switch the playground to **Chat Completions** or pick a different model.`;
  return new Response(
    JSON.stringify({
      error: {
        message,
        code: 'model_endpoint_mismatch',
      },
    }),
    {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}
