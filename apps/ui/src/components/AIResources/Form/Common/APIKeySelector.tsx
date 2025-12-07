'use client';

import { ApiKeyEntity } from '@/clients/api';
import RefreshIcon from '@mui/icons-material/Refresh';
import type { AutocompleteProps } from '@mui/material/Autocomplete';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import type { ChipTypeMap } from '@mui/material/Chip';
import MUILink from '@mui/material/Link';
import type { TextFieldProps } from '@mui/material/TextField';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import Link from 'next/link';
import { useEffect, useState, useMemo, forwardRef } from 'react';

export type APIKeySelectorProps<
  Multiple extends boolean | undefined,
  DisableClearable extends boolean | undefined,
  ChipComponent extends React.ElementType = ChipTypeMap['defaultComponent']
> = {
  workspaceId?: string;
  environmentId?: string;
  refreshAction?: () => Promise<ApiKeyEntity[]>;
  renderInputTextFieldProps?: TextFieldProps;
  showNewLink?: boolean;
  options: ApiKeyEntity[];
} & Omit<
  AutocompleteProps<string, Multiple, DisableClearable, false, ChipComponent>,
  'options' | 'renderInput' | 'getOptionLabel'
>;

const APIKeySelector = forwardRef(function APIKeySelector<
  Multiple extends boolean | undefined,
  DisableClearable extends boolean | undefined,
  ChipComponent extends React.ElementType = ChipTypeMap['defaultComponent']
>(
  {
    workspaceId,
    environmentId,
    refreshAction,
    renderInputTextFieldProps,
    options: rawOptions,
    showNewLink = true,
    ...props
  }: APIKeySelectorProps<Multiple, DisableClearable, ChipComponent>,
  ref: React.Ref<HTMLDivElement>
) {
  const [refreshing, setRefreshing] = useState(false);
  const [options, setOptions] = useState<ApiKeyEntity[]>(rawOptions ?? []);

  useEffect(() => {
    if (rawOptions) {
      setOptions(rawOptions);
    }
  }, [rawOptions]);

  const optionsMap = useMemo(() => {
    return options.reduce(
      (acc, key) => ({
        ...acc,
        [key.apiKeyId]: key,
      }),
      {} as Record<string, ApiKeyEntity>
    );
  }, [options]);

  return (
    <>
      <Autocomplete
        {...props}
        ref={ref}
        options={options.map((option) => option.apiKeyId)}
        getOptionLabel={(option) => optionsMap[option]?.name ?? ''}
        renderInput={(params) => (
          <>
            <Box display="flex" gap="1rem">
              <TextField
                {...params}
                {...renderInputTextFieldProps}
                InputProps={{
                  ...(params.InputProps ?? {}),
                  ...(renderInputTextFieldProps?.InputProps ?? {}),
                }}
              />
              {refreshAction && (
                <Tooltip title="Refresh roles">
                  <Button
                    aria-label="refresh"
                    variant="outlined"
                    color="primary"
                    size="large"
                    loading={refreshing}
                    sx={{
                      '.MuiButton-startIcon': {
                        marginRight: 0,
                        marginLeft: 0,
                      },
                    }}
                    onClick={async () => {
                      setRefreshing(true);
                      const refreshItems = await refreshAction();
                      if (refreshItems.length) {
                        setOptions(refreshItems);
                      }
                      setRefreshing(false);
                    }}
                    startIcon={<RefreshIcon fontSize="large" />}
                  />
                </Tooltip>
              )}
            </Box>
            {workspaceId && environmentId && showNewLink && (
              <Typography variant="caption">
                Click{' '}
                <MUILink
                  component={Link}
                  href={`/workspaces/${workspaceId}/${environmentId}/security/auth/role/new`}
                  target="_blank"
                  variant="body2"
                >
                  here
                </MUILink>{' '}
                to create a new role.
              </Typography>
            )}
          </>
        )}
      />
    </>
  );
});

const TypedAPIKeySelector: <
  Multiple extends boolean | undefined,
  DisableClearable extends boolean | undefined
>(
  props: APIKeySelectorProps<Multiple, DisableClearable>
) => React.ReactElement = APIKeySelector as never;

export default TypedAPIKeySelector;
