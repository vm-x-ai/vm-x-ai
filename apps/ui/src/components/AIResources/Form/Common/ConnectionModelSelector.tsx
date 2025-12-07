'use client';

import RefreshIcon from '@mui/icons-material/Refresh';
import type { AutocompleteProps } from '@mui/material/Autocomplete';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import type { ChipTypeMap } from '@mui/material/Chip';
import MUILink from '@mui/material/Link';
import type { TextFieldProps } from '@mui/material/TextField';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import Image from 'next/image';
import Link from 'next/link';
import { useState, useMemo, forwardRef } from 'react';
import {
  AiConnectionEntity,
  AiProviderDto,
  AiResourceModelConfigEntity,
} from '@/clients/api';
import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';

export type AutocompleteValue<Value, Multiple> = Multiple extends true
  ? Array<Value>
  : Value | null;

export type ConnectionModelSelectorProps = {
  workspaceId?: string;
  environmentId?: string;
  connections: AiConnectionEntity[];
  providersMap: Record<string, AiProviderDto>;
  refreshConnectionAction?: () => Promise<AiConnectionEntity[]>;
  renderConnectionInputTextFieldProps?: TextFieldProps;
  renderModelInputTextFieldProps?: TextFieldProps;
  showNewConnectionLink?: boolean;
  value?: AiResourceModelConfigEntity | null;
  onChange?: (
    event: React.SyntheticEvent,
    value: AiResourceModelConfigEntity | null
  ) => void;
} & Omit<
  AutocompleteProps<
    AiConnectionEntity,
    false,
    false,
    false,
    ChipTypeMap['defaultComponent']
  >,
  | 'options'
  | 'renderInput'
  | 'getOptionLabel'
  | 'onChange'
  | 'value'
  | 'fullWidth'
  | 'multiple'
>;

const ConnectionModelSelector = forwardRef<
  HTMLDivElement,
  ConnectionModelSelectorProps
>(function ConnectionModelSelector(
  {
    workspaceId,
    environmentId,
    connections: rawConnections,
    providersMap,
    refreshConnectionAction,
    renderConnectionInputTextFieldProps,
    renderModelInputTextFieldProps,
    showNewConnectionLink = true,
    onChange,
    ...props
  },
  ref
) {
  const [connections, setConnections] =
    useState<AiConnectionEntity[]>(rawConnections);
  const [refreshing, setRefreshing] = useState(false);
  const connectionMap = useMemo(
    () =>
      new Map<string, AiConnectionEntity>(
        connections.map((connection) => [connection.connectionId, connection])
      ),
    [connections]
  );
  const [selectedConnection, setSelectedConnection] =
    useState<AiConnectionEntity | null>(() =>
      props.value && !Array.isArray(props.value)
        ? connectionMap.get(props.value.connectionId) ?? null
        : null
    );

  return (
    <div ref={ref} className="flex gap-2 w-full items-start">
      <div className="w-1/2">
        <Autocomplete
          {...props}
          options={connections}
          fullWidth
          value={selectedConnection}
          onChange={(event, value) => {
            setSelectedConnection(value);
            onChange?.(
              event,
              value
                ? {
                    provider: value?.provider,
                    model: providersMap[value.provider].defaultModel,
                    connectionId: value?.connectionId,
                  }
                : null
            );
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
                <Image
                  alt={providersMap[option.provider].name}
                  src={providersMap[option.provider].config.logo.url}
                  height={20}
                  width={25}
                />
                {option?.description || option?.name}
              </Box>
            );
          }}
          getOptionLabel={(option) =>
            `${providersMap[option.provider].name} - ${option.name}`
          }
          renderInput={(params) => (
            <>
              <div className="group flex gap-2">
                <TextField
                  {...params}
                  {...renderConnectionInputTextFieldProps}
                  slotProps={{
                    input: {
                      ...(params.InputProps ?? {}),
                      sx: {
                        width: '100%',
                      },
                      startAdornment: selectedConnection && (
                        <InputAdornment position="start">
                          <Image
                            alt={providersMap[selectedConnection.provider].name}
                            src={
                              providersMap[selectedConnection.provider].config
                                .logo.url
                            }
                            height={20}
                            width={25}
                          />
                        </InputAdornment>
                      ),
                      endAdornment: selectedConnection && (
                        <InputAdornment position="end">
                          {refreshConnectionAction && (
                            <div className="group-hover:opacity-100 opacity-0">
                              <Tooltip title="Refresh connections">
                                <IconButton
                                  onClick={async () => {
                                    setRefreshing(true);
                                    const refreshConnections =
                                      await refreshConnectionAction();
                                    if (refreshConnections.length) {
                                      setConnections(refreshConnections);
                                    }
                                    setRefreshing(false);
                                  }}
                                  loading={refreshing}
                                  size="small"
                                >
                                  <RefreshIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </div>
                          )}
                          {params.InputProps?.endAdornment}
                        </InputAdornment>
                      ),
                    },
                  }}
                />
              </div>
              {workspaceId && environmentId && showNewConnectionLink && (
                <Typography variant="caption">
                  Click{' '}
                  <MUILink
                    component={Link}
                    href={`/workspaces/${workspaceId}/${environmentId}/ai-connections/new`}
                    target="_blank"
                    variant="body2"
                  >
                    here
                  </MUILink>{' '}
                  to create a new AI connection.
                </Typography>
              )}
            </>
          )}
        />
      </div>
      {selectedConnection && (
        <div className="w-1/2 flex gap-2">
          <TextField
            {...renderModelInputTextFieldProps}
            value={props.value?.model}
            variant="outlined"
            margin="normal"
            fullWidth
            sx={{ marginTop: '0px' }}
            type="text"
            onChange={(event) => {
              onChange?.(event, {
                ...selectedConnection,
                model: event.target.value,
              });
            }}
            label={renderModelInputTextFieldProps?.label ?? 'Model ID'}
            placeholder={
              renderModelInputTextFieldProps?.placeholder ?? 'e.g. gpt-4o'
            }
          />
        </div>
      )}
    </div>
  );
});

export default ConnectionModelSelector;
