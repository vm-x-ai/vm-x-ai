/**
 * Perplexity API base URLs.
 *
 * Perplexity intentionally exposes its OpenAI-compatible endpoints under
 * two different hosts:
 *
 *   - `POST /chat/completions`  — at the **unversioned** root host. Path
 *     is grandfathered from the original Perplexity API; their docs and
 *     OpenAI SDK examples direct chat-completion callers to
 *     `https://api.perplexity.ai`.
 *   - `POST /v1/responses`      — at the **`/v1`** root. The Responses
 *     endpoint is a more recent OpenAI-compat shim aliased to their
 *     native `/v1/agent`. Both their docs and live calls confirm that
 *     `POST /chat/completions` 404s under `/v1`, and `POST /responses`
 *     404s under the unversioned host — the two paths really are on
 *     different roots.
 *
 * Each provider class points the OpenAI SDK at its endpoint-specific
 * host. We keep both constants here so the asymmetry has a single
 * source of truth and a single explanation; a future Perplexity API
 * cleanup that collapses them onto `/v1` would be a one-line change.
 *
 * Anthropic-Messages requests on Perplexity pivot through Chat
 * Completions (Perplexity has no native Anthropic surface), so that
 * cell reuses the chat host via `PerplexityChatCompletionProvider`.
 */
export const PERPLEXITY_CHAT_COMPLETIONS_BASE_URL = 'https://api.perplexity.ai';
export const PERPLEXITY_RESPONSES_BASE_URL = 'https://api.perplexity.ai/v1';
