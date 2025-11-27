'use client';

import Autocomplete, { createFilterOptions } from '@mui/material/Autocomplete';
import Chip from '@mui/material/Chip';
import TextField from '@mui/material/TextField';

const filter = createFilterOptions<string>();

export type LabelsSelectorProps = {
  existingLabels: string[];
  value?: string[];
  onChange: (value: string[]) => void;
  onBlur: () => void;
};

export default function LabelsSelector({ existingLabels, value, onChange, onBlur }: LabelsSelectorProps) {
  return (
    <Autocomplete
      value={value}
      multiple
      freeSolo
      options={existingLabels}
      filterOptions={(options, params) => {
        const filtered = filter(options, params);

        const { inputValue } = params;
        // Suggest the creation of a new value
        const isExisting = options.some((option) => inputValue === option);
        if (inputValue !== '' && !isExisting) {
          filtered.push(`Add "${inputValue}"`);
        }

        return filtered;
      }}
      selectOnFocus
      clearOnBlur
      handleHomeEndKeys
      onChange={async (_, newValue) => {
        onChange(newValue.map((item) => (item.startsWith('Add "') ? item.slice(5, -1) : item)));
      }}
      onBlur={onBlur}
      disableCloseOnSelect
      renderTags={(value, getTagProps) =>
        value.map((option, index) => {
          const { key, ...tagProps } = getTagProps({ index });
          return <Chip key={key} label={option} color="primary" {...tagProps} size="small" />;
        })
      }
      renderOption={(props, option) => <li {...props}>{option}</li>}
      renderInput={(params) => <TextField {...params} placeholder="Add groups" />}
    />
  );
}
