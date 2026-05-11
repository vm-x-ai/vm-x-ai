'use client';

import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import { useQuery } from '@tanstack/react-query';
import { getRequestAuditMetadataValuesOptions } from '@/clients/api/@tanstack/react-query.gen';

export type MetadataValueMultiAutocompleteProps = {
  workspaceId?: string;
  environmentId?: string;
  /** The metadata key being filtered. Drives the values fetched from the API. */
  metadataKey: string;
  values: string[];
  onChange: (values: string[]) => void;
  width?: number | string;
  label?: string;
  helperText?: string;
  disabled?: boolean;
};

/**
 * Multi-select Autocomplete that pulls distinct values for a metadata
 * key from `/request-audit/.../metadata-values/<key>` and lets the user
 * pick any number of them as filter chips.
 *
 * Single shared implementation used by both the Usage and Audit
 * headers — `multiple` + `freeSolo` lets MUI handle the chip rendering
 * + Enter-to-add behaviour natively, so no manual onCommit wiring is
 * required (the previous bespoke Audit version had a closure-stale
 * race that swallowed the typed value).
 */
export default function MetadataValueMultiAutocomplete({
  workspaceId,
  environmentId,
  metadataKey,
  values,
  onChange,
  width = '25rem',
  label,
  helperText,
  disabled = false,
}: MetadataValueMultiAutocompleteProps) {
  const { data: observed } = useQuery({
    ...getRequestAuditMetadataValuesOptions({
      path: {
        workspaceId: workspaceId ?? '',
        environmentId: environmentId ?? '',
        key: metadataKey,
      },
    }),
    enabled: !!workspaceId && !!environmentId && !!metadataKey,
  });
  return (
    <Autocomplete
      // Remount when the active key changes so MUI's internal
      // useAutocomplete refs (highlighted index, focused option)
      // don't outlive the option list they pointed into.
      key={metadataKey || '__no_key__'}
      multiple
      freeSolo
      disablePortal
      disabled={disabled}
      sx={{ width }}
      options={observed ?? []}
      value={values}
      onChange={(_, newValue) => onChange(newValue.map(String))}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label ?? `Values for metadata.${metadataKey}`}
          helperText={helperText}
        />
      )}
    />
  );
}
