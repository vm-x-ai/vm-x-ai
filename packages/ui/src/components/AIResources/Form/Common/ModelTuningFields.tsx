'use client';

import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import type { AiResourceModelConfigEntity } from '@/clients/api';

/**
 * Per-model "tuning" inputs — `maxRetries` (SDK retries on transient
 * failure) and `timeoutMs` (per-model deadline). Surfaced next to the
 * connection / model picker in:
 *   - the primary-model section of the General edit form
 *   - each row of the fallback list
 *   - the dynamic-routing destination on every routing rule
 *
 * Wired controlled-component style so the parent form (react-hook-form
 * for the General page, MaterialReactTable for the fallback list) stays
 * the source of truth. The component never owns local state.
 */
export type ModelTuningFieldsProps = {
  value: Partial<AiResourceModelConfigEntity> | null | undefined;
  onChange: (next: Partial<AiResourceModelConfigEntity>) => void;
  /** Compact inline layout for table-row contexts. */
  compact?: boolean;
  disabled?: boolean;
};

export default function ModelTuningFields({
  value,
  onChange,
  compact = false,
  disabled = false,
}: ModelTuningFieldsProps) {
  const update = (patch: Partial<AiResourceModelConfigEntity>) => {
    onChange({
      // Preserve the rest of the model entity so the connection/model
      // picker's selection isn't clobbered when the user edits these
      // fields.
      ...(value ?? {}),
      ...patch,
    });
  };
  const parseNum = (raw: string): number | null => {
    if (raw.trim() === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  // Always render `size="small"` so these inputs visually pair with the
  // connection / model picker (which is also `small`) — using `medium`
  // makes them taller than the surrounding row, which reads as a layout
  // bug. `compact` now only toggles helper-text + spacing.
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: compact ? 1 : 2,
        mt: compact ? 0 : 2,
      }}
    >
      <TextField
        type="number"
        size="small"
        label="Max retries"
        disabled={disabled}
        value={value?.maxRetries ?? ''}
        onChange={(e) => update({ maxRetries: parseNum(e.target.value) })}
        slotProps={{
          htmlInput: { min: 0, max: 10 },
        }}
        helperText={compact ? undefined : '0 = no SDK retry'}
        sx={{ width: compact ? 110 : 160 }}
      />
      <TextField
        type="number"
        size="small"
        label="Timeout (ms)"
        disabled={disabled}
        value={value?.timeoutMs ?? ''}
        onChange={(e) => update({ timeoutMs: parseNum(e.target.value) })}
        slotProps={{
          htmlInput: { min: 100, max: 600000, step: 100 },
        }}
        helperText={compact ? undefined : 'Per-model deadline'}
        sx={{ width: compact ? 130 : 180 }}
      />
    </Box>
  );
}
