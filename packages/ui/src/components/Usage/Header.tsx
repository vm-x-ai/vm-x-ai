'use client';

import { CalendarMonth, Cancel as CancelIcon } from '@mui/icons-material';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonGroup from '@mui/material/ButtonGroup';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import ClickAwayListener from '@mui/material/ClickAwayListener';
import Grid from '@mui/material/Grid';
import Grow from '@mui/material/Grow';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import MenuList from '@mui/material/MenuList';
import Paper from '@mui/material/Paper';
import Popper from '@mui/material/Popper';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { DateRangeEditor } from '@/components/DateRangePicker';
import QuickRangeChips from '@/components/DateRangePicker/QuickRangeChips';
import { endOfMonth, startOfMonth } from 'date-fns';
import { useRouter } from 'next/navigation';
import {
  parseAsString,
  parseAsStringEnum,
  parseAsIsoDateTime,
  useQueryState,
  parseAsInteger,
  parseAsJson,
} from 'nuqs';
import React, { useEffect, useRef, useState } from 'react';
import type {
  DateRangePickerValue,
  RelativeValueUnit,
} from '../DateRangePicker/types';
import { ApiResponse } from '@/clients/types';
import { ApiKeyEntity, GranularityUnit } from '@/clients/api';
import MetadataValueMultiAutocomplete from '@/components/Metadata/MetadataValueMultiAutocomplete';

type RefreshOption = {
  label: string;
  value: number;
};

const refreshOptions: RefreshOption[] = [
  {
    label: 'Refresh',
    value: -1,
  },
  {
    label: 'Auto Refresh (5s)',
    value: 5000,
  },
  {
    label: 'Auto Refresh (10s)',
    value: 10000,
  },
];

type GranularityOption = { value: GranularityUnit; label: string };

const GRANULARITY_OPTIONS: GranularityOption[] = [
  { value: GranularityUnit.SECOND, label: '1s' },
  { value: GranularityUnit.SECOND_5, label: '5s' },
  { value: GranularityUnit.SECOND_10, label: '10s' },
  { value: GranularityUnit.SECOND_15, label: '15s' },
  { value: GranularityUnit.SECOND_30, label: '30s' },
  { value: GranularityUnit.MINUTE, label: '1m' },
  { value: GranularityUnit.HOUR, label: '1h' },
  { value: GranularityUnit.DAY, label: '1d' },
  { value: GranularityUnit.WEEK, label: '1w' },
  { value: GranularityUnit.MONTH, label: '1mo' },
  { value: GranularityUnit.YEAR, label: '1y' },
];

export type UsageHeaderProps = {
  workspaceId?: string;
  environmentId?: string;
  apiKeys: ApiResponse<ApiKeyEntity[]>;
  /**
   * Distinct metadata keys observed on recent audit rows (last 30 days).
   * Used to populate the metadata-filter and metadata-group-by selectors.
   * Source: GET /request-audit/.../metadata-keys.
   */
  metadataKeys?: string[];
};

export default function UsageHeader({
  workspaceId,
  environmentId,
  apiKeys,
  metadataKeys = [],
}: UsageHeaderProps) {
  const router = useRouter();
  const [openRefreshButton, setOpenRefreshButton] = useState(false);
  const refreshButtonAnchorRef = useRef<HTMLDivElement>(null);
  const [autoRefresh, setAutoRefresh] = useQueryState(
    'autoRefresh',
    parseAsInteger.withDefault(-1).withOptions({
      history: 'push',
      shallow: false,
    })
  );

  const handleRefreshClick = () => {
    router.refresh();
  };

  const handleRefreshMenuItemClick = (
    _: React.MouseEvent<HTMLLIElement, MouseEvent>,
    option: RefreshOption
  ) => {
    setAutoRefresh(option.value);
    setOpenRefreshButton(false);
  };

  // Parse granularity against the codegen `GranularityUnit` enum so a
  // garbage URL value (e.g. `?granularity=second_2`) falls back to
  // the default instead of round-tripping a typo to the API.
  const [granularity, setGranularity] = useQueryState(
    'granularity',
    parseAsStringEnum<GranularityUnit>(Object.values(GranularityUnit))
      .withDefault(GranularityUnit.MINUTE)
      .withOptions({
        history: 'push',
        shallow: false,
      })
  );

  const [dateType, setDateType] = useQueryState(
    'dateType',
    parseAsString.withDefault('relative').withOptions({
      history: 'push',
      shallow: false,
    })
  );

  const [relativeValue, setRelativeValue] = useQueryState(
    'relativeValue',
    parseAsInteger.withDefault(30).withOptions({
      history: 'push',
      shallow: false,
    })
  );

  const [relativeUnit, setRelativeUnit] = useQueryState(
    'relativeUnit',
    parseAsString.withDefault('minute').withOptions({
      history: 'push',
      shallow: false,
    })
  );

  const [startDate, setStartDate] = useQueryState(
    'start',
    parseAsIsoDateTime.withDefault(startOfMonth(new Date())).withOptions({
      history: 'push',
      shallow: false,
    })
  );
  const [endDate, setEndDate] = useQueryState(
    'end',
    parseAsIsoDateTime.withDefault(endOfMonth(new Date())).withOptions({
      history: 'push',
      shallow: false,
    })
  );

  const [datePickerValue, setDatePickerValue] = useState<DateRangePickerValue>({
    type: dateType as 'relative' | 'absolute',
    relative: {
      unit: relativeUnit as RelativeValueUnit,
      value: relativeValue,
    },
    absolute: {
      endDate,
      startDate,
    },
  });

  const [filters, setFilters] = useQueryState(
    'filters',
    parseAsJson<Record<string, string[]>>((value) => {
      if (typeof value === 'string') {
        return JSON.parse(value);
      }
      return value;
    })
      .withDefault({})
      .withOptions({
        history: 'push',
        shallow: false,
      })
  );

  // Metadata filter UI state — local-only, applied to URL filters when the
  // user types/selects values. The URL filter shape is:
  //   { "metadata.<key>": ["value1", "value2"], ... }
  // matching the backend's RequestUsageQueryDto.filter.fields contract.
  const [selectedMetadataKey, setSelectedMetadataKey] = useState<string | null>(
    null
  );
  // Decoupled input text for the metadata-key Autocomplete so we can clear
  // the visible input after a commit while keeping `selectedMetadataKey`
  // populated (the value picker below depends on it).
  const [metadataKeyInput, setMetadataKeyInput] = useState('');

  // Currently-active metadata filter entries (key + values), derived from the
  // URL `filters` state.
  const activeMetadataFilters = Object.entries(filters ?? {})
    .filter(([k, v]) => k.startsWith('metadata.') && Array.isArray(v))
    .map(([k, v]) => ({ key: k.slice('metadata.'.length), values: v }));

  const setMetadataFilterValues = (key: string, values: string[]) => {
    const filterKey = `metadata.${key}`;
    const next = { ...(filters ?? {}) };
    if (values.length === 0) {
      delete next[filterKey];
    } else {
      next[filterKey] = values;
    }
    setFilters(next);
  };

  // Group-by URL state — list of `metadata.<key>` strings the user wants to
  // add to the dimensions used for chart queries. Stored as JSON array.
  const [metadataGroupBy, setMetadataGroupBy] = useQueryState(
    'metadataGroupBy',
    parseAsJson<string[]>((value) => {
      if (typeof value === 'string') {
        return JSON.parse(value);
      }
      return value;
    })
      .withDefault([])
      .withOptions({
        history: 'push',
        shallow: false,
      })
  );

  useEffect(() => {
    if (
      datePickerValue.absolute &&
      datePickerValue.absolute.startDate &&
      datePickerValue.absolute.endDate
    ) {
      setStartDate(datePickerValue.absolute.startDate);
      setEndDate(datePickerValue.absolute.endDate);
    }
    if (datePickerValue.relative) {
      setRelativeUnit(datePickerValue.relative.unit);
      setRelativeValue(datePickerValue.relative.value);
    }
    setDateType(datePickerValue.type);
  }, [
    datePickerValue,
    setEndDate,
    setStartDate,
    setDateType,
    setRelativeUnit,
    setRelativeValue,
  ]);

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
          Time range, granularity, and refresh cadence. Every chart
          on the page uses these as its outer scope. */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {renderSectionLabel('Period')}
        <Box
          sx={{
            width: '100%',
            display: 'flex',
            gap: '1rem',
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <QuickRangeChips fallbackUnit="minute" />
          <DateRangeEditor
            value={datePickerValue}
            onChange={(newValue) => {
              setDatePickerValue(newValue);
            }}
            renderRelativeInput={(inputProps) => (
              <Grid size={12}>
                <TextField
                  {...inputProps}
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
          {/* Compact granularity toggle — abbreviated labels keep the
            row narrow enough to live inline with the other toolbar
            controls without wrapping. Driven by the codegen
            `GranularityUnit` enum so a typo (or a new enum value
            added on the API side) is caught at build time rather
            than 400-ing at runtime. */}
          <ToggleButtonGroup
            value={granularity}
            onChange={(_, value) => value && setGranularity(value)}
            color="primary"
            exclusive
            size="small"
            aria-label="Granularity"
          >
            {GRANULARITY_OPTIONS.map((opt) => (
              <ToggleButton key={opt.value} value={opt.value}>
                {opt.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <ButtonGroup variant="outlined" ref={refreshButtonAnchorRef}>
            <Button onClick={handleRefreshClick}>
              {
                refreshOptions.find((option) => option.value === autoRefresh)
                  ?.label
              }
            </Button>
            <Button
              size="small"
              aria-controls={
                openRefreshButton ? 'split-button-menu' : undefined
              }
              aria-expanded={openRefreshButton ? 'true' : undefined}
              aria-haspopup="menu"
              variant="outlined"
              onClick={() => {
                setOpenRefreshButton(!openRefreshButton);
              }}
            >
              <ArrowDropDownIcon />
            </Button>
          </ButtonGroup>
          <Popper
            sx={{
              zIndex: 1,
            }}
            open={openRefreshButton}
            anchorEl={refreshButtonAnchorRef.current}
            role={undefined}
            transition
            disablePortal
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
                        refreshButtonAnchorRef.current &&
                        refreshButtonAnchorRef.current.contains(
                          event.target as HTMLElement
                        )
                      ) {
                        return;
                      }

                      setOpenRefreshButton(false);
                    }}
                  >
                    <MenuList id="split-button-menu" autoFocusItem>
                      {refreshOptions.map((option) => (
                        <MenuItem
                          key={option.value}
                          selected={option.value === autoRefresh}
                          onClick={(event) =>
                            handleRefreshMenuItemClick(event, option)
                          }
                        >
                          {option.label}
                        </MenuItem>
                      ))}
                    </MenuList>
                  </ClickAwayListener>
                </Paper>
              </Grow>
            )}
          </Popper>
        </Box>
      </Box>

      {/* ── Filters ─────────────────────────────────────────────
          Narrowing predicates: API key, role groups, and per-key
          metadata. Active metadata filters render as chips below the
          inputs so they line up visually with the input row. */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {renderSectionLabel('Filters')}
        <Box
          sx={{
            width: '100%',
            display: 'flex',
            gap: '1rem',
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          {apiKeys.data && (
            <>
              <Autocomplete
                multiple
                disablePortal
                sx={{ width: '23rem' }}
                options={apiKeys.data}
                value={filters?.apiKeyId
                  ?.map((id: string) =>
                    apiKeys.data.find((v) => v.apiKeyId === id)
                  )
                  .filter(
                    (v: ApiKeyEntity | undefined): v is ApiKeyEntity => !!v
                  )}
                onChange={(_, newValue) => {
                  setFilters({
                    ...(filters ?? {}),
                    apiKeyId: newValue?.map((v) => v.apiKeyId),
                  });
                }}
                disableCloseOnSelect
                isOptionEqualToValue={(option, value) =>
                  option.apiKeyId === value.apiKeyId
                }
                getOptionLabel={(option) =>
                  `${option.name} - ${option.maskedKey}`
                }
                renderOption={(props, option, { selected }) => {
                  return (
                    <li {...props}>
                      <Checkbox
                        icon={<CheckBoxOutlineBlankIcon fontSize="small" />}
                        checkedIcon={<CheckBoxIcon fontSize="small" />}
                        style={{ marginRight: 8 }}
                        checked={selected}
                      />
                      {option.name} - {option.maskedKey}
                    </li>
                  );
                }}
                renderInput={(params) => (
                  <TextField {...params} label="Filter By Role" />
                )}
              />
              <Autocomplete
                multiple
                disablePortal
                sx={{ width: '23rem' }}
                options={[
                  ...new Set(apiKeys.data.flatMap((v) => v.labels ?? [])),
                ]}
                value={filters?.apiKeyLabels}
                onChange={(_, newValue) => {
                  setFilters({
                    ...(filters ?? {}),
                    apiKeyLabels: newValue,
                  });
                }}
                disableCloseOnSelect
                isOptionEqualToValue={(option, value) => option === value}
                getOptionLabel={(option) => option}
                renderOption={(props, option, { selected }) => {
                  return (
                    <li {...props}>
                      <Checkbox
                        icon={<CheckBoxOutlineBlankIcon fontSize="small" />}
                        checkedIcon={<CheckBoxIcon fontSize="small" />}
                        style={{ marginRight: 8 }}
                        checked={selected}
                      />
                      {option}
                    </li>
                  );
                }}
                renderInput={(params) => (
                  <TextField {...params} label="Filter By Role Groups" />
                )}
              />
            </>
          )}

          {/* Metadata key picker. `value={null}` so MUI never renders the
              picked key inside the input — once the user commits a key,
              it lives only in `selectedMetadataKey` and the value picker
              below targets it. The input clears after each pick so the
              user can tab onto the next key without manual clearing. */}
          <Autocomplete
            disablePortal
            freeSolo
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

          {/* Value multi-input for the chosen metadata key. Options are
              fetched lazily from `/metadata-values/<key>`; freeSolo lets
              users type values the index hasn't observed yet. */}
          {selectedMetadataKey && (
            <MetadataValueMultiAutocomplete
              workspaceId={workspaceId}
              environmentId={environmentId}
              metadataKey={selectedMetadataKey}
              values={
                activeMetadataFilters.find((f) => f.key === selectedMetadataKey)
                  ?.values ?? []
              }
              onChange={(values) =>
                setMetadataFilterValues(selectedMetadataKey, values)
              }
            />
          )}
        </Box>

        {/* Active metadata filters — rendered as MUI Chips so they have
            the same vertical weight as the inputs above instead of the
            previous postage-stamp-sized text. Click the X to drop a
            single (key, value) tuple. */}
        {activeMetadataFilters.length > 0 && (
          <Box
            sx={{
              display: 'flex',
              gap: 1,
              alignItems: 'center',
              flexWrap: 'wrap',
              mt: 0.5,
            }}
          >
            {activeMetadataFilters.flatMap(({ key, values }) =>
              values.map((value) => (
                <Chip
                  key={`${key}=${value}`}
                  label={`${key} = ${value}`}
                  onDelete={() =>
                    setMetadataFilterValues(
                      key,
                      values.filter((v) => v !== value)
                    )
                  }
                  deleteIcon={
                    <IconButton
                      size="small"
                      aria-label={`Remove metadata filter ${key}=${value}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMetadataFilterValues(
                          key,
                          values.filter((v) => v !== value)
                        );
                      }}
                    >
                      <CancelIcon fontSize="small" />
                    </IconButton>
                  }
                  variant="outlined"
                  color="primary"
                />
              ))
            )}
          </Box>
        )}
      </Box>

      {/* ── Group ───────────────────────────────────────────────
          Dimensions every chart rolls up by. Per-chart overrides
          live on the chart itself (NamespaceGraph header). */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {renderSectionLabel('Group')}
        <Box
          sx={{
            width: '100%',
            display: 'flex',
            gap: '1rem',
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <Autocomplete
            multiple
            disablePortal
            sx={{ width: '23rem' }}
            options={metadataKeys}
            value={metadataGroupBy ?? []}
            onChange={(_, newValue) => setMetadataGroupBy(newValue)}
            disableCloseOnSelect
            getOptionLabel={(option) => `metadata.${option}`}
            renderOption={(props, option, { selected }) => (
              <li {...props}>
                <Checkbox
                  icon={<CheckBoxOutlineBlankIcon fontSize="small" />}
                  checkedIcon={<CheckBoxIcon fontSize="small" />}
                  style={{ marginRight: 8 }}
                  checked={selected}
                />
                metadata.{option}
              </li>
            )}
            renderInput={(params) => (
              <TextField {...params} label="Group By Metadata" />
            )}
          />
        </Box>
      </Box>
    </Box>
  );
}
