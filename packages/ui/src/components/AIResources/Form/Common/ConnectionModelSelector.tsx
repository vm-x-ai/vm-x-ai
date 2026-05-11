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
import Link from 'next/link';
import { useState, useMemo, forwardRef } from 'react';
import {
  AiConnectionEntity,
  AiProviderDto,
  AiResourceModelConfigEntity,
} from '@/clients/api';
import ProviderLogo from '@/components/Providers/ProviderLogo';
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
    useState<AiConnectionEntity | null>(() => {
      if (!props.value || Array.isArray(props.value)) return null;
      const { connectionId } = props.value;
      return connectionId ? connectionMap.get(connectionId) ?? null : null;
    });

  return (
    <div ref={ref} className="flex gap-2 w-full items-start">
      {/* Connection field takes the full row before a connection is
          picked (the model field below is conditional on
          `selectedConnection`). Once a connection is selected, the
          connection input gets 60% and the model-ID input 40% — a
          plain 50/50 split was too tight on the narrower edit form
          (the connection name + provider icon got truncated to
          "Op..."), and model IDs ("gpt-4.1") are short enough to fit
          comfortably in the smaller column. */}
      <div className={selectedConnection ? 'w-3/5' : 'w-full'}>
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
                <ProviderLogo
                  alt={providersMap[option.provider].name}
                  logo={providersMap[option.provider]?.config.logo}
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
                    ...params.slotProps,

                    input: {
                      ...(params.slotProps.input ?? {}),
                      sx: {
                        width: '100%',
                      },
                      startAdornment: selectedConnection && (
                        <InputAdornment position="start">
                          <ProviderLogo
                            alt={providersMap[selectedConnection.provider].name}
                            logo={
                              providersMap[selectedConnection.provider]?.config
                                .logo
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
                          {params.slotProps.input?.endAdornment}
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
        <div className="w-2/5 flex gap-2">
          <TextField
            {...renderModelInputTextFieldProps}
            // Falling back to '' avoids the controlled→uncontrolled
            // warning the React dev runtime logs when `props.value`
            // is initially undefined and only populated after a user
            // interaction.
            value={props.value?.model ?? ''}
            variant="outlined"
            margin="normal"
            fullWidth
            sx={{ marginTop: '0px' }}
            type="text"
            onChange={(event) => {
              // Emit only the three keys the consumer's resource
              // model entity expects — spreading the full
              // `AiConnectionEntity` would leak unrelated fields
              // (createdAt/updatedBy/etc.) into the form state.
              onChange?.(event, {
                provider: selectedConnection.provider,
                model: event.target.value,
                connectionId: selectedConnection.connectionId,
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
