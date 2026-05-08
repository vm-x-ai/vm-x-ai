'use client';

import { AiResourceEntity } from '@/clients/api';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import Autocomplete from '@mui/material/Autocomplete';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import TextField from '@mui/material/TextField';
import { useMemo } from 'react';

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
  const resourcesMap = useMemo(() => {
    return resources.reduce((acc, item) => {
      acc[item.resourceId] = item;
      return acc;
    }, {} as Record<string, AiResourceEntity>);
  }, [resources]);

  return (
    <Autocomplete
      value={value}
      multiple
      options={resources.map(({ resourceId }) => resourceId) ?? []}
      onChange={async (_, value) => {
        onChange(value);
      }}
      onBlur={onBlur}
      disableCloseOnSelect
      renderValue={(value, getItemProps) =>
        value.map((option, index) => {
          const { key, ...tagProps } = getItemProps({ index });
          return (
            <Chip
              key={key}
              label={resourcesMap?.[option]?.name ?? option}
              {...tagProps}
              size="small"
            />
          );
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
            {resourcesMap?.[option]?.name ?? option}
          </li>
        );
      }}
      renderInput={(params) => (
        <TextField {...params} placeholder="Select resources" />
      )}
    />
  );
}
