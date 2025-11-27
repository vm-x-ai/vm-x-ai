'use client';

import { AiResourceEntity } from '@/clients/api';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import Autocomplete from '@mui/material/Autocomplete';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import TextField from '@mui/material/TextField';

export type ResourceSelectorProps = {
  resources: AiResourceEntity[];
  value?: string[];
  onChange: (value: string[]) => void;
  onBlur: () => void;
};

export default function ResourceSelector({
  resources,
  value,
  onChange,
  onBlur,
}: ResourceSelectorProps) {
  return (
    <Autocomplete
      value={value}
      multiple
      options={resources.map(({ resource }) => resource) ?? []}
      onChange={async (_, value) => {
        onChange(value);
      }}
      onBlur={onBlur}
      disableCloseOnSelect
      renderTags={(value, getTagProps) =>
        value.map((option, index) => {
          const { key, ...tagProps } = getTagProps({ index });
          return <Chip key={key} label={option} {...tagProps} size="small" />;
        })
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
            {option}
          </li>
        );
      }}
      renderInput={(params) => (
        <TextField {...params} placeholder="Select resources" />
      )}
    />
  );
}
