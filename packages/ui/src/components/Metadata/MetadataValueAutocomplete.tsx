'use client';

import Autocomplete from '@mui/material/Autocomplete';
import CircularProgress from '@mui/material/CircularProgress';
import TextField from '@mui/material/TextField';
import { useQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import { getRequestAuditMetadataValuesOptions } from '@/clients/api/@tanstack/react-query.gen';

export type MetadataValueAutocompleteProps = {
  workspaceId: string;
  environmentId: string;
  /** The metadata key currently selected. When undefined the input is disabled. */
  metadataKey: string | null | undefined;
  value: string;
  onChange: (value: string) => void;
  /** Triggered on Enter — used by Audit's chip-on-enter pattern. */
  onCommit?: () => void;
  /** Sx-passthrough so callers can size the input. */
  width?: number | string;
  label?: string;
  helperText?: string;
};

/**
 * Autocomplete that pulls distinct values for the currently-selected
 * metadata key from `/request-audit/.../metadata-values/<key>`.
 *
 * - `freeSolo` so users can type values that haven't been observed yet
 *   (newly-emitted keys land in the index after the audit-flush cron,
 *   so there's a window where a value the user just sent isn't yet
 *   in the list).
 *
 * - The query is gated on `metadataKey` so we don't fetch when the key
 *   picker is empty.
 *
 * - Caching: react-query reuses the result across remounts. Capped to
 *   1000 values server-side so the payload stays small.
 */
export default function MetadataValueAutocomplete({
  workspaceId,
  environmentId,
  metadataKey,
  value,
  onChange,
  onCommit,
  width = '15rem',
  label = 'Metadata Value',
  helperText,
}: MetadataValueAutocompleteProps) {
  const enabled = !!metadataKey;
  const { data, isLoading } = useQuery({
    ...getRequestAuditMetadataValuesOptions({
      path: {
        workspaceId,
        environmentId,
        key: metadataKey ?? '',
      },
    }),
    enabled,
  });
  const options = data ?? [];

  // Mirror the controlled `value` into a ref so the keyDown handler
  // sees the latest text without depending on closure capture
  // timing. Without this, the user types the last character → MUI
  // fires onInputChange (parent setState scheduled) → user presses
  // Enter on the same tick → onKeyDown closure still has the OLD
  // value because React hasn't re-rendered yet → onCommit() reads
  // stale state and refuses to add the chip ("pendingValue is
  // empty"). The ref dodges that race.
  const latestValueRef = useRef(value);
  latestValueRef.current = value;

  const handleChange = (newValue: string) => {
    latestValueRef.current = newValue;
    onChange(newValue);
  };

  return (
    <Autocomplete<string, false, false, true>
      // Keying on `metadataKey` forces a fresh Autocomplete subtree
      // when the user picks a different key. Without this, MUI's
      // `useAutocomplete` keeps a ref to a list item that no longer
      // exists once the options array swaps, and the next click
      // triggers `Cannot read properties of null (reading 'focus')`
      // / `removeAttribute` from inside the hook's effects.
      key={metadataKey ?? '__no_key__'}
      freeSolo
      // Make `inputValue` controlled too — without it freeSolo +
      // controlled `value` can desync, hiding the dropdown when the
      // typed text doesn't match an option.
      inputValue={value}
      size="small"
      sx={{ width }}
      options={options}
      // Don't pass a `value` prop in freeSolo mode — the typed text
      // *is* the value. Passing `value || null` made MUI think the
      // input held a "selected option" that wasn't in `options`, and
      // it stopped showing the dropdown. `inputValue` alone is
      // enough.
      // `openOnFocus` opens the listbox the instant the user tabs/
      // clicks into the field, so the loaded values surface without
      // a downward-arrow press.
      openOnFocus
      // No `autoHighlight` — with freeSolo + autoHighlight, Enter
      // commits the highlighted *option* instead of the typed text,
      // which silently overwrites the user's input.
      onChange={(_, newValue) => {
        handleChange(typeof newValue === 'string' ? newValue : '');
      }}
      onInputChange={(_, newInputValue, reason) => {
        // Ignore `reset` (MUI fires it after select/Enter) so the
        // input doesn't get wiped to '' before our onCommit reads
        // the latest value.
        if (reason === 'reset') return;
        handleChange(newInputValue);
      }}
      disabled={!enabled}
      loading={isLoading}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          helperText={helperText}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            // Stop propagation so MUI Autocomplete's own Enter
            // handling (which fires onChange and resets the
            // input) doesn't race with the parent's chip-add
            // logic. We've already kept the latest typed text in
            // `latestValueRef`.
            const v = latestValueRef.current;
            if (!v) return;
            e.preventDefault();
            e.stopPropagation();
            onCommit?.();
          }}
          slotProps={{
            input: {
              ...(params.slotProps?.input ?? {}),
              endAdornment: (
                <>
                  {isLoading ? (
                    <CircularProgress color="inherit" size={16} />
                  ) : null}
                  {
                    (
                      params.slotProps?.input as
                        | { endAdornment?: React.ReactNode }
                        | undefined
                    )?.endAdornment
                  }
                </>
              ),
            },
          }}
        />
      )}
    />
  );
}
