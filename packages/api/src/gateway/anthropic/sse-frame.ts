/**
 * Build an Anthropic-shape SSE frame: `event: <name>\ndata: <json>\n\n`.
 *
 * Anthropic's official SSE protocol routes every typed event through
 * the `event:` line — the SDK's `MessageStream` parser dispatches on
 * that name, ignoring the JSON `type` field. Skipping the `event:`
 * line (the bug T3 closes) means strict consumers misroute every
 * frame even when the JSON is valid.
 *
 * For chunks without a `type` field — only forwarded-through non-
 * Anthropic providers reach this branch — we emit the legacy
 * `data:`-only frame so the existing transport keeps working.
 */
export function formatAnthropicSseFrame(chunk: unknown): string {
  const evType = (chunk as { type?: string } | null | undefined)?.type;
  const payload = JSON.stringify(chunk);
  if (typeof evType === 'string' && evType.length > 0) {
    return `event: ${evType}\ndata: ${payload}\n\n`;
  }
  return `data: ${payload}\n\n`;
}

/**
 * Build a `ping` heartbeat frame. Anthropic's own SSE inserts these
 * to keep idle proxies / load balancers from closing long-running
 * tool-using streams.
 */
export function formatAnthropicPingFrame(): string {
  return `event: ping\ndata: ${JSON.stringify({ type: 'ping' })}\n\n`;
}

/**
 * Build the mid-stream error frame. Anthropic's SDK error handler
 * dispatches on `event: error`; falling back to `data: [ERROR]`
 * leaves clients without a clean error path on streaming.
 */
export function formatAnthropicErrorFrame(errorResponse: unknown): string {
  return `event: error\ndata: ${JSON.stringify(errorResponse)}\n\n`;
}
