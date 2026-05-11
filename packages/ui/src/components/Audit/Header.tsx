'use client';

import {
  CalendarMonth,
  Cancel as CancelIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { DateRangeEditor } from '@/components/DateRangePicker';
import QuickRangeChips from '@/components/DateRangePicker/QuickRangeChips';
import MetadataValueMultiAutocomplete from '@/components/Metadata/MetadataValueMultiAutocomplete';
import { subDays } from 'date-fns';
import ProviderLogo from '@/components/Providers/ProviderLogo';
import { useRouter } from 'next/navigation';
import {
  parseAsString,
  parseAsIsoDateTime,
  useQueryState,
  parseAsInteger,
  parseAsJson,
} from 'nuqs';
import React, { useMemo, useState, useTransition } from 'react';
import type {
  DateRangePickerValue,
  RelativeValueUnit,
} from '../DateRangePicker/types';
import {
  AiConnectionEntity,
  AiProviderDto,
  AiResourceEntity,
} from '@/clients/api';

export type AuditHeaderProps = {
  workspaceId?: string;
  environmentId?: string;
  resourcesMap?: Record<string, AiResourceEntity>;
  aiConnectionMap?: Record<string, AiConnectionEntity>;
  providersMap?: Record<string, AiProviderDto>;
  /**
   * Distinct metadata keys observed on recent audit rows. Sourced from the
   * /metadata-keys endpoint and used to populate the metadata-filter and
   * group-by selectors.
   */
  metadataKeys?: string[];
};

export default function AuditHeader({
  workspaceId,
  environmentId,
  resourcesMap,
  aiConnectionMap,
  providersMap,
  metadataKeys = [],
}: AuditHeaderProps) {
  // Manual data refresh: re-runs the server component that owns the
  // audit page and re-fetches the audit + filter-source data. The
  // table is server-rendered (no client-side query cache), so
  // `router.refresh()` is the canonical Next.js way to invalidate
  // it. `useTransition` keeps the spinner pinned to *this* refresh
  // — the new request is pending until the server payload returns.
  const router = useRouter();
  const [isRefreshing, startRefreshTransition] = useTransition();
  const handleRefresh = () => {
    startRefreshTransition(() => {
      router.refresh();
    });
  };

  const [dateType, setDateType] = useQueryState(
    'dateType',
    parseAsString.withDefault('relative').withOptions({
      history: 'push',
      shallow: false,
    })
  );

  const [relativeValue, setRelativeValue] = useQueryState(
    'relativeValue',
    parseAsInteger.withDefault(7).withOptions({
      history: 'push',
      shallow: false,
    })
  );

  const [relativeUnit, setRelativeUnit] = useQueryState(
    'relativeUnit',
    parseAsString.withDefault('day').withOptions({
      history: 'push',
      shallow: false,
    })
  );

  const [startDate, setStartDate] = useQueryState(
    'start',
    parseAsIsoDateTime.withDefault(subDays(new Date(), 7)).withOptions({
      history: 'push',
      shallow: false,
    })
  );
  const [endDate, setEndDate] = useQueryState(
    'end',
    parseAsIsoDateTime.withDefault(new Date()).withOptions({
      history: 'push',
      shallow: false,
    })
  );

  // Derived (not state): the date editor mirrors the URL params, so
  // `useState` would freeze the editor at mount-time and miss URL
  // changes coming from sibling controls (e.g. `<QuickRangeChips>`
  // flipping `relativeValue`). A `useMemo` keyed on the nuqs values
  // re-renders the editor whenever the URL changes from anywhere.
  const datePickerValue = useMemo<DateRangePickerValue>(
    () => ({
      type: dateType as 'relative' | 'absolute',
      relative: {
        unit: relativeUnit as RelativeValueUnit,
        value: relativeValue,
      },
      absolute: {
        endDate,
        startDate,
      },
    }),
    [dateType, relativeUnit, relativeValue, startDate, endDate]
  );

  const [connectionId, setConnectionId] = useQueryState(
    'connectionId',
    parseAsString.withOptions({
      history: 'push',
      shallow: false,
    })
  );

  const [resourceId, setResourceId] = useQueryState(
    'resourceId',
    parseAsString.withOptions({
      history: 'push',
      shallow: false,
    })
  );

  const [statusCode, setStatusCode] = useQueryState(
    'statusCode',
    parseAsInteger.withOptions({
      history: 'push',
      shallow: false,
    })
  );

  // Multi-pair metadata filters. Stored as a JSON object in the URL —
  // matches the API's `metadataFilters` query param contract. Each
  // value is a `string[]`; a single value still goes through `IN
  // (...)` server-side. Mirrors the Usage page so both pages share
  // the same `<MetadataValueMultiAutocomplete>`.
  //   {"team":["growth"], "env":["prod","staging"]}  → AND across keys, IN within
  //
  // Legacy single-string shape (`{team:"growth"}`) coerces to
  // `[value]` so old URLs still work.
  const [metadataFilters, setMetadataFilters] = useQueryState(
    'metadataFilters',
    parseAsJson<Record<string, string[]>>((value) => {
      const coerce = (raw: unknown): Record<string, string[]> => {
        if (!raw || typeof raw !== 'object') return {};
        const out: Record<string, string[]> = {};
        for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
          if (typeof v === 'string' && v) out[k] = [v];
          else if (Array.isArray(v)) {
            const filtered = v.filter(
              (entry): entry is string =>
                typeof entry === 'string' && entry.length > 0
            );
            if (filtered.length > 0) out[k] = filtered;
          }
        }
        return out;
      };
      if (typeof value === 'string') {
        try {
          return coerce(JSON.parse(value));
        } catch {
          return {};
        }
      }
      return coerce(value);
    })
      .withDefault({})
      .withOptions({
        history: 'push',
        shallow: false,
      })
  );

  // Local UI state — which key the value-input is currently bound to.
  // Doesn't persist to the URL; only the resolved key/value pairs do.
  const [selectedMetadataKey, setSelectedMetadataKey] = useState<string | null>(
    null
  );
  // Decoupled input text for the metadata-key Autocomplete so the
  // visible input can be cleared after a commit while
  // `selectedMetadataKey` stays populated for the value picker
  // beside it. Mirrors the Usage header so both pages drive the
  // same picker the same way.
  const [metadataKeyInput, setMetadataKeyInput] = useState('');

  const activeFilterEntries = Object.entries(metadataFilters ?? {});

  const setMetadataFilterValues = (key: string, values: string[]) => {
    if (!key) return;
    const next = { ...(metadataFilters ?? {}) };
    if (values.length === 0) delete next[key];
    else next[key] = values;
    setMetadataFilters(Object.keys(next).length === 0 ? {} : next);
  };

  // Multi-field group-by — stored in the URL as a comma-separated
  // list of column ids (e.g. `groupBy=metadata.tenant_id,correlationId`).
  // Backwards-compatible with the legacy single-string shape: an old
  // `groupBy=correlationId` URL parses to `['correlationId']`.
  const [groupBy, setGroupBy] = useQueryState(
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
  const setGroupByList = (next: string[]) => {
    setGroupBy(next.join(','));
  };

  // Group-by options: correlationId is always present, plus every observed
  // metadata key as `metadata.<key>`.
  const groupByOptions = [
    'correlationId',
    ...metadataKeys.map((k) => `metadata.${k}`),
  ];

  // The DateRangeEditor's `onChange` writes directly to the nuqs
  // setters now (see below), so the URL is the single source of
  // truth — no separate effect needed to sync editor state → URL.
  const handleDateChange = (next: DateRangePickerValue) => {
    if (next.absolute && next.absolute.startDate && next.absolute.endDate) {
      setStartDate(next.absolute.startDate);
      setEndDate(next.absolute.endDate);
    }
    if (next.relative) {
      setRelativeUnit(next.relative.unit);
      setRelativeValue(next.relative.value);
    }
    setDateType(next.type);
  };

  // Mirror Usage page's section-label style so both insight pages
  // share the same visual structure.
  const renderSectionLabel = (label: string) => (
    <Typography
      variant="overline"
      color="text.secondary"
      sx={{ letterSpacing: '0.08em', fontWeight: 600, lineHeight: 1.2 }}
    >
      {label}
    </Typography>
  );

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2.5,
      }}
    >
      {/* ── Period ──────────────────────────────────────────────
          Time range + manual refresh. */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {renderSectionLabel('Period')}
        <Box
          sx={{
            display: 'flex',
            gap: '1rem',
            flexWrap: 'wrap',
            alignItems: 'flex-start',
          }}
        >
          <QuickRangeChips fallbackUnit="day" />
          {/* Compact icon-button form so the refresh action sits inline
            with the filter row without breaking its wrap behaviour
            when the viewport narrows. Tooltip carries the verb that
            the icon alone wouldn't communicate. */}
          <Tooltip title={isRefreshing ? 'Refreshing…' : 'Refresh audit data'}>
            <Box component="span" sx={{ display: 'inline-flex' }}>
              <IconButton
                onClick={handleRefresh}
                disabled={isRefreshing}
                size="small"
                aria-label="Refresh audit data"
                sx={{
                  alignSelf: 'center',
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1,
                  height: 36,
                  width: 36,
                }}
              >
                {isRefreshing ? (
                  <CircularProgress size={16} />
                ) : (
                  <RefreshIcon fontSize="small" />
                )}
              </IconButton>
            </Box>
          </Tooltip>
          <DateRangeEditor
            value={datePickerValue}
            onChange={handleDateChange}
            renderRelativeInput={(inputProps) => (
              <Grid size={12}>
                <TextField
                  {...inputProps}
                  size="small"
                  label="Date Range"
                  sx={{ width: '23rem' }}
                />
              </Grid>
            )}
            renderAbsoluteInput={(startProps, endProps) => (
              <React.Fragment>
                <Grid size={12}>
                  <TextField
                    value={`${startProps.value} - ${endProps.value}`}
                    onClick={startProps.onClick}
                    label="Date Range"
                    size="small"
                    slotProps={{
                      input: {
                        endAdornment: (
                          <InputAdornment position="end">
                            <IconButton
                              aria-label="calendar"
                              onClick={() => {
                                if (startProps.onClick) {
                                  startProps.onClick(null as never);
                                }
                              }}
                              edge="end"
                            >
                              <CalendarMonth />
                            </IconButton>
                          </InputAdornment>
                        ),
                      },
                    }}
                    sx={{ width: '30rem' }}
                  />
                </Grid>
              </React.Fragment>
            )}
            cloneOnSelection={false}
          />
        </Box>
      </Box>
      {/* ── Filters ─────────────────────────────────────────────
          Scope-narrowing predicates: resource, connection, status
          code, and free-form metadata key/value chips. Two-row
          layout keeps the dropdowns readable on narrow viewports. */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {renderSectionLabel('Filters')}
        <Box
          sx={{
            display: 'flex',
            gap: '1rem',
            flexWrap: 'wrap',
            alignItems: 'flex-start',
          }}
        >
          {resourcesMap && (
            <Autocomplete
              disablePortal
              value={resourceId}
              options={Object.keys(resourcesMap)}
              getOptionLabel={(option) => resourcesMap[option]?.name ?? option}
              onChange={(_, newValue) => {
                setResourceId(newValue);
              }}
              size="small"
              sx={{
                width: '20rem',
              }}
              renderInput={(params) => (
                <TextField {...params} label="AI Resource" />
              )}
            />
          )}
          {providersMap && aiConnectionMap && (
            <Autocomplete
              disablePortal
              value={connectionId}
              options={Object.keys(aiConnectionMap)}
              getOptionLabel={(option) =>
                aiConnectionMap[option]?.name ?? 'Unknown'
              }
              onChange={(_, newValue) => {
                setConnectionId(newValue);
              }}
              size="small"
              sx={{
                width: '20rem',
              }}
              renderOption={(props, option) => {
                const { key, ...optionProps } = props;
                return (
                  <Box
                    key={key}
                    component="li"
                    sx={{ '& > img': { mr: 2, flexShrink: 0 } }}
                    {...optionProps}
                  >
                    <ProviderLogo
                      alt={providersMap[aiConnectionMap[option].provider]?.name}
                      logo={
                        providersMap[aiConnectionMap[option].provider]?.config
                          ?.logo
                      }
                      height={18}
                      width={18}
                    />
                    {aiConnectionMap[option]?.name}
                  </Box>
                );
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="AI Connection"
                  slotProps={{
                    ...params.slotProps,

                    ...(connectionId
                      ? {
                          input: {
                            ...params.slotProps.input,
                            startAdornment: (
                              <InputAdornment position="start">
                                <ProviderLogo
                                  alt={
                                    providersMap[
                                      aiConnectionMap[connectionId].provider
                                    ].name
                                  }
                                  logo={
                                    providersMap[
                                      aiConnectionMap[connectionId].provider
                                    ]?.config.logo
                                  }
                                  height={20}
                                  width={25}
                                  style={{
                                    marginLeft: '.2rem',
                                    marginTop: '.2rem',
                                  }}
                                />
                              </InputAdornment>
                            ),
                          },
                        }
                      : {}),
                  }}
                />
              )}
            />
          )}
          <Autocomplete
            disablePortal
            value={statusCode}
            options={[200, 400, 401, 429, 500]}
            onChange={(_, newValue) => {
              setStatusCode(newValue);
            }}
            size="small"
            sx={{
              width: '20rem',
            }}
            renderInput={(params) => (
              <TextField {...params} label="Status Code" />
            )}
          />
          {/* Metadata key picker. `value={null}` so MUI never renders the
          picked key inside the input — once committed, it lives only
          in `selectedMetadataKey` and the value picker beside it
          targets it. The input clears after each pick so the user
          can tab onto the next key without manual clearing. Mirrors
          the Usage header's pattern. */}
          <Autocomplete
            disablePortal
            freeSolo
            size="small"
            sx={{ width: '15rem' }}
            options={metadataKeys}
            value={null}
            inputValue={metadataKeyInput}
            onInputChange={(_, newInputValue, reason) => {
              if (reason === 'reset') {
                setMetadataKeyInput('');
              } else {
                setMetadataKeyInput(newInputValue);
              }
            }}
            onChange={(_, newValue) => {
              const next = (newValue ?? '').toString().trim();
              if (next) {
                setSelectedMetadataKey(next);
                setMetadataKeyInput('');
              }
            }}
            renderInput={(params) => (
              <TextField {...params} label="Filter By Metadata" />
            )}
          />
          {selectedMetadataKey && (
            <MetadataValueMultiAutocomplete
              workspaceId={workspaceId}
              environmentId={environmentId}
              metadataKey={selectedMetadataKey}
              values={(metadataFilters ?? {})[selectedMetadataKey] ?? []}
              onChange={(values) =>
                setMetadataFilterValues(selectedMetadataKey, values)
              }
            />
          )}
        </Box>
      </Box>
      {/* ── Group ───────────────────────────────────────────────
          Multi-select metadata-keys that the table groups its
          rows on. Stays in its own section for parity with the
          Usage page. */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {renderSectionLabel('Group')}
        <Box
          sx={{
            display: 'flex',
            gap: '1rem',
            flexWrap: 'wrap',
            alignItems: 'flex-start',
          }}
        >
          <Autocomplete
            multiple
            disablePortal
            value={groupByList}
            options={groupByOptions}
            onChange={(_, newValue) => {
              setGroupByList(newValue);
            }}
            size="small"
            sx={{ minWidth: '20rem' }}
            renderInput={(params) => <TextField {...params} label="Group By" />}
          />
        </Box>
      </Box>
      {/* Active metadata filters — MUI Chips on their own row, matching
          the Usage page so both surfaces share the same chip-builder UX. */}
      {activeFilterEntries.length > 0 && (
        <Box
          sx={{
            display: 'flex',
            gap: 1,
            alignItems: 'center',
            flexWrap: 'wrap',
            mt: 0.5,
          }}
        >
          {activeFilterEntries.flatMap(([k, vs]) => {
            const onRemove = (v: string) => () => {
              const next =
                (metadataFilters ?? {})[k]?.filter((entry) => entry !== v) ??
                [];
              setMetadataFilterValues(k, next);
              // If the user just cleared the last value for the
              // currently-selected key, drop the multi-input too so
              // the row collapses cleanly.
              if (next.length === 0 && selectedMetadataKey === k) {
                setSelectedMetadataKey(null);
              }
            };
            return (vs as string[]).map((v) => (
              <Chip
                key={`${k}=${v}`}
                label={`${k} = ${v}`}
                onDelete={onRemove(v)}
                deleteIcon={
                  <IconButton
                    size="small"
                    aria-label={`Remove metadata filter ${k}=${v}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(v)();
                    }}
                  >
                    <CancelIcon fontSize="small" />
                  </IconButton>
                }
                variant="outlined"
                color="primary"
              />
            ));
          })}
        </Box>
      )}
    </Box>
  );
}
