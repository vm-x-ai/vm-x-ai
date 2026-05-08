/**
 * Caller-header forwarding allowlist + extractor.
 *
 * Provider SDKs (Anthropic, OpenAI, Gemini, …) gate beta features
 * behind opt-in headers like `anthropic-beta` or `openai-beta`. When
 * a caller (e.g. the Claude Code CLI) sets one of those headers on
 * its request, the gateway must forward it to the upstream provider
 * — otherwise the body fields the header opts into (e.g.
 * `context_management`, `output_config.effort`) are rejected as
 * "Extra inputs are not permitted".
 *
 * The default allowlist covers exactly those non-credential headers.
 * `Authorization` is **not** here: forwarding it would let callers
 * override the gateway's own connection-level upstream key. A future
 * per-connection `forwardAuthorization: true` flag could add it back
 * for the bring-your-own-credentials case.
 *
 * Rules:
 *   - Header names lowercased to match Fastify's normalised inbound casing.
 *   - Multi-value headers joined with `, ` (HTTP-spec list style).
 */

const FORWARD_ALLOWLIST = new Set([
  // OpenAI
  'openai-organization',
  'openai-project',
  'openai-beta',
  // Anthropic
  'anthropic-version',
  'anthropic-beta',
  // Gemini / Vertex
  'x-goog-user-project',
  // Generic correlation
  'x-client-request-id',
  'idempotency-key',
]);

export function extractCallerForwardHeaders(
  inboundHeaders: Record<string, string | string[] | undefined> | undefined
): Record<string, string> {
  if (!inboundHeaders) return {};
  const out: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(inboundHeaders)) {
    if (rawValue == null) continue;
    const key = rawKey.toLowerCase();
    if (!FORWARD_ALLOWLIST.has(key)) continue;
    out[key] = Array.isArray(rawValue) ? rawValue.join(', ') : rawValue;
  }
  return Object.keys(out).length ? out : {};
}
