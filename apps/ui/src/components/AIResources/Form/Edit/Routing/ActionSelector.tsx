'use client';

import Box from '@mui/material/Box';
import FormControl from '@mui/material/FormControl';
import Grid from '@mui/material/Grid';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import TextField from '@mui/material/TextField';
import React from 'react';
import ConnectionModelSelector from '../../Common/ConnectionModelSelector';
import {
  AiProviderDto,
  AiConnectionEntity,
  RoutingAction,
  AiRoutingConditionGroup,
} from '@/clients/api';

const actions = [
  {
    value: RoutingAction.BLOCK,
    label: 'Block this route',
  },
  { value: RoutingAction.CALL_MODEL, label: 'Call Model' },
];

export type ActionSelectorProps = {
  route: AiRoutingConditionGroup;
  connections: AiConnectionEntity[];
  workspaceId: string;
  environmentId: string;
  providersMap: Record<string, AiProviderDto>;
  refreshConnectionAction?: () => Promise<AiConnectionEntity[]>;
  onChange?: (route: AiRoutingConditionGroup) => void;
};

export default function ActionSelector({
  route,
  providersMap,
  workspaceId,
  environmentId,
  connections,
  refreshConnectionAction,
  onChange,
}: ActionSelectorProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        width: '100%',
        gap: 1,
      }}
    >
      <FormControl fullWidth sx={{ width: '30%' }}>
        <InputLabel>Action</InputLabel>
        <Select
          value={route.action}
          onChange={(event) => {
            onChange?.({
              ...route,
              action: event.target.value as RoutingAction,
            });
          }}
          displayEmpty
          label="Action"
        >
          {actions.map((action) => (
            <MenuItem dense key={action.value} value={action.value}>
              {action.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <Box
        sx={{
          width: '70%',
        }}
      >
        {route.action === RoutingAction.CALL_MODEL && (
          <Grid container spacing={3}>
            <Grid size={12}>
              <ConnectionModelSelector
                value={route.then?.provider ? route.then : undefined}
                onChange={(_, value) => {
                  onChange?.({
                    ...route,
                    then: value
                      ? { ...value, ...(route.then ?? {}) }
                      : undefined,
                  });
                }}
                providersMap={providersMap}
                workspaceId={workspaceId}
                environmentId={environmentId}
                connections={connections}
                refreshConnectionAction={refreshConnectionAction}
                showNewConnectionLink={false}
                renderConnectionInputTextFieldProps={{
                  label: 'Call Model - Connection',
                }}
                renderModelInputTextFieldProps={{
                  label: 'Call Model - Model ID',
                }}
              />
            </Grid>
            <Grid size={12}>
              <TextField
                label="Traffic (%)"
                name="then.traffic"
                type="number"
                value={route.then?.traffic ?? ''}
                onChange={(event) =>
                  onChange?.({
                    ...route,
                    then: {
                      ...(route.then ?? {}),
                      traffic: event.target.value
                        ? Number(event.target.value)
                        : undefined,
                    },
                  } as AiRoutingConditionGroup)
                }
                fullWidth
              />
            </Grid>
          </Grid>
        )}
      </Box>
    </Box>
  );
}
