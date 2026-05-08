'use client';

import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import { parseAsString, useQueryState, parseAsInteger } from 'nuqs';
import React from 'react';

/**
 * Compact quick-pick chips that set the URL date-range params to common
 * windows (Today / 7d / 30d). Sits next to the full date-range editor
 * on the Audit + Usage headers — most users want one of these three
 * windows; the editor stays for arbitrary ranges.
 *
 * Click semantics: clicking a chip flips `dateType=relative` and
 * pushes `relativeUnit` + `relativeValue` to match. The header's
 * existing date-range editor reads the same nuqs keys, so it
 * re-renders to show the newly-selected window without a roundtrip.
 */
export type QuickRangeChipsProps = {
  /** Default unit when none is set. Audit uses 'day', Usage uses 'minute'. */
  fallbackUnit?: 'day' | 'minute';
};

const PRESETS = [
  { label: 'Today', unit: 'day', value: 1 },
  { label: '7d', unit: 'day', value: 7 },
  { label: '30d', unit: 'day', value: 30 },
] as const;

export default function QuickRangeChips({
  fallbackUnit = 'day',
}: QuickRangeChipsProps) {
  const [dateType, setDateType] = useQueryState(
    'dateType',
    parseAsString.withDefault('relative').withOptions({
      history: 'push',
      shallow: false,
    })
  );
  const [relativeUnit, setRelativeUnit] = useQueryState(
    'relativeUnit',
    parseAsString.withDefault(fallbackUnit).withOptions({
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

  const isActive = (preset: (typeof PRESETS)[number]) =>
    dateType === 'relative' &&
    relativeUnit === preset.unit &&
    relativeValue === preset.value;

  // Sized to match the granularity ToggleButtonGroup and the
  // surrounding outlined buttons — using Chip (`size="small"`) made
  // these visually small relative to the rest of the toolbar.
  const activePreset = PRESETS.find((p) => isActive(p));

  return (
    <ToggleButtonGroup
      value={activePreset?.label ?? null}
      exclusive
      size="small"
      color="primary"
      // Pin the height to the surrounding small TextFields (~40px) so
      // the chip group doesn't bulge above them. MUI's `small` toggle
      // default leaves vertical padding that ends up ~12px taller than
      // a small Autocomplete.
      sx={{
        '& .MuiToggleButton-root': {
          height: 40,
          paddingY: 0,
          paddingX: 1.5,
        },
      }}
      onChange={(_, label) => {
        const preset = PRESETS.find((p) => p.label === label);
        if (!preset) return;
        setDateType('relative');
        setRelativeUnit(preset.unit);
        setRelativeValue(preset.value);
      }}
    >
      {PRESETS.map((p) => (
        <ToggleButton key={p.label} value={p.label}>
          {p.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
