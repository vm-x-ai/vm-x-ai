import type { IncomingHttpHeaders } from 'http';
import type { ExtraCompletionRequestDto } from './dto/completion-request.dto';

type RawHeaders =
  | IncomingHttpHeaders
  | Record<string, string | string[] | undefined>;

function firstValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const CORRELATION_ID_HEADER = 'x-vmx-correlation-id';
const METADATA_HEADER_PREFIX = 'x-vmx-metadata-';

/**
 * Parse vmx envelope fields from request headers. Supported today:
 *   - `x-vmx-correlation-id: <value>` → `vmx.correlationId`
 *   - `x-vmx-metadata-<key>: <value>` → `vmx.metadata[<key>]`
 *
 * Useful for clients that can't reach the request body — the canonical
 * shape lives on `body.vmx`, but some SDKs (notably the Claude Agent
 * SDK / Claude Code CLI) own outgoing HTTP entirely and only expose
 * env-controlled headers. This is the fallback path for those.
 *
 * Other envelope fields (`resourceConfigOverrides`, `providerArgs`,
 * `secondaryModelIndex`, `timeoutMs`) stay body-only: they're either
 * too structured for a flat header map (overrides / args) or rarely
 * useful per-call from an env-set SDK.
 *
 * Returns `undefined` when no vmx headers are present.
 */
export function parseVmxHeaders(
  headers: RawHeaders
): Partial<ExtraCompletionRequestDto> | undefined {
  const result: Partial<ExtraCompletionRequestDto> = {};

  const corr = firstValue(headers[CORRELATION_ID_HEADER]);
  if (corr) result.correlationId = corr;

  const metadata: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (!lower.startsWith(METADATA_HEADER_PREFIX)) continue;
    const key = lower.slice(METADATA_HEADER_PREFIX.length);
    const val = firstValue(v);
    if (key && val !== undefined) metadata[key] = val;
  }
  if (Object.keys(metadata).length) result.metadata = metadata;

  return Object.keys(result).length ? result : undefined;
}

/**
 * Merge header-sourced vmx fields with body-sourced vmx fields. The
 * body always wins on key collision — it's the explicit, intentional
 * surface; headers are the implicit, environment-level default. For
 * `metadata`, body and header keys are unioned; on key collision the
 * body's value wins.
 */
export function mergeVmxFromHeaders(
  bodyVmx: ExtraCompletionRequestDto | null | undefined,
  headerVmx: Partial<ExtraCompletionRequestDto> | undefined
): ExtraCompletionRequestDto | null | undefined {
  if (!headerVmx) return bodyVmx;
  const merged: ExtraCompletionRequestDto = {
    ...headerVmx,
    ...(bodyVmx ?? {}),
  };
  const bodyMetadata = bodyVmx?.metadata ?? undefined;
  if (headerVmx.metadata || bodyMetadata) {
    merged.metadata = {
      ...(headerVmx.metadata ?? {}),
      ...(bodyMetadata ?? {}),
    };
  }
  return merged;
}

/**
 * Convenience: read vmx headers off a Fastify-like request and merge
 * them onto a canonical payload's `vmx` field. No-op when neither side
 * has anything to merge.
 */
export function applyVmxHeadersToCanonical<
  T extends { vmx?: ExtraCompletionRequestDto | null }
>(canonical: T, headers: RawHeaders | undefined): T {
  if (!headers) return canonical;
  const headerVmx = parseVmxHeaders(headers);
  if (!headerVmx) return canonical;
  canonical.vmx = mergeVmxFromHeaders(canonical.vmx, headerVmx);
  return canonical;
}
