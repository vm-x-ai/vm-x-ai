import Chip from '@mui/material/Chip';
import type { RequestAuditEntity } from '@/clients/api';

/**
 * Colour-coded pill rendering the inbound wire format the request
 * landed on. Shared between the audit table column and the audit
 * drawer so a row's badge looks identical in both places.
 *
 * Colour rationale (matches the broader app palette):
 * - `primary` for Chat Completions (the default surface).
 * - `secondary` for Responses (the canonical Phase 11 surface).
 * - `warning` for Anthropic Messages (visually distinct from the
 *   OpenAI-family pills; warning, not error, because it's not a
 *   problem state — just a different surface).
 */
export function EndpointBadge({
  format,
}: {
  format: NonNullable<RequestAuditEntity['format']>;
}) {
  const config: Record<
    NonNullable<RequestAuditEntity['format']>,
    { label: string; color: 'primary' | 'secondary' | 'warning' | 'default' }
  > = {
    'chat-completions': { label: 'Chat Completions', color: 'primary' },
    responses: { label: 'Responses', color: 'secondary' },
    anthropic: { label: 'Anthropic Messages', color: 'warning' },
  };
  const entry = config[format] ?? { label: format, color: 'default' as const };
  return <Chip label={entry.label} size="small" color={entry.color} />;
}
