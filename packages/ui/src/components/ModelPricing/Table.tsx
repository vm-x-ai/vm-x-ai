'use client';

import {
  Delete as DeleteIcon,
  Edit as EditIcon,
  Download as DownloadIcon,
  Upload as UploadIcon,
  ArrowDropDown as ArrowDropDownIcon,
} from '@mui/icons-material';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import Alert from '@mui/material/Alert';
import Backdrop from '@mui/material/Backdrop';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonGroup from '@mui/material/ButtonGroup';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import ClickAwayListener from '@mui/material/ClickAwayListener';
import Grow from '@mui/material/Grow';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import MenuList from '@mui/material/MenuList';
import Paper from '@mui/material/Paper';
import Popper from '@mui/material/Popper';
import { useTheme } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import {
  MaterialReactTable,
  type MRT_ColumnDef,
  useMaterialReactTable,
} from 'material-react-table';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ImportModelPricingResultDto, ModelPricingEntity } from '@/clients/api';
import {
  modelPricingControllerExportAllV1,
  modelPricingControllerImportV1,
} from '@/clients/api/sdk.gen';
import { modelPricingControllerListV1Options } from '@/clients/api/@tanstack/react-query.gen';
import { useMrtTheme } from '@/hooks/use-mrt-theme';
import EmptyState from '@/components/EmptyState/EmptyState';
import AddIcon from '@mui/icons-material/Add';
import ConfirmDeleteModelPricingDialog from './ConfirmDeleteDialog';

/**
 * Format a per-token cost as "$X.XX / 1M" for display. Per-token
 * decimals (e.g. `0.0000025`) are unreadable at a glance — multiplying
 * by 1M and showing 4 decimal places restores the human-friendly
 * "per-million" pricing convention used by every provider doc.
 */
function formatPerMillion(cost: number | null | undefined): string {
  if (cost == null) return '—';
  const perMillion = cost * 1_000_000;
  return `$${perMillion.toFixed(4)} / 1M`;
}

type ExportFormat = 'json' | 'csv';

/**
 * Trigger a browser file download by stuffing `body` into an anchor's
 * `href` blob URL and synthesising a click. Centralised here so both
 * the JSON and CSV export branches share the same flow.
 */
function triggerDownload(filename: string, mime: string, body: string): void {
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on the next tick — Safari needs the URL alive long enough
  // for the synthesised click to consume it.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function ModelPricingTable() {
  const theme = useTheme();
  const { data, isLoading, refetch, error } = useQuery({
    ...modelPricingControllerListV1Options({}),
  });
  const [confirmDeleteItem, setConfirmDeleteItem] = useState<
    ModelPricingEntity | undefined
  >();

  // Export split-button — primary action triggers default format,
  // secondary opens a menu for the other one. Mirrors the
  // `Refresh / Auto-refresh` SplitButton in the Usage header so the
  // two pages share a control idiom.
  const exportAnchorRef = useRef<HTMLDivElement>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('csv');
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportPending, setExportPending] = useState(false);

  const handleExport = async (format: ExportFormat) => {
    setExportError(null);
    setExportPending(true);
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      if (format === 'csv') {
        // `throwOnError: true` makes the hey-api client raise on
        // non-2xx responses. Without it, errors come back on
        // `resp.error` and `resp.data` is undefined — which we'd
        // then trip over downstream with a confusing
        // "Cannot read properties of undefined" stack trace
        // instead of a real error.
        const resp = await modelPricingControllerExportAllV1({
          query: { format: 'csv' },
          throwOnError: true,
        });
        const body =
          typeof resp.data === 'string'
            ? resp.data
            : (resp.data as unknown as string);
        triggerDownload(
          `model-pricing-${stamp}.csv`,
          'text/csv;charset=utf-8',
          body
        );
        return;
      }
      const resp = await modelPricingControllerExportAllV1({
        query: { format: 'json' },
        throwOnError: true,
      });
      triggerDownload(
        `model-pricing-${stamp}.json`,
        'application/json;charset=utf-8',
        JSON.stringify(resp.data, null, 2)
      );
    } catch (e) {
      const message =
        (e as { errorMessage?: string } | undefined)?.errorMessage ??
        (e as Error).message;
      setExportError(message);
      toast.error(`Export failed: ${message}`);
    } finally {
      setExportPending(false);
    }
  };

  // Import: hidden <input type="file"> drives a single Upload button.
  // We read the file as text and dispatch by extension — `.csv` →
  // `text/csv`, anything else → JSON. The server's `Content-Type`
  // sniffing picks the right parser on the other side.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importResult, setImportResult] =
    useState<ImportModelPricingResultDto | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const importMutation = useMutation({
    mutationFn: async (file: File): Promise<ImportModelPricingResultDto> => {
      const text = await file.text();
      const isCsv = /\.csv$/i.test(file.name);
      // For CSV uploads we MUST override the body serializer.
      // hey-api's default `jsonBodySerializer` blindly calls
      // `JSON.stringify(body)`; passing a CSV string then yields
      // `'"...csv..."'` — a quoted JSON string with newlines
      // escaped — which the server's `fromCsv` parses as zero
      // rows ("Import payload is empty"). The identity serializer
      // sends the raw text on the wire.
      const resp = await modelPricingControllerImportV1({
        body: isCsv ? text : (JSON.parse(text) as never),
        bodySerializer: isCsv ? (b) => b as string : undefined,
        headers: isCsv
          ? { 'content-type': 'text/csv' }
          : { 'content-type': 'application/json' },
        throwOnError: true,
      });
      return resp.data;
    },
    onSuccess: async (result) => {
      setImportError(null);
      setImportResult(result);
      // Short transient confirmation that fires as soon as the
      // mutation settles. The persistent alert below the toolbar
      // keeps the per-bucket breakdown around for reference; the
      // toast just acknowledges "the work is done".
      toast.success(
        `Imported ${result.total} pricing row(s) — ${result.created.length} created, ${result.updated.length} updated, ${result.unchanged.length} unchanged.`
      );
      await refetch();
    },
    onError: (e) => {
      setImportResult(null);
      const message =
        (e as { errorMessage?: string } | undefined)?.errorMessage ??
        (e as Error).message;
      setImportError(message);
      toast.error(`Import failed: ${message}`);
    },
  });

  const handleImportPick = (file: File | undefined) => {
    if (!file) return;
    importMutation.mutate(file);
  };

  const columns = useMemo<MRT_ColumnDef<ModelPricingEntity>[]>(
    () => [
      {
        accessorKey: 'provider',
        header: 'Provider',
        size: 160,
        Cell: ({ row }) => (
          <Typography
            variant="inherit"
            sx={{ color: theme.palette.primary.main, fontWeight: 'bold' }}
          >
            {row.original.provider}
          </Typography>
        ),
      },
      {
        accessorKey: 'model',
        header: 'Model',
        size: 220,
      },
      {
        accessorKey: 'source',
        header: 'Source',
        size: 110,
        // Small chip so SYSTEM-vs-USER is glanceable. SYSTEM rows are
        // managed by the pricing sync job; USER rows are operator
        // overrides (created via the UI form or promoted via import).
        Cell: ({ row }) => {
          const isUser = row.original.source === 'USER';
          return (
            <Chip
              label={row.original.source}
              size="small"
              color={isUser ? 'primary' : 'default'}
              variant={isUser ? 'filled' : 'outlined'}
            />
          );
        },
      },
      {
        accessorKey: 'inputCostPerToken',
        header: 'Input',
        size: 140,
        Cell: ({ row }) => (
          <Typography variant="inherit">
            {formatPerMillion(row.original.inputCostPerToken)}
          </Typography>
        ),
      },
      {
        accessorKey: 'outputCostPerToken',
        header: 'Output',
        size: 140,
        Cell: ({ row }) => (
          <Typography variant="inherit">
            {formatPerMillion(row.original.outputCostPerToken)}
          </Typography>
        ),
      },
      {
        accessorKey: 'cachedInputCostPerToken',
        header: 'Cached input',
        size: 160,
        Cell: ({ row }) => (
          <Typography variant="inherit">
            {formatPerMillion(row.original.cachedInputCostPerToken)}
          </Typography>
        ),
      },
      {
        accessorKey: 'reasoningCostPerToken',
        header: 'Reasoning',
        size: 140,
        Cell: ({ row }) => (
          <Typography variant="inherit">
            {formatPerMillion(row.original.reasoningCostPerToken)}
          </Typography>
        ),
      },
      {
        accessorKey: 'updatedAt',
        header: 'Updated',
        size: 200,
        Cell: ({ row }) => (
          <Typography variant="inherit">
            {new Date(row.original.updatedAt).toLocaleString()}
          </Typography>
        ),
      },
    ],
    [theme.palette.primary.main]
  );

  const mrtThemeProps = useMrtTheme();
  const table = useMaterialReactTable({
    columns,
    data: data || [],
    displayColumnDefOptions: { 'mrt-row-actions': { size: 120 } },
    enableFullScreenToggle: false,
    enableExpandAll: false,
    enableRowActions: true,
    enableEditing: false,
    enableColumnResizing: true,
    enableSorting: true,
    enableColumnActions: false,
    // Default-sort by updatedAt DESC so a freshly-created row lands
    // on page 1 — without this, the 281-row seeded list pushes new
    // entries onto a later page (alphabetic order by provider).
    initialState: {
      density: 'compact',
      sorting: [{ id: 'updatedAt', desc: true }],
    },
    ...mrtThemeProps,
    muiTablePaperProps: {
      elevation: 0,
      ...mrtThemeProps.muiTablePaperProps,
    },
    renderRowActions: ({ row }) => (
      <Box sx={{ display: 'flex', gap: '1rem' }}>
        <Tooltip title="Edit">
          <IconButton
            LinkComponent={Link}
            href={`/settings/pricing/edit/${row.original.pricingId}`}
            aria-label={`Edit ${row.original.provider}/${row.original.model}`}
          >
            <EditIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title="Delete">
          <IconButton
            color="error"
            onClick={() => setConfirmDeleteItem(row.original)}
            aria-label={`Delete ${row.original.provider}/${row.original.model}`}
          >
            <DeleteIcon />
          </IconButton>
        </Tooltip>
      </Box>
    ),
    renderTopToolbarCustomActions: () => (
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button
          variant="outlined"
          LinkComponent={Link}
          href="/settings/pricing/new"
          startIcon={<AddIcon />}
        >
          Add new Pricing
        </Button>
        {/* Export split button — primary triggers the currently
            selected format, dropdown swaps between CSV / JSON.
            While the request is in flight we swap the download icon
            for a small spinner so the click registers visually even
            before the file picker shows up. */}
        <ButtonGroup variant="outlined" ref={exportAnchorRef}>
          <Button
            startIcon={
              exportPending ? (
                <CircularProgress size={16} color="inherit" />
              ) : (
                <DownloadIcon />
              )
            }
            onClick={() => handleExport(exportFormat)}
            disabled={exportPending}
          >
            {exportPending
              ? `Exporting ${exportFormat.toUpperCase()}…`
              : `Export ${exportFormat.toUpperCase()}`}
          </Button>
          <Button
            size="small"
            aria-controls={exportMenuOpen ? 'export-format-menu' : undefined}
            aria-expanded={exportMenuOpen ? 'true' : undefined}
            aria-haspopup="menu"
            onClick={() => setExportMenuOpen((open) => !open)}
            disabled={exportPending}
          >
            <ArrowDropDownIcon />
          </Button>
        </ButtonGroup>
        {/* `disablePortal: false` (the default — explicit here for
            clarity) so the menu can escape MRT's toolbar overflow
            clipping. Without it the menu rendered but the second
            item ("Export JSON") got hidden behind the table's right
            edge / scroll container. zIndex bumped above MRT's
            sticky toolbar (~1100). */}
        <Popper
          sx={{ zIndex: 1300 }}
          open={exportMenuOpen}
          anchorEl={exportAnchorRef.current}
          role={undefined}
          transition
          placement="bottom-start"
        >
          {({ TransitionProps, placement }) => (
            <Grow
              {...TransitionProps}
              style={{
                transformOrigin:
                  placement === 'bottom' ? 'center top' : 'center bottom',
              }}
            >
              <Paper>
                <ClickAwayListener
                  onClickAway={(event) => {
                    if (
                      exportAnchorRef.current &&
                      exportAnchorRef.current.contains(
                        event.target as HTMLElement
                      )
                    ) {
                      return;
                    }
                    setExportMenuOpen(false);
                  }}
                >
                  <MenuList id="export-format-menu" autoFocusItem>
                    {(['csv', 'json'] as const).map((opt) => (
                      <MenuItem
                        key={opt}
                        selected={opt === exportFormat}
                        onClick={() => {
                          setExportFormat(opt);
                          setExportMenuOpen(false);
                          handleExport(opt);
                        }}
                      >
                        Export {opt.toUpperCase()}
                      </MenuItem>
                    ))}
                  </MenuList>
                </ClickAwayListener>
              </Paper>
            </Grow>
          )}
        </Popper>
        <Button
          variant="outlined"
          startIcon={
            importMutation.isPending ? (
              <CircularProgress size={16} color="inherit" />
            ) : (
              <UploadIcon />
            )
          }
          onClick={() => fileInputRef.current?.click()}
          disabled={importMutation.isPending}
        >
          {importMutation.isPending ? 'Importing…' : 'Import'}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.json,text/csv,application/json"
          hidden
          // Clear the value on every change so re-selecting the same
          // file fires `onChange` again (otherwise the second pick is
          // a no-op).
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            handleImportPick(file);
          }}
        />
      </Box>
    ),
    state: { isLoading },
  });

  if (!isLoading && (!data || data.length === 0)) {
    return (
      <>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            Failed to fetch pricing entries:{' '}
            {(error as { errorMessage?: string } | undefined)?.errorMessage ??
              error.message}
          </Alert>
        )}
        <EmptyState
          icon={<AttachMoneyIcon />}
          title="No pricing entries yet"
          description="Without pricing entries, every audit row computes a $0 cost. Migration 17 seeds canonical entries for the major providers — if you're seeing this, the seed didn't run or the table was cleared. Add an entry to start tracking spend."
          ctaLabel="Add new Pricing"
          ctaIcon={<AddIcon />}
          ctaHref="/settings/pricing/new"
        />
      </>
    );
  }

  return (
    <>
      {error && (
        <Alert severity="error">
          Failed to fetch pricing entries:{' '}
          {(error as { errorMessage?: string } | undefined)?.errorMessage ??
            error.message}
        </Alert>
      )}
      {exportError && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          onClose={() => setExportError(null)}
        >
          Export failed: {exportError}
        </Alert>
      )}
      {importError && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          onClose={() => setImportError(null)}
        >
          Import failed: {importError}
        </Alert>
      )}
      {importResult && (
        <Alert
          severity="success"
          sx={{ mb: 2 }}
          onClose={() => setImportResult(null)}
        >
          Imported {importResult.total} row(s) — {importResult.created.length}{' '}
          created, {importResult.updated.length} updated,{' '}
          {importResult.unchanged.length} unchanged.
        </Alert>
      )}
      {/* Indeterminate progress bar that sits directly above the
          table while an import is in flight. The shape isn't
          deterministic — the server processes 281 rows in a single
          transaction — so a continuous animation is more honest
          than a fake percentage. */}
      {importMutation.isPending && (
        <LinearProgress
          aria-label="Importing pricing rows"
          sx={{
            mb: 1,
            borderRadius: 1,
            '& .MuiLinearProgress-bar': { transition: 'none' },
          }}
        />
      )}
      {/* Modal-style scrim while import is in flight. Stops the user
          from double-clicking Import (which would queue a second
          mutation while the first is still running) and from
          clicking other table rows mid-write. Contains a spinner +
          caption that mirrors the button state so the action stays
          visible if the toolbar scrolls out of view. */}
      <Backdrop
        open={importMutation.isPending}
        sx={{
          zIndex: (t) => t.zIndex.modal + 1,
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <CircularProgress color="inherit" />
        <Typography variant="body2">Importing pricing rows…</Typography>
      </Backdrop>
      <MaterialReactTable table={table} />
      {confirmDeleteItem && (
        <ConfirmDeleteModelPricingDialog
          pricing={confirmDeleteItem}
          onClose={async () => {
            setConfirmDeleteItem(undefined);
            await refetch();
          }}
        />
      )}
    </>
  );
}
