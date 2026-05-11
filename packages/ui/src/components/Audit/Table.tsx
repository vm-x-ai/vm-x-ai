'use client';

import AddIcon from '@mui/icons-material/Add';
import MinusIcon from '@mui/icons-material/Remove';
import CloseIcon from '@mui/icons-material/Close';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import MUILink from '@mui/material/Link';
import { useTheme } from '@mui/material/styles';
import { useMrtTheme } from '@/hooks/use-mrt-theme';
import Typography from '@mui/material/Typography';
import type { Updater } from '@tanstack/react-query';
import type {
  MRT_VisibilityState,
  MRT_PaginationState,
  MRT_GroupingState,
} from 'material-react-table';
import {
  MaterialReactTable,
  type MRT_ColumnDef,
  useMaterialReactTable,
} from 'material-react-table';
import ProviderLogo from '@/components/Providers/ProviderLogo';
import Link from 'next/link';
import { useQueryState, parseAsInteger, parseAsString } from 'nuqs';
import { useEffect, useMemo, useState } from 'react';
import AuditDetail from './AuditDetails';
import AuditHeader from './Header';
import {
  AiConnectionEntity,
  AiProviderDto,
  AiResourceEntity,
  ApiKeyEntity,
  RequestAuditEntity,
  ListAuditResponseDto,
} from '@/clients/api';
import { getReasonPhrase } from 'http-status-codes';
import { formatCurrency } from '@/utils/number';

type CostBreakdown = {
  inputCost?: number | null;
  outputCost?: number | null;
  cachedCost?: number | null;
  reasoningCost?: number | null;
  totalCost?: number | null;
  currency?: string | null;
};

export type AuditTableProps = {
  workspaceId?: string;
  environmentId?: string;
  data?: ListAuditResponseDto;
  loading?: boolean;
  resourcesMap?: Record<string, AiResourceEntity>;
  aiConnectionMap?: Record<string, AiConnectionEntity>;
  providersMap?: Record<string, AiProviderDto>;
  apiKeysMap?: Record<string, ApiKeyEntity>;
  /** Distinct metadata keys for filter/group-by selectors */
  metadataKeys?: string[];
};

export default function AuditTable({
  loading = false,
  workspaceId,
  environmentId,
  data,
  resourcesMap,
  aiConnectionMap,
  providersMap,
  apiKeysMap,
  metadataKeys = [],
}: AuditTableProps) {
  const [pageSize, setPageSize] = useQueryState(
    'pageSize',
    parseAsInteger.withDefault(100).withOptions({
      history: 'push',
      shallow: false,
    })
  );
  const [pageIndex, setPageIndex] = useQueryState(
    'pageIndex',
    parseAsInteger.withDefault(0).withOptions({
      history: 'push',
      shallow: false,
    })
  );
  // Comma-separated list of column ids to group by (matches the
  // multi-select Autocomplete in `Audit/Header`). The legacy
  // single-string shape is handled implicitly: a URL like
  // `?groupBy=correlationId` parses to `['correlationId']`.
  const [groupBy] = useQueryState(
    'groupBy',
    parseAsString.withDefault('').withOptions({
      history: 'push',
      shallow: false,
    })
  );
  const groupByList = useMemo<string[]>(
    () =>
      groupBy
        ? groupBy
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
    [groupBy]
  );
  const [showProgressBars, setShowProgressBar] = useState<boolean>(false);
  // Selected audit row → renders inside the right-side detail drawer.
  // Drawer was previously an inline `renderDetailPanel` that pushed
  // every row down on expand; the side drawer keeps the table visible.
  const [selectedRow, setSelectedRow] = useState<RequestAuditEntity | null>(
    null
  );

  // Deep-link target from the playground: when the page loads with
  // `?requestId=<id>` and the server filtered down to that single
  // row, auto-open its drawer so the user lands directly on the
  // audit detail view.
  //
  // We DO NOT use `requestIdFilter` itself as the open/close signal —
  // doing that re-opened the drawer immediately every time the user
  // hit close, since the URL param was still present. Instead, we
  // remember which request id has already auto-opened in this mount
  // and only fire once per id; closing the drawer also clears the
  // URL param (via nuqs) so a future visit with the same id behaves
  // the same way.
  const [requestIdFilter, setRequestIdFilter] = useQueryState(
    'requestId',
    parseAsString.withOptions({ history: 'push', shallow: false })
  );
  const [autoOpenedFor, setAutoOpenedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!requestIdFilter) return;
    if (autoOpenedFor === requestIdFilter) return;
    const match = data?.data?.find((row) => row.requestId === requestIdFilter);
    if (match) {
      setSelectedRow(match);
      setAutoOpenedFor(requestIdFilter);
    }
  }, [requestIdFilter, data?.data, autoOpenedFor]);
  const closeDrawer = () => {
    setSelectedRow(null);
    // Drop the deep-link from the URL so the auto-open effect
    // doesn't fight the user on the next render.
    if (requestIdFilter) setRequestIdFilter(null);
  };

  const theme = useTheme();
  const mrtThemeProps = useMrtTheme();
  const [columnVisibility, setColumnVisibility] = useState<MRT_VisibilityState>(
    {
      'mrt-row-expand': true,
      'mrt-row-select': false,
    }
  );

  const [pagination, setPagination] = useState<MRT_PaginationState>({
    pageIndex,
    pageSize,
  });

  const handleSetPagination = (
    updater: Updater<MRT_PaginationState, MRT_PaginationState>
  ) => {
    const newValue =
      typeof updater === 'function' ? updater(pagination) : updater;

    setPageIndex(newValue.pageIndex);
    setPagination(newValue);
    setShowProgressBar(true);
  };

  useEffect(() => {
    setPageSize(pagination.pageSize);
  }, [pagination.pageSize, setPageSize]);

  useEffect(() => {
    setShowProgressBar(false);
  }, [data]);

  // For every `metadata.<key>` group-by entry, synthesize a virtual
  // column pulling that key out of the audit row's `metadata` JSON so
  // MRT can group on it. `correlationId` already has its own column.
  // Now multi-field aware: the user can stack `metadata.tenant_id` +
  // `metadata.user_id` + `correlationId` and MRT nests groups.
  const metadataGroupKeys = useMemo<string[]>(
    () =>
      groupByList
        .filter((g) => g.startsWith('metadata.'))
        .map((g) => g.slice('metadata.'.length)),
    [groupByList]
  );

  const columns = useMemo<MRT_ColumnDef<RequestAuditEntity>[]>(
    () => [
      ...metadataGroupKeys.map(
        (key) =>
          ({
            id: `metadata.${key}`,
            header: `metadata.${key}`,
            accessorFn: (row: RequestAuditEntity) =>
              row.metadata?.[key] ?? '(empty)',
            enableGrouping: true,
            size: 200,
          } as MRT_ColumnDef<RequestAuditEntity>)
      ),
      {
        accessorKey: 'timestamp',
        header: 'Timestamp',
        size: 200,
        Cell: ({ row }) => {
          // Server stores UTC ISO strings; rendering raw `…Z` text is
          // unreadable for ops who think in their own zone. Format
          // with the browser's locale so the column matches the
          // rest of the app's audit-detail / event panes (which
          // already call `toLocaleString`).
          const raw =
            row.original.timestamp?.split('|')?.[0] ?? row.original.timestamp;
          const parsed = raw ? new Date(raw) : null;
          const display =
            parsed && !Number.isNaN(parsed.getTime())
              ? parsed.toLocaleString(undefined, {
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                  hour12: false,
                })
              : raw ?? '—';
          return (
            <Typography
              variant="inherit"
              sx={{
                color: theme.palette.primary.main,
                fontWeight: 'bold',
              }}
            >
              {display}
            </Typography>
          );
        },
      },
      {
        accessorKey: 'correlationId',
        header: 'Correlation ID',
      },
      {
        header: 'Routed To',
        size: 300,
        Cell: ({ row: { original: row } }) =>
          (() => {
            if (!row.connectionId || !providersMap || !aiConnectionMap) {
              return <Chip label="Unknown" />;
            }
            // Defensive: a provider can be missing from the map if the
            // connection's provider was deprecated, and the connection
            // itself can be missing if it's been deleted while audit
            // rows for it remain. Render `(Unknown)` placeholders rather
            // than letting `?.name` collapse into the literal string
            // `"undefined - <model>"` in the chip label.
            const conn = aiConnectionMap[row.connectionId];
            const provider = conn ? providersMap[conn.provider] : undefined;
            const providerName = provider?.name ?? 'Unknown';
            const modelLabel = row.model ?? 'Unknown';
            const label = conn
              ? `${providerName} - ${modelLabel}`
              : `${row.connectionId} (Deleted) - ${modelLabel}`;
            return (
              <Chip
                key={row.connectionId}
                label={label}
                icon={
                  <Box>
                    <ProviderLogo
                      alt={providerName}
                      logo={provider?.config.logo}
                      height={20}
                      width={20}
                    />
                  </Box>
                }
              />
            );
          })(),
      },
      {
        accessorKey: 'duration',
        header: 'Duration (ms)',
      },
      {
        id: 'cost.totalCost',
        header: 'Cost',
        size: 120,
        // The API exposes `cost` as `Record<string, unknown>` in the OpenAPI
        // schema (the entity uses `type: 'object', additionalProperties: true`
        // for the JSONB column). Read-side we know the shape — narrow it here.
        accessorFn: (row) =>
          (row.cost as CostBreakdown | null | undefined)?.totalCost ?? null,
        Cell: ({ row: { original: row } }) => {
          const cost = row.cost as CostBreakdown | null | undefined;
          const total = cost?.totalCost;
          if (total === null || total === undefined) {
            return <Typography variant="body2">-</Typography>;
          }
          const breakdown = [
            cost?.inputCost != null
              ? `in ${formatCurrency(cost.inputCost)}`
              : null,
            cost?.outputCost != null
              ? `out ${formatCurrency(cost.outputCost)}`
              : null,
            cost?.cachedCost
              ? `cached ${formatCurrency(cost.cachedCost)}`
              : null,
            cost?.reasoningCost
              ? `reasoning ${formatCurrency(cost.reasoningCost)}`
              : null,
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <Box>
              <Typography
                variant="body2"
                sx={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {formatCurrency(total)}
              </Typography>
              {breakdown && (
                <Typography
                  variant="caption"
                  sx={{
                    color: 'text.secondary',
                  }}
                >
                  {breakdown}
                </Typography>
              )}
            </Box>
          );
        },
      },
      {
        accessorKey: 'sourceIp',
        header: 'Source IP',
      },
      {
        accessorKey: 'resourceId',
        header: 'Resource',
        Cell: ({ row: { original: row } }) =>
          row.resourceId && resourcesMap?.[row.resourceId] ? (
            <MUILink
              component={Link}
              href={`/workspaces/${workspaceId}/${environmentId}/ai-resources/edit/${row.resourceId}/general`}
              variant="body2"
            >
              {resourcesMap?.[row.resourceId]?.name ?? row.resourceId}
            </MUILink>
          ) : (
            <Typography variant="body2">
              {row.resourceId ? `${row.resourceId} (Deleted)` : '-'}
            </Typography>
          ),
      },
      {
        accessorKey: 'statusCode',
        header: 'Status Code',
        size: 300,
        Cell: ({ row: { original: row } }) => {
          if (row.statusCode == null) {
            return <Chip size="small" label="—" />;
          }
          // `getReasonPhrase` throws on unknown codes; guard so a row
          // with e.g. `0` (client aborted before any response) doesn't
          // crash the entire table render.
          let phrase: string;
          try {
            phrase = getReasonPhrase(row.statusCode);
          } catch {
            phrase = '';
          }
          return (
            <Chip
              key={row.statusCode}
              size="small"
              color={row.statusCode > 399 ? 'error' : 'success'}
              label={
                phrase ? `${row.statusCode} ${phrase}` : `${row.statusCode}`
              }
            />
          );
        },
      },
      {
        header: 'Role',
        Cell: ({ row: { original: row } }) =>
          row.apiKeyId ? (
            <Box
              sx={{
                display: 'flex',
                gap: theme.spacing(1),
              }}
            >
              <MUILink
                component={Link}
                href={`/workspaces/${workspaceId}/${environmentId}/security/auth/role/edit/${row.apiKeyId}/general`}
                variant="body2"
              >
                {apiKeysMap?.[row.apiKeyId]?.name}
              </MUILink>
            </Box>
          ) : (
            '-'
          ),
      },
      {
        header: 'Role Groups',
        Cell: ({ row: { original: row } }) =>
          row.apiKeyId ? (
            <Box
              sx={{
                display: 'flex',
                gap: theme.spacing(1),
              }}
            >
              {apiKeysMap?.[row.apiKeyId]?.labels?.map((label) => (
                <Chip key={label} size="small" color="primary" label={label} />
              ))}
            </Box>
          ) : (
            '-'
          ),
      },
      {
        accessorKey: 'failureReason',
        header: 'Failure Reason',
      },
    ],
    [
      aiConnectionMap,
      apiKeysMap,
      environmentId,
      metadataGroupKeys,
      providersMap,
      resourcesMap,
      theme,
      workspaceId,
    ]
  );

  // Map UI groupBy values to MRT column ids: `correlationId` is the
  // existing accessorKey; `metadata.<key>` is one of the synthetic
  // virtual columns above. Group order matches the URL list, so MRT
  // nests groups in the order the user picked them.
  const grouping = useMemo<MRT_GroupingState>(() => groupByList, [groupByList]);

  const table = useMaterialReactTable({
    columns,
    data: data?.data || [],
    enableFullScreenToggle: false,
    enableExpandAll: groupByList.length > 0,
    enableRowActions: false,
    enableEditing: false,
    enableColumnResizing: false,
    enableSorting: false,
    enableColumnActions: false,
    enableFilters: false,
    enableStickyFooter: true,
    enableGrouping: true,
    ...mrtThemeProps,
    muiTablePaperProps: {
      elevation: 0,
      ...mrtThemeProps.muiTablePaperProps,
    },
    state: {
      isLoading: loading,
      columnVisibility,
      pagination,
      showProgressBars,
      grouping,
    },
    muiExpandButtonProps: ({ row }) => ({
      children: row.getIsExpanded() ? <MinusIcon /> : <AddIcon />,
    }),
    onPaginationChange: handleSetPagination,
    onColumnVisibilityChange: setColumnVisibility,
    renderTopToolbar: () => (
      <Box
        sx={{
          paddingTop: theme.spacing(2),
        }}
      >
        <AuditHeader
          workspaceId={workspaceId}
          environmentId={environmentId}
          providersMap={providersMap}
          resourcesMap={resourcesMap}
          aiConnectionMap={aiConnectionMap}
          metadataKeys={metadataKeys}
        />
      </Box>
    ),
    // Row click opens a side drawer with the full audit detail. The
    // previous inline detail-panel pushed every other row down on
    // expand, which made comparing rows hard. A right-side drawer
    // keeps the table visible while you inspect the payload.
    muiTableBodyRowProps: ({ row }) => ({
      onClick: () => setSelectedRow(row.original),
      sx: { cursor: 'pointer' },
    }),
    rowCount: data?.total ?? 0,
    manualPagination: true,
    muiTableContainerProps: { sx: { maxHeight: 'calc(100vh - 26rem)' } },
    muiPaginationProps: {
      rowsPerPageOptions: [5, 10, 20, 50, 100, 200, 500],
    },
  });

  return (
    <>
      <MaterialReactTable table={table} />
      <Drawer
        anchor="right"
        open={!!selectedRow}
        onClose={closeDrawer}
        // Push the temporary drawer (Modal + Backdrop + paper) above
        // every other chrome surface so the dimming overlay covers
        // the AppBar AND the persistent sidebar Drawer uniformly.
        // The app's `<AppBar>` is mounted at `theme.zIndex.drawer + 1`
        // (see `Layout.tsx`); the persistent sidebar Drawer sits at
        // `theme.zIndex.drawer`. Both must be beneath the modal root,
        // so use `theme.zIndex.modal` (1300 by default) — that's the
        // token MUI reserves for exactly this case.
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
          <IconButton aria-label="close" onClick={closeDrawer}>
            <CloseIcon />
          </IconButton>
        </Box>
        <Box sx={{ p: 3, overflow: 'auto' }}>
          {selectedRow && <AuditDetail data={selectedRow} />}
        </Box>
      </Drawer>
    </>
  );
}
