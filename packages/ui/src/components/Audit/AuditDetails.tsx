'use client';

import { RequestAuditEntity } from '@/clients/api';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import PrettyMessages from './PrettyMessages';
import { EndpointBadge } from './EndpointBadge';
import { useResolvedColorScheme } from '@/hooks/use-resolved-color-scheme';
import { formatLatency } from '@/utils/time';

// react-json-view ships ~30 themes. The default `rjv-default` is a
// light theme — readable on white but unusable on the dark sidebar
// drawer (which is what surfaces these nodes). For dark mode use
// `monokai` — high-contrast cyan / yellow / green / orange on dark,
// which is much more readable than the previous `summerfruit:inverted`
// (whose key labels render as dim gray on near-black). All keys,
// strings, numbers, and booleans get distinct vibrant colors.
const ReactJsonViewer = dynamic(() => import('react-json-view'), {
  ssr: false,
});

type ReactJsonProps = React.ComponentProps<typeof ReactJsonViewer>;

function ReactJson(props: ReactJsonProps) {
  const isDark = useResolvedColorScheme() === 'dark';
  return (
    <ReactJsonViewer
      // `rjv-default` for light, `monokai` for dark — both are
      // part of the bundled theme set.
      theme={isDark ? 'monokai' : 'rjv-default'}
      style={{ backgroundColor: 'transparent' }}
      // The bundled clipboard handler uses `document.execCommand('copy')`
      // (deprecated, removed from spec) and silently no-ops in modern
      // browsers. Override with the modern Clipboard API so the icon
      // actually copies. JSON.stringify with 2-space indent matches what
      // the user sees in the tree.
      enableClipboard={(copy) => {
        const text = (() => {
          try {
            return JSON.stringify(copy.src, null, 2);
          } catch {
            return String(copy.src);
          }
        })();
        if (navigator.clipboard?.writeText) {
          void navigator.clipboard.writeText(text);
        }
      }}
      {...props}
    />
  );
}

export type AuditDetailProps = {
  data: RequestAuditEntity;
};

type ViewMode = 'pretty' | 'json';

export default function AuditDetail({ data }: AuditDetailProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('pretty');

  return (
    <Stack spacing={1.5}>
      {data.errorMessage && (
        <Alert variant="outlined" severity="error">
          {data.errorMessage}
        </Alert>
      )}

      {/* View-mode toggle — Pretty renders chat turns, performance,
          and cost as readable summaries. JSON falls back to the raw
          tree for every section so debugging an unfamiliar shape is
          still possible. */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <ToggleButtonGroup
          value={viewMode}
          exclusive
          size="small"
          color="primary"
          onChange={(_, v) => v && setViewMode(v as ViewMode)}
        >
          <ToggleButton value="pretty">Pretty</ToggleButton>
          <ToggleButton value="json">JSON</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <RequestIdentitySection data={data} mode={viewMode} />
      <EventsSection data={data} mode={viewMode} />
      <CostSection data={data} mode={viewMode} />
      <PerformanceSection data={data} mode={viewMode} />
      <MetadataSection data={data} mode={viewMode} />

      <Section
        title="Request payload (received)"
        caption="The body the client sent to VM-X — same shape as the completion endpoint they hit (Chat Completions, Anthropic Messages, or Responses)."
        defaultExpanded
      >
        {viewMode === 'pretty' ? (
          <PrettyMessages payload={data.requestPayload} kind="request" />
        ) : (
          <ReactJson src={data.requestPayload ?? {}} collapsed={1} />
        )}
      </Section>

      {data.providerRequestPayload != null && (
        <Section
          title="Provider request payload (sent to SDK)"
          caption="The body the provider's SDK saw on the wire — captured pre-flight so it's available even on failed calls. Differs from the received payload when the provider converted the format internally (e.g. Anthropic-shape request routed to Bedrock-Invoke for Claude was forwarded verbatim; OpenAI-shape request routed to Bedrock-Converse was converted to AWS-native)."
        >
          {viewMode === 'pretty' ? (
            <PrettyMessages
              payload={data.providerRequestPayload}
              kind="request"
            />
          ) : (
            <ReactJson
              src={(data.providerRequestPayload as object | null) ?? {}}
              collapsed={1}
            />
          )}
        </Section>
      )}

      <Section title="Response payload" defaultExpanded>
        {viewMode === 'pretty' ? (
          <PrettyMessages payload={data.responseData} kind="response" />
        ) : (
          // `responseData` is typed as an array (or null); fall back
          // to `[]` rather than `{}` so the JSON tree shows the
          // canonical shape for the empty case.
          <ReactJson src={data.responseData ?? []} collapsed={1} />
        )}
      </Section>

      <Section title="Response headers">
        <ReactJson src={data.responseHeaders ?? {}} collapsed={1} />
      </Section>
    </Stack>
  );
}

type SectionProps = {
  title: string;
  caption?: string;
  defaultExpanded?: boolean;
  children: React.ReactNode;
};

function Section({
  title,
  caption,
  defaultExpanded = false,
  children,
}: SectionProps) {
  return (
    <Accordion
      defaultExpanded={defaultExpanded}
      disableGutters
      variant="outlined"
      sx={{ '&:before': { display: 'none' } }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {title}
          </Typography>
          {caption && (
            <Typography variant="caption" color="text.secondary">
              {caption}
            </Typography>
          )}
        </Stack>
      </AccordionSummary>
      <AccordionDetails>{children}</AccordionDetails>
    </Accordion>
  );
}

// ─── Cost & Tokens ───────────────────────────────────────────────────────

type CostBreakdown = {
  total?: number;
  prompt?: number;
  completion?: number;
  cached?: number;
  cacheCreation?: number;
  reasoning?: number;
  currency?: string;
};

function readCostBreakdown(raw: unknown): CostBreakdown | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
  // Canonical persisted shape (`CompletionCostBreakdown` from the API
  // entity) uses `inputCost`/`outputCost`/`cachedCost`/`reasoningCost`
  // /`cacheCreationCost`/`totalCost`/`currency` exclusively. Reading
  // those names directly keeps this in lockstep with the OpenAPI
  // codegen — if the server ever renames a key, the build catches it
  // through the entity type.
  const breakdown: CostBreakdown = {
    total: num(obj.totalCost),
    prompt: num(obj.inputCost),
    completion: num(obj.outputCost),
    cached: num(obj.cachedCost),
    cacheCreation: num(obj.cacheCreationCost),
    reasoning: num(obj.reasoningCost),
    currency:
      typeof obj.currency === 'string' ? (obj.currency as string) : undefined,
  };
  // Drop the section if every numeric slot is empty.
  if (
    breakdown.total === undefined &&
    breakdown.prompt === undefined &&
    breakdown.completion === undefined &&
    breakdown.cached === undefined &&
    breakdown.cacheCreation === undefined &&
    breakdown.reasoning === undefined
  ) {
    return null;
  }
  return breakdown;
}

function formatCost(value: number | undefined, currency = 'USD'): string {
  if (value === undefined) return '—';
  // Costs are typically in low fractions of a cent; show 6 decimals so
  // small per-request charges remain visible.
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

function formatTokens(value: number | undefined | null): string {
  if (value === undefined || value === null) return '—';
  return value.toLocaleString();
}

/**
 * Render a cost line as `<tokens> tokens` with the cost suffix
 * appended only when the gateway computed one. Avoids the awkward
 * trailing `· —` that showed up when the cost field was null.
 * Singular form for token counts of 1 keeps the row grammatical.
 */
function tokenCostRow(
  tokens: number | undefined | null,
  cost: number | undefined,
  currency = 'USD'
): string {
  const tokenLabel =
    tokens === undefined || tokens === null
      ? '— tokens'
      : `${tokens.toLocaleString()} ${tokens === 1 ? 'token' : 'tokens'}`;
  if (cost === undefined) return tokenLabel;
  return `${tokenLabel} · ${formatCost(cost, currency)}`;
}

function CostSection({
  data,
  mode,
}: {
  data: RequestAuditEntity;
  mode: ViewMode;
}) {
  const cost = readCostBreakdown(data.cost);
  const hasTokens =
    data.promptTokens != null ||
    data.outputTokens != null ||
    data.totalTokens != null;

  if (!cost && !hasTokens) return null;

  return (
    <Section
      title="Cost & tokens"
      defaultExpanded
      caption="Per-request breakdown of token usage and gateway-computed cost."
    >
      {mode === 'json' ? (
        <ReactJson
          src={{
            tokens: {
              prompt: data.promptTokens,
              output: data.outputTokens,
              total: data.totalTokens,
              cached: data.cachedTokens,
              cacheCreation: data.cacheCreationInputTokens,
              cacheCreationEphemeral5m: data.cacheCreationEphemeral5mTokens,
              cacheCreationEphemeral1h: data.cacheCreationEphemeral1hTokens,
              reasoning: data.reasoningTokens,
            },
            cost: data.cost ?? null,
          }}
          collapsed={false}
        />
      ) : (
        <Box>
          <KeyValueRow
            label="Total cost"
            value={
              cost?.total === undefined ? (
                // Differentiate "no pricing row configured for this
                // model" from "cost couldn't be computed" so an
                // operator scanning the audit row knows whether to
                // file a missing-pricing ticket or investigate the
                // request itself.
                <Tooltip
                  title={
                    hasTokens
                      ? 'No model pricing entry was found for this provider/model combination — add one in Settings → Model pricing.'
                      : 'Cost cannot be computed because token usage is missing — likely an upstream provider error or unsupported endpoint.'
                  }
                  arrow
                >
                  <Typography
                    variant="h6"
                    sx={{
                      fontWeight: 600,
                      color: 'text.secondary',
                      cursor: 'help',
                      textDecoration: 'underline dotted',
                      textUnderlineOffset: '4px',
                    }}
                  >
                    —
                  </Typography>
                </Tooltip>
              ) : (
                <Typography variant="h6" sx={{ fontWeight: 600 }}>
                  {formatCost(cost.total, cost.currency)}
                </Typography>
              )
            }
          />
          <KeyValueRow
            label="Prompt"
            value={tokenCostRow(
              data.promptTokens,
              cost?.prompt,
              cost?.currency
            )}
          />
          <KeyValueRow
            label="Output"
            value={tokenCostRow(
              data.outputTokens,
              cost?.completion,
              cost?.currency
            )}
          />
          {(data.cachedTokens != null || cost?.cached != null) && (
            <KeyValueRow
              label="Cached input"
              value={tokenCostRow(
                data.cachedTokens,
                cost?.cached,
                cost?.currency
              )}
            />
          )}
          {(data.cacheCreationInputTokens != null ||
            cost?.cacheCreation != null) && (
            <KeyValueRow
              label="Cache creation"
              value={tokenCostRow(
                data.cacheCreationInputTokens,
                cost?.cacheCreation,
                cost?.currency
              )}
            />
          )}
          {(data.reasoningTokens != null || cost?.reasoning != null) && (
            <KeyValueRow
              label="Reasoning"
              value={tokenCostRow(
                data.reasoningTokens,
                cost?.reasoning,
                cost?.currency
              )}
            />
          )}
          <KeyValueRow
            label="Total tokens"
            value={formatTokens(data.totalTokens)}
            faint
          />
        </Box>
      )}
    </Section>
  );
}

// ─── Performance ─────────────────────────────────────────────────────────

function PerformanceSection({
  data,
  mode,
}: {
  data: RequestAuditEntity;
  mode: ViewMode;
}) {
  const hasAny =
    data.duration != null ||
    data.timeToFirstToken != null ||
    data.gateDuration != null ||
    data.routingDuration != null ||
    data.providerDuration != null ||
    data.tokensPerSecond != null;

  if (!hasAny) return null;

  return (
    <Section title="Performance" defaultExpanded>
      {mode === 'json' ? (
        <ReactJson
          src={{
            duration: data.duration,
            timeToFirstToken: data.timeToFirstToken,
            gateDuration: data.gateDuration,
            routingDuration: data.routingDuration,
            providerDuration: data.providerDuration,
            tokensPerSecond: data.tokensPerSecond,
          }}
          collapsed={false}
        />
      ) : (
        <Box>
          <KeyValueRow
            label="Total duration"
            value={
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                {formatLatency(data.duration)}
              </Typography>
            }
          />
          <KeyValueRow
            label="Time to first token"
            value={formatLatency(data.timeToFirstToken)}
          />
          <KeyValueRow
            label="Gate"
            value={formatLatency(data.gateDuration)}
            faint
          />
          <KeyValueRow
            label="Routing"
            value={formatLatency(data.routingDuration)}
            faint
          />
          <KeyValueRow
            label="Provider"
            value={formatLatency(data.providerDuration)}
            faint
          />
          {data.tokensPerSecond != null &&
            Number.isFinite(data.tokensPerSecond) && (
              <KeyValueRow
                label="Tokens / second"
                value={data.tokensPerSecond.toFixed(2)}
              />
            )}
        </Box>
      )}
    </Section>
  );
}

function RequestIdentitySection({
  data,
  mode,
}: {
  data: RequestAuditEntity;
  mode: ViewMode;
}) {
  // The drawer used to start straight at the cost summary, so the
  // operator had no way to see *which* request they were looking at.
  // Surface the timestamp + every identifier the gateway captured so
  // the row is easy to cross-reference with provider-side logs.
  const identityRows: Array<{ label: string; value: React.ReactNode }> = [
    {
      label: 'Timestamp',
      value: data.timestamp
        ? new Date(data.timestamp).toLocaleString(undefined, {
            year: 'numeric',
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
            timeZoneName: 'short',
          })
        : '—',
    },
    // Endpoint badge — colour-coded by inbound wire format so the
    // operator immediately knows which BFF surface the request came
    // through. Pre-migration rows render '—'.
    ...(data.format
      ? [{ label: 'Endpoint', value: <EndpointBadge format={data.format} /> }]
      : []),
    {
      label: 'Stream',
      value:
        (data.requestPayload as { stream?: boolean } | null | undefined)
          ?.stream === true ? (
          <Chip label="Stream" size="small" color="info" variant="outlined" />
        ) : (
          'No'
        ),
    },
    { label: 'Audit ID', value: data.id },
    { label: 'Request ID', value: data.requestId || '—' },
    ...(data.correlationId
      ? [{ label: 'Correlation ID', value: data.correlationId }]
      : []),
    ...(data.messageId
      ? [{ label: 'Provider message ID', value: data.messageId }]
      : []),
    ...(data.batchId ? [{ label: 'Batch ID', value: data.batchId }] : []),
  ];

  return (
    <Section
      title="Request"
      defaultExpanded
      caption="Identifiers + timing for cross-referencing with provider logs and the gateway audit row."
    >
      {mode === 'json' ? (
        <ReactJson
          src={{
            timestamp: data.timestamp,
            id: data.id,
            requestId: data.requestId,
            format: data.format ?? null,
            stream:
              (data.requestPayload as { stream?: boolean } | null | undefined)
                ?.stream === true,
            correlationId: data.correlationId ?? null,
            messageId: data.messageId ?? null,
            batchId: data.batchId ?? null,
          }}
          collapsed={false}
        />
      ) : (
        <Box>
          {identityRows.map((row) => (
            <KeyValueRow
              key={row.label}
              label={row.label}
              value={
                typeof row.value === 'string' ? (
                  <Typography
                    variant="body2"
                    sx={{
                      fontFamily: row.label.endsWith('ID')
                        ? 'monospace'
                        : undefined,
                      wordBreak: 'break-all',
                    }}
                  >
                    {row.value}
                  </Typography>
                ) : (
                  row.value
                )
              }
            />
          ))}
        </Box>
      )}
    </Section>
  );
}

function EventsSection({
  data,
  mode,
}: {
  data: RequestAuditEntity;
  mode: ViewMode;
}) {
  const events = data.events ?? [];
  if (events.length === 0) return null;
  return (
    <Section
      title={`Gateway events (${events.length})`}
      defaultExpanded
      caption="Routing decisions, fallback transitions, and prioritisation gate verdicts the gateway emitted while serving this request."
    >
      {mode === 'json' ? (
        <ReactJson src={events} collapsed={1} />
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {events.map((event, idx) => (
            <PrettyEventRow key={idx} event={event as PrettyEvent} />
          ))}
        </Box>
      )}
    </Section>
  );
}

type ModelRef = {
  provider?: string;
  model?: string;
  connectionId?: string;
};

type RoutingConditionLeaf = {
  type: 'condition';
  id?: string;
  label?: string;
  expression?: string;
  comparator?: string;
  value?: { type?: string; expression?: string };
};

type RoutingConditionNode = RoutingConditionLeaf | RoutingConditionGroup;

type RoutingConditionGroup = {
  type: 'group';
  id?: string;
  description?: string;
  operator?: 'AND' | 'OR';
  conditions?: RoutingConditionNode[];
};

type PrettyEvent = {
  type?: string;
  timestamp?: string;
  // Gateway emits a structured `data` payload per-event (see
  // `RequestAuditFallbackEventData` / `RequestAuditRoutingEventData`
  // on the API side). The previous flat shape (`originalProvider`,
  // `failedModel`, …) was wrong and rendered as `/ → /`.
  data?: {
    // routing
    originalModel?: ModelRef;
    routedModel?: ModelRef;
    matchedRoute?: RoutingConditionGroup;
    // fallback
    model?: ModelRef;
    failureReason?: string;
    statusCode?: number;
    errorMessage?: string;
  };
  [key: string]: unknown;
};

// Map enum values to human-readable comparators. Falls through to the
// raw value (so a future enum addition doesn't render as blank).
const COMPARATOR_LABELS: Record<string, string> = {
  EQUAL: '=',
  NOT_EQUAL: '≠',
  GREATER_THAN: '>',
  GREATER_THAN_OR_EQUAL: '≥',
  LESS_THAN: '<',
  LESS_THAN_OR_EQUAL: '≤',
  CONTAINS: 'contains',
  NOT_CONTAINS: 'does not contain',
  STARTS_WITH: 'starts with',
  ENDS_WITH: 'ends with',
  PATTERN: 'matches',
  IN: 'in',
  NOT_IN: 'not in',
  EXISTS: 'exists',
};

function RoutingConditionTree({ node }: { node?: RoutingConditionNode }) {
  if (!node) return null;
  if (node.type === 'condition') {
    const cmp = node.comparator
      ? COMPARATOR_LABELS[node.comparator] ?? node.comparator
      : '?';
    return (
      <Box
        component="span"
        sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
      >
        <code>{node.expression ?? '?'}</code> {cmp}{' '}
        <code>{node.value?.expression ?? ''}</code>
      </Box>
    );
  }
  // group
  const op = node.operator ?? 'AND';
  const children = node.conditions ?? [];
  if (children.length === 0) {
    return (
      <Typography variant="caption" color="text.secondary">
        (empty group)
      </Typography>
    );
  }
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'baseline',
        flexWrap: 'wrap',
        gap: 0.5,
      }}
    >
      {children.map((child, i) => (
        <Box
          key={i}
          component="span"
          sx={{ display: 'inline-flex', alignItems: 'baseline', gap: 0.5 }}
        >
          {i > 0 && (
            <Typography
              variant="caption"
              sx={{ fontWeight: 600, color: 'text.secondary' }}
            >
              {op}
            </Typography>
          )}
          <RoutingConditionTree node={child} />
        </Box>
      ))}
    </Box>
  );
}

function PrettyEventRow({ event }: { event: PrettyEvent }) {
  const type = (event.type as string) ?? 'event';
  const ts = event.timestamp
    ? new Date(event.timestamp).toLocaleString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3,
        hour12: false,
      })
    : '';
  const data = event.data ?? {};
  const fmtModel = (m?: ModelRef) =>
    m ? `${m.provider ?? '?'} / ${m.model ?? '?'}` : '—';
  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        p: 1.5,
        bgcolor: 'var(--mui-palette-action-hover)',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          mb: 0.5,
        }}
      >
        <Typography variant="subtitle2" sx={{ textTransform: 'capitalize' }}>
          {type}
          {data.matchedRoute?.description
            ? ` — ${data.matchedRoute.description}`
            : ''}
        </Typography>
        {ts && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontFamily: 'monospace' }}
          >
            {ts}
          </Typography>
        )}
      </Box>
      {type === 'routing' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Typography variant="body2">
            <code>{fmtModel(data.originalModel)}</code> →{' '}
            <code>{fmtModel(data.routedModel)}</code>
          </Typography>
          {data.matchedRoute?.conditions &&
            data.matchedRoute.conditions.length > 0 && (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'baseline',
                  flexWrap: 'wrap',
                  gap: 0.5,
                  mt: 0.5,
                }}
              >
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ flexShrink: 0 }}
                >
                  matched when:
                </Typography>
                <RoutingConditionTree node={data.matchedRoute} />
              </Box>
            )}
        </Box>
      )}
      {type === 'fallback' && (
        <Typography variant="body2">
          <code>{fmtModel(data.model)}</code> failed
          {data.statusCode != null && ` (HTTP ${data.statusCode})`} —{' '}
          {data.failureReason || data.errorMessage || 'no reason reported'}
        </Typography>
      )}
      {type !== 'routing' && type !== 'fallback' && (
        <ReactJson src={event} collapsed={false} />
      )}
    </Box>
  );
}

function MetadataSection({
  data,
  mode,
}: {
  data: RequestAuditEntity;
  mode: ViewMode;
}) {
  const entries = data.metadata
    ? Object.entries(data.metadata).filter(([, v]) => v != null)
    : [];

  if (entries.length === 0) return null;

  return (
    <Section
      title={`Metadata (${entries.length})`}
      defaultExpanded
      caption="Caller-supplied tags from `vmx.metadata`. Same shape used by the metadata-filter and group-by selectors."
    >
      {mode === 'json' ? (
        <ReactJson src={data.metadata ?? {}} collapsed={false} />
      ) : (
        <Box>
          {entries.map(([key, value]) => (
            <KeyValueRow key={key} label={key} value={String(value)} />
          ))}
        </Box>
      )}
    </Section>
  );
}

// ─── Generic K/V row ─────────────────────────────────────────────────────

function KeyValueRow({
  label,
  value,
  faint,
}: {
  label: string;
  value: React.ReactNode;
  faint?: boolean;
}) {
  return (
    <Box
      sx={{
        display: 'flex',
        // Stack label and value on narrow viewports so a long token
        // breakdown like "1,234,567 tokens · $0.012345" doesn't get
        // squeezed into illegibility on the audit drawer when it's
        // pulled from the side at mobile widths.
        flexDirection: { xs: 'column', sm: 'row' },
        justifyContent: 'space-between',
        alignItems: { xs: 'flex-start', sm: 'baseline' },
        gap: { xs: 0.25, sm: 0 },
        py: 0.75,
        borderBottom: '1px solid var(--mui-palette-divider)',
        '&:last-of-type': { borderBottom: 'none' },
      }}
    >
      <Typography
        variant="body2"
        color={faint ? 'text.secondary' : 'text.primary'}
      >
        {label}
      </Typography>
      <Typography
        variant="body2"
        component="div"
        sx={{
          textAlign: { xs: 'left', sm: 'right' },
          fontVariantNumeric: 'tabular-nums',
        }}
        color={faint ? 'text.secondary' : 'text.primary'}
      >
        {value}
      </Typography>
    </Box>
  );
}
