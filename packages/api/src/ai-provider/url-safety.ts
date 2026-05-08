import { HttpStatus } from '@nestjs/common';
import { CompletionError } from '../gateway/completion.types';

/**
 * Hosts that must never resolve outbound from gateway-side code.
 *
 * - `localhost` / `127.0.0.0/8` / `::1` — never a legitimate target
 *   for a *client-supplied* URL fetched from the server.
 * - `169.254.169.254` — AWS / GCP / Azure instance metadata service.
 *   A confused-deputy attack would otherwise let any client read our
 *   instance IAM credentials.
 * - RFC1918 private ranges (`10/8`, `172.16/12`, `192.168/16`) —
 *   internal services, databases, RPC endpoints. A compromised client
 *   shouldn't be able to probe them.
 * - `0.0.0.0` and `::` — wildcard binds; same logic as localhost.
 */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '0.0.0.0',
  '::',
  '::1',
  '169.254.169.254',
]);

/** RFC1918 + link-local + loopback ranges. */
const PRIVATE_IPV4_PREFIXES = [
  '10.',
  '127.',
  '169.254.',
  '192.168.',
  // 172.16.0.0 - 172.31.255.255
  ...Array.from({ length: 16 }, (_, i) => `172.${16 + i}.`),
];

const ALLOWED_PROTOCOLS = new Set(['https:', 'http:', 'data:']);

/**
 * Reject URLs that would let a client's request body force the gateway
 * to fetch something it shouldn't. Throws a `CompletionError` (400) on
 * any blocked URL — never silently passes.
 *
 * Use this anywhere the gateway hop-fetches a URL from a client
 * payload (image_url, document.source.url, etc.). `data:` URLs pass
 * because they're inline; `https://` and `http://` get the IP / host
 * checks below.
 */
export function assertSafeOutboundUrl(
  url: string,
  context: { messageIndex?: number; contentPartIndex?: number } = {}
): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw badUrl('Malformed URL', url, context);
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw badUrl(
      `Blocked URL scheme '${parsed.protocol}' — only https/http/data allowed`,
      url,
      context
    );
  }

  // `data:` URLs don't hop a network — they're just inline bytes.
  if (parsed.protocol === 'data:') return;

  // WHATWG URL parser keeps the literal brackets on IPv6 hostnames
  // (`new URL('http://[::1]/').hostname === '[::1]'`), so the
  // blocklist comparisons below — which use bare `::1` / `fe80:` —
  // would silently miss bracketed IPv6 inputs without this strip.
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw badUrl(
      `Blocked outbound host '${hostname}' (instance metadata / loopback)`,
      url,
      context
    );
  }

  if (PRIVATE_IPV4_PREFIXES.some((p) => hostname.startsWith(p))) {
    throw badUrl(
      `Blocked outbound host '${hostname}' (private IP range)`,
      url,
      context
    );
  }

  // IPv6 link-local (fe80::/10) and loopback (::1).
  if (hostname.startsWith('fe80:') || hostname === '::1') {
    throw badUrl(
      `Blocked outbound host '${hostname}' (IPv6 link-local / loopback)`,
      url,
      context
    );
  }
}

function badUrl(
  message: string,
  url: string,
  context: { messageIndex?: number; contentPartIndex?: number }
): CompletionError {
  const param =
    context.messageIndex !== undefined && context.contentPartIndex !== undefined
      ? `messages[${context.messageIndex}].content[${context.contentPartIndex}]`
      : undefined;
  return new CompletionError({
    message: `${message}: ${url}`,
    rate: false,
    retryable: false,
    statusCode: HttpStatus.BAD_REQUEST,
    failureReason: 'Unsafe outbound URL rejected',
    openAICompatibleError: {
      code: 'unsafe_outbound_url',
      type: 'invalid_request',
      param,
    },
  });
}
