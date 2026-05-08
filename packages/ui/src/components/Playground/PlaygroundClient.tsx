'use client';

import {
  AiConnectionEntity,
  AiProviderDto,
  AiResourceEntity,
} from '@/clients/api';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Drawer from '@mui/material/Drawer';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormGroup from '@mui/material/FormGroup';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import DeleteIcon from '@mui/icons-material/Delete';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import Chat, { type ChatEndpointMode } from '@/components/Chat/Chat';
import AuditDetail from '@/components/Audit/AuditDetails';
import Editor from '@/components/Editor';
import AppContainer from '@/components/Layout/Container';
import { getRequestAuditOptions } from '@/clients/api/@tanstack/react-query.gen';

export type PlaygroundClientProps = {
  workspaceId: string;
  environmentId: string;
  resources: AiResourceEntity[];
  connections: AiConnectionEntity[];
  providersMap: Record<string, AiProviderDto>;
  initialResourceId?: string;
};

type Mode = 'resource' | 'connection-model';

/**
 * Playground page shell.
 *
 * Two modes:
 *
 *   • **Use AI Resource** — pick from the workspace's existing resources.
 *     Empty workspace shows an empty state with a Create CTA. Otherwise
 *     pre-selects the first resource alphabetically.
 *
 *   • **Use Connection / Model** — type `<connection_name>/<model_name>`
 *     directly. The gateway recognizes the slash-prefixed model string
 *     and builds an ephemeral resource on the fly (see
 *     `completion.service.ts > getAIResource`). Useful when you want to
 *     test a connection's model without first wrapping it in a Resource.
 *
 * The chat surface itself is the existing `<Chat>` component, which
 * already supports streaming, web-search, and (after Phase 3) attachments.
 */
export default function PlaygroundClient({
  workspaceId,
  environmentId,
  resources,
  connections,
  providersMap,
  initialResourceId,
}: PlaygroundClientProps) {
  const sortedResources = useMemo(
    () =>
      [...resources].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
    [resources]
  );

  const initialFromQuery = initialResourceId
    ? sortedResources.find((r) => r.resourceId === initialResourceId) ?? null
    : null;

  const [mode, setMode] = useState<Mode>('resource');
  const [selectedResource, setSelectedResource] =
    useState<AiResourceEntity | null>(
      initialFromQuery ?? sortedResources[0] ?? null
    );
  const [connectionName, setConnectionName] = useState<string>('');
  const [modelName, setModelName] = useState<string>('');
  const [endpointMode, setEndpointMode] =
    useState<ChatEndpointMode>('chat-completions');
  const [stream, setStream] = useState<boolean>(true);
  const [webSearch, setWebSearch] = useState<boolean>(false);
  // Active request id for the in-page audit drawer. Set when the
  // user clicks "view audit details" on a bot reply; cleared when
  // they close the drawer. Null = drawer hidden.
  const [auditRequestId, setAuditRequestId] = useState<string | null>(null);

  // Caller-side gateway envelope inputs. All optional; the chat send
  // path forwards them into `vmx.{correlationId,metadata,
  // resourceConfigOverrides}` when set so the audit + usage pages
  // have something interesting to render.
  const [correlationId, setCorrelationId] = useState<string>('');
  const [metadataPairs, setMetadataPairs] = useState<
    Array<{ key: string; value: string }>
  >([]);
  const [overrideJson, setOverrideJson] = useState<string>('');
  const [overrideJsonError, setOverrideJsonError] = useState<string | null>(
    null
  );

  const { data: session } = useSession();
  const playgroundUserId = session?.user?.userId;

  const metadata = useMemo<Record<string, string>>(() => {
    // Always tag every playground send so audit/usage filters can
    // separate playground traffic from real workload — useful when
    // an exec asks "are these spend numbers real or just my testing
    // from yesterday?". User-specified pairs win on key collision so
    // a caller can still override e.g. `user_id` from the panel.
    const out: Record<string, string> = { playground: 'true' };
    if (playgroundUserId) out.user_id = playgroundUserId;
    for (const { key, value } of metadataPairs) {
      const k = key.trim();
      if (!k) continue;
      out[k] = value;
    }
    return out;
  }, [metadataPairs, playgroundUserId]);

  const extraResourceOverrides = useMemo<
    Partial<AiResourceEntity> | undefined
  >(() => {
    const trimmed = overrideJson.trim();
    if (!trimmed) {
      if (overrideJsonError) setOverrideJsonError(null);
      return undefined;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (
        parsed === null ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
      ) {
        setOverrideJsonError('Override must be a JSON object.');
        return undefined;
      }
      if (overrideJsonError) setOverrideJsonError(null);
      return parsed as Partial<AiResourceEntity>;
    } catch (err) {
      setOverrideJsonError(err instanceof Error ? err.message : 'Invalid JSON');
      return undefined;
    }
    // overrideJsonError intentionally omitted — including it would
    // re-run the parse on every error-state flip and create a render loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrideJson]);

  // Audit-row lookup for the in-page drawer. The audit service
  // buffers writes for up to 10 s before flushing to Postgres, so a
  // user clicking "view audit details" right after a reply can hit
  // an empty result on the first try. `refetchInterval` polls every
  // 2 s while the row is missing; once it lands, the query stays
  // cached until the drawer closes (clears `auditRequestId`).
  const auditQuery = useQuery({
    ...getRequestAuditOptions({
      path: { workspaceId, environmentId },
      query: { requestId: auditRequestId ?? undefined, pageSize: 1 },
    }),
    enabled: !!auditRequestId,
    refetchInterval: (query) =>
      query.state.data?.data?.length ? false : 2_000,
    staleTime: 0,
  });
  const auditRow = auditQuery.data?.data?.[0] ?? null;

  // Build the resource we hand to <Chat>. In `connection-model` mode we
  // synthesize an ephemeral resource whose `name` is `<conn>/<model>`,
  // matching the slash-syntax the gateway parses on its way to building
  // an ephemeral resource server-side.
  const effectiveResource: AiResourceEntity | null = useMemo(() => {
    if (mode === 'resource') return selectedResource;
    if (!connectionName || !modelName) return null;
    // Look up the connection so the synthetic resource's `model`
    // carries the right provider/connectionId for chip rendering in
    // ChatPanel. The gateway re-resolves the connection by name on
    // its side anyway (`getAIResource > getByName`), so the
    // synthetic fields are display-only — empty strings are safe
    // when the user typed a name we don't recognise locally.
    const conn = connections.find((c) => c.name === connectionName);
    // Double-cast is unavoidable: `AiResourceEntity` requires audit
    // fields (`createdAt`, `updatedAt`, `createdBy`, `updatedBy`) that
    // an ephemeral, never-persisted resource has no meaningful value
    // for. The Chat / ChatPanel components only read the fields we
    // populate above; nothing accesses the audit fields client-side.
    return {
      resourceId: 'ephemeral',
      workspaceId,
      environmentId,
      name: `${connectionName}/${modelName}`,
      description: null,
      model: {
        provider: conn?.provider ?? '',
        model: modelName,
        connectionId: conn?.connectionId ?? '',
      },
      fallbackModels: [],
      secondaryModels: [],
      routing: null,
      capacity: [],
      useFallback: false,
      enforceCapacity: false,
    } as unknown as AiResourceEntity;
  }, [
    mode,
    selectedResource,
    connectionName,
    modelName,
    connections,
    workspaceId,
    environmentId,
  ]);

  // Empty state: no resources AND user is on the resource tab. Surface
  // a helpful CTA instead of a dead picker.
  if (mode === 'resource' && sortedResources.length === 0) {
    return (
      <AppContainer sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <PlaygroundHeader
          mode={mode}
          onModeChange={setMode}
          endpointMode={endpointMode}
          onEndpointModeChange={setEndpointMode}
          stream={stream}
          onStreamChange={setStream}
          webSearch={webSearch}
          onWebSearchChange={setWebSearch}
        />
        <Paper
          sx={{
            p: 6,
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
          }}
        >
          <SmartToyIcon sx={{ fontSize: 64, color: 'primary.main' }} />
          <Typography variant="h6">No AI Resources yet</Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ maxWidth: 480 }}
          >
            Resources wrap a connection + model with routing, fallback, and
            capacity rules. Create one to start chatting from the playground —
            or switch to <strong>Connection / Model</strong> mode above to talk
            to a connection directly.
          </Typography>
          <Button
            component={Link}
            href={`/workspaces/${workspaceId}/${environmentId}/ai-resources/new`}
            variant="contained"
            startIcon={<AddIcon />}
          >
            Create AI Resource
          </Button>
        </Paper>
      </AppContainer>
    );
  }

  const resourcePicker =
    mode === 'resource' ? (
      <Autocomplete<AiResourceEntity>
        sx={{ minWidth: 240 }}
        size="small"
        options={sortedResources}
        value={selectedResource}
        onChange={(_, value) => setSelectedResource(value)}
        getOptionLabel={(o) => o.name ?? ''}
        isOptionEqualToValue={(a, b) => a.resourceId === b.resourceId}
        renderInput={(params) => <TextField {...params} label="AI Resource" />}
      />
    ) : null;

  return (
    <AppContainer sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <PlaygroundHeader
        mode={mode}
        onModeChange={setMode}
        endpointMode={endpointMode}
        onEndpointModeChange={setEndpointMode}
        stream={stream}
        onStreamChange={setStream}
        webSearch={webSearch}
        onWebSearchChange={setWebSearch}
        resourcePicker={resourcePicker}
      />
      {mode === 'connection-model' && (
        <Paper
          variant="outlined"
          sx={{ p: 2, display: 'flex', gap: 2, flexWrap: 'wrap' }}
        >
          <Autocomplete<string, false, false, true>
            sx={{ minWidth: 240 }}
            options={connections.map((c) => c.name)}
            value={connectionName || null}
            onChange={(_, value) =>
              setConnectionName(typeof value === 'string' ? value : '')
            }
            freeSolo
            onInputChange={(_, value) => setConnectionName(value)}
            renderInput={(params) => (
              <TextField {...params} label="Connection name" size="small" />
            )}
          />
          <TextField
            size="small"
            sx={{ minWidth: 240 }}
            label="Model"
            placeholder="e.g. gpt-4o-mini"
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            helperText="Sent verbatim to the connection's provider."
          />
        </Paper>
      )}
      {/*
        Two-column body: chat area on the left fills the remaining
        width, vmx envelope sits as a fixed-width side panel on the
        right. Stacks vertically on narrow viewports so the envelope
        controls stay reachable.
      */}
      <Box
        sx={{
          display: 'flex',
          gap: 2,
          flexDirection: { xs: 'column', md: 'row' },
          alignItems: 'stretch',
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {!effectiveResource ? (
            <Alert severity="info">
              {mode === 'resource'
                ? 'Pick a resource above to start chatting.'
                : 'Enter a connection name and model to start chatting.'}
            </Alert>
          ) : (
            <Chat
              // Stable key per "logical conversation": when the user
              // switches resources we want a clean conversation, but
              // in connection-model mode the synthetic resource's
              // `name` (`<conn>/<model>`) changes on every keystroke.
              // Keying on the mode + resourceId keeps the Chat hook
              // (and its `useChat` state, attachments, draft input)
              // mounted while the user types.
              key={
                mode === 'resource'
                  ? selectedResource?.resourceId ?? 'no-resource'
                  : 'connection-model-ephemeral'
              }
              resource={effectiveResource}
              providersMap={providersMap}
              workspaceId={workspaceId}
              environmentId={environmentId}
              endpointMode={endpointMode}
              stream={stream}
              webSearch={webSearch}
              height="calc(100vh - 18rem)"
              padding={0}
              correlationId={correlationId.trim() || undefined}
              metadata={metadata}
              extraResourceOverrides={extraResourceOverrides}
              onOpenAudit={(requestId) => setAuditRequestId(requestId)}
            />
          )}
        </Box>
        <Box
          sx={{
            width: { xs: '100%', md: 360 },
            flexShrink: 0,
          }}
        >
          <GatewayEnvelopePanel
            correlationId={correlationId}
            onCorrelationIdChange={setCorrelationId}
            metadataPairs={metadataPairs}
            onMetadataPairsChange={setMetadataPairs}
            overrideJson={overrideJson}
            onOverrideJsonChange={setOverrideJson}
            overrideJsonError={overrideJsonError}
          />
        </Box>
      </Box>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: 'block', mt: 1 }}
      >
        <strong>About the compatibility endpoints:</strong> the toggle picks the{' '}
        <em>request shape</em> the gateway accepts — the gateway then converts
        to the resource&apos;s configured upstream provider regardless of which
        shape you chose. Use the OpenAI shapes from any OpenAI-compatible SDK
        (LiteLLM, Vercel AI SDK, etc.); use the Anthropic shape from{' '}
        <code>@anthropic-ai/sdk</code>. When the request shape and the
        resource&apos;s provider already match (e.g. an Anthropic resource via
        Anthropic Messages), the gateway forwards the body verbatim with no
        shape conversion.
      </Typography>
      {/*
        In-page audit-detail drawer. Same component the Audit page
        renders inside its own drawer — the playground reuses it so
        users can inspect a reply (cost, headers, events, full
        response payload) without leaving the chat. While the audit
        service is still buffering the row, the drawer shows a
        spinner with a hint about the ~10s flush cadence.
      */}
      <Drawer
        anchor="right"
        open={!!auditRequestId}
        onClose={() => setAuditRequestId(null)}
        slotProps={{
          root: {
            sx: (theme) => ({ zIndex: theme.zIndex.modal }),
          },
          paper: { sx: { width: { xs: '100%', md: '60vw' }, maxWidth: 960 } },
        }}
      >
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            px: 3,
            py: 2,
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Typography variant="h6">Request audit detail</Typography>
          <IconButton
            aria-label="close"
            onClick={() => setAuditRequestId(null)}
          >
            <CloseIcon />
          </IconButton>
        </Box>
        <Box sx={{ p: 3, overflow: 'auto' }}>
          {auditRow ? (
            <AuditDetail data={auditRow} />
          ) : (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                py: 6,
              }}
            >
              <CircularProgress size={28} />
              <Typography variant="body2" color="text.secondary">
                Waiting for the audit row to flush…
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ textAlign: 'center', maxWidth: 360 }}
              >
                The gateway buffers audit writes for up to 10 seconds before
                committing them. The drawer will populate as soon as the row
                lands.
              </Typography>
            </Box>
          )}
        </Box>
      </Drawer>
    </AppContainer>
  );
}

type GatewayEnvelopePanelProps = {
  correlationId: string;
  onCorrelationIdChange: (value: string) => void;
  metadataPairs: Array<{ key: string; value: string }>;
  onMetadataPairsChange: (pairs: Array<{ key: string; value: string }>) => void;
  overrideJson: string;
  onOverrideJsonChange: (value: string) => void;
  overrideJsonError: string | null;
};

function GatewayEnvelopePanel({
  correlationId,
  onCorrelationIdChange,
  metadataPairs,
  onMetadataPairsChange,
  overrideJson,
  onOverrideJsonChange,
  overrideJsonError,
}: GatewayEnvelopePanelProps) {
  const updatePair = (
    index: number,
    patch: Partial<{ key: string; value: string }>
  ) => {
    const next = metadataPairs.map((p, i) =>
      i === index ? { ...p, ...patch } : p
    );
    onMetadataPairsChange(next);
  };
  return (
    <Paper
      variant="outlined"
      // Side-panel layout: full container height + internal scroll so a
      // long override JSON / many metadata pairs don't push the chat
      // off-screen.
      sx={{
        p: 2,
        height: '100%',
        maxHeight: 'calc(100vh - 18rem)',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Box sx={{ mb: 2 }}>
        <Typography variant="subtitle2">vmx envelope</Typography>
        <Typography variant="caption" color="text.secondary">
          correlationId / metadata / per-request resource overrides
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Box>
          <TextField
            fullWidth
            size="small"
            label="Correlation ID"
            placeholder="Optional caller-supplied request ID (e.g. trace-abc123)"
            value={correlationId}
            onChange={(e) => onCorrelationIdChange(e.target.value)}
            helperText="Forwarded as `vmx.correlationId`. Surfaces on the audit row, metrics, and `x-vmx-correlation-id` response header."
          />
        </Box>

        <Box>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              mb: 1,
            }}
          >
            <Typography variant="subtitle2">Metadata</Typography>
            <Button
              size="small"
              startIcon={<AddIcon />}
              onClick={() =>
                onMetadataPairsChange([
                  ...metadataPairs,
                  { key: '', value: '' },
                ])
              }
            >
              Add pair
            </Button>
          </Box>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ mb: 1, display: 'block' }}
          >
            Forwarded as <code>vmx.metadata</code>. Keys land on the audit row,
            time-series metrics, and the
            <code>x-vmx-metadata-&lt;key&gt;</code> response header.
          </Typography>
          {metadataPairs.length === 0 ? (
            <Typography variant="caption" color="text.secondary">
              No metadata. Click <strong>Add pair</strong> to attach key / value
              tags to this request.
            </Typography>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {metadataPairs.map((pair, index) => (
                <Box
                  key={index}
                  sx={{
                    display: 'flex',
                    gap: 1,
                    alignItems: 'center',
                  }}
                >
                  <TextField
                    size="small"
                    label="Key"
                    value={pair.key}
                    onChange={(e) => updatePair(index, { key: e.target.value })}
                    sx={{ minWidth: 200 }}
                  />
                  <TextField
                    size="small"
                    label="Value"
                    value={pair.value}
                    onChange={(e) =>
                      updatePair(index, { value: e.target.value })
                    }
                    fullWidth
                  />
                  <IconButton
                    aria-label="remove pair"
                    size="small"
                    onClick={() =>
                      onMetadataPairsChange(
                        metadataPairs.filter((_, i) => i !== index)
                      )
                    }
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              ))}
            </Box>
          )}
        </Box>

        <Box>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            Resource config overrides (JSON)
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ mb: 1, display: 'block' }}
          >
            Shallow-merged into <code>vmx.resourceConfigOverrides</code> on top
            of the picked resource. Use this to swap the model, tighten retries
            / timeouts, or layer extra <code>defaultArgs</code> for just this
            request. Example:{' '}
            <code>
              {`{"model":{"provider":"anthropic","connectionId":"...","model":"claude-haiku-4-5-20251001"}}`}
            </code>
          </Typography>
          <Box
            sx={{
              height: 180,
              border: '1px solid',
              borderColor: overrideJsonError ? 'error.main' : 'divider',
              borderRadius: 1,
              overflow: 'hidden',
            }}
          >
            <Editor
              language="json"
              value={overrideJson}
              onChange={(value) => onOverrideJsonChange(value)}
              options={{
                minimap: { enabled: false },
                lineNumbers: 'off',
                scrollBeyondLastLine: false,
                fontSize: 13,
                tabSize: 2,
              }}
            />
          </Box>
          {overrideJsonError && (
            <Typography variant="caption" color="error">
              {overrideJsonError}
            </Typography>
          )}
        </Box>
      </Box>
    </Paper>
  );
}

function PlaygroundHeader(props: {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  endpointMode: ChatEndpointMode;
  onEndpointModeChange: (mode: ChatEndpointMode) => void;
  stream: boolean;
  onStreamChange: (stream: boolean) => void;
  webSearch: boolean;
  onWebSearchChange: (webSearch: boolean) => void;
  /**
   * Optional element rendered after the toggle/switch row — used by
   * the playground to drop the AI Resource picker right next to the
   * web-search switch when in resource mode, so the toolbar stays a
   * single line on common viewport widths.
   */
  resourcePicker?: React.ReactNode;
}) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        display: 'flex',
        gap: 2,
        flexWrap: 'wrap',
        alignItems: 'center',
      }}
    >
      <ToggleButtonGroup
        size="small"
        exclusive
        value={props.mode}
        onChange={(_, value: Mode | null) => {
          if (value) props.onModeChange(value);
        }}
        aria-label="model source"
      >
        <ToggleButton value="resource" aria-label="use ai resource">
          Use AI Resource
        </ToggleButton>
        <ToggleButton
          value="connection-model"
          aria-label="use connection model"
        >
          Use Connection / Model
        </ToggleButton>
      </ToggleButtonGroup>
      <ToggleButtonGroup
        size="small"
        exclusive
        value={props.endpointMode}
        onChange={(_, value: ChatEndpointMode | null) => {
          if (value) props.onEndpointModeChange(value);
        }}
        aria-label="endpoint mode"
      >
        <ToggleButton
          value="chat-completions"
          aria-label="openai chat completions"
        >
          OpenAI &mdash; Chat Completions
        </ToggleButton>
        <ToggleButton value="responses" aria-label="openai responses">
          OpenAI &mdash; Responses
        </ToggleButton>
        <ToggleButton value="anthropic" aria-label="anthropic messages">
          Anthropic &mdash; Messages
        </ToggleButton>
      </ToggleButtonGroup>
      <FormGroup>
        <FormControlLabel
          control={
            <Switch
              checked={props.stream}
              onChange={(event) => props.onStreamChange(event.target.checked)}
              // Streaming over the Responses-API and Anthropic paths
              // is non-trivial today (Anthropic SSE event-shape mapping
              // is Phase 11B); the playground hooks for both modes are
              // single-shot non-streaming, so disable the toggle so the
              // UI accurately reflects what the call will do.
              disabled={
                props.endpointMode === 'responses' ||
                props.endpointMode === 'anthropic'
              }
            />
          }
          label="Streaming"
        />
      </FormGroup>
      <FormGroup>
        <FormControlLabel
          control={
            <Switch
              checked={props.webSearch}
              onChange={(event) =>
                props.onWebSearchChange(event.target.checked)
              }
            />
          }
          label="Web search"
        />
      </FormGroup>
      {props.resourcePicker}
    </Paper>
  );
}
