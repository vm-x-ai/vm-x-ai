'use client';

import AddIcon from '@mui/icons-material/Add';
import Box from '@mui/material/Box';
import { blue, grey } from '@mui/material/colors';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import update from 'immutability-helper';
import React, { useCallback, useState } from 'react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import RouteCard from './RouteCard';
import {
  AiConnectionEntity,
  AiProviderDto,
  AiRoutingConditionGroup,
  RoutingAction,
  RoutingMode,
  RoutingOperator,
} from '@/clients/api';

type DynamicRoutingTreeProps = {
  data: AiRoutingConditionGroup[];
  connections: AiConnectionEntity[];
  workspaceId: string;
  environmentId: string;
  providersMap: Record<string, AiProviderDto>;
  refreshConnectionAction?: () => Promise<AiConnectionEntity[]>;
  onChange?: (route: AiRoutingConditionGroup[]) => void;
};

export default function DynamicRoutingTree({
  data,
  connections,
  workspaceId,
  environmentId,
  providersMap,
  refreshConnectionAction,
  onChange,
}: DynamicRoutingTreeProps) {
  const [recentlyAdded, setRecentlyAdded] = useState<number | null>(null);

  const moveRow = useCallback(
    (dragIndex: number, hoverIndex: number) => {
      onChange?.(
        update(data, {
          $splice: [
            [dragIndex, 1],
            [hoverIndex, 0, data[dragIndex]],
          ],
        })
      );
    },
    [data, onChange]
  );

  return (
    <Box sx={{ width: '100%' }}>
      <Box display="flex" alignItems="center" gap={1} sx={{ my: 5 }}>
        <Typography variant="body1" sx={{ fontWeight: 'bold' }}>
          Routes
        </Typography>
      </Box>

      <Grid container spacing={3} sx={{ mt: 5 }}>
        <DndProvider backend={HTML5Backend}>
          {data.map((route, index) => (
            <React.Fragment key={index}>
              <Grid size={12}>
                <RouteCard
                  route={route}
                  connections={connections}
                  workspaceId={workspaceId}
                  environmentId={environmentId}
                  providersMap={providersMap}
                  refreshConnectionAction={refreshConnectionAction}
                  onChange={(newRoute) => {
                    const newData = [...data];
                    newData[index] = newRoute;
                    onChange?.(newData);
                  }}
                  onDelete={() => {
                    const newData = [...data];
                    newData.splice(index, 1);
                    onChange?.(newData);
                  }}
                  initialExpanded={recentlyAdded === index}
                  moveRow={moveRow}
                  index={index}
                />
              </Grid>
            </React.Fragment>
          ))}
        </DndProvider>
        <Grid size={12}>
          <Box sx={{ width: '100%', mb: 1 }}>
            <Grid container spacing={2}>
              <Grid size={7}>
                <Box
                  onClick={() => {
                    onChange?.([
                      ...data,
                      {
                        type: 'group',
                        description: `Route #${data.length + 1}`,
                        operator: RoutingOperator.AND,
                        conditions: [],
                        action: RoutingAction.CALL_MODEL,
                        mode: RoutingMode.UI,
                      },
                    ]);
                    setRecentlyAdded(data.length);
                  }}
                  sx={{
                    border: '1px dashed',
                    borderColor: grey[400],
                    borderRadius: 2,
                    height: '3.7em',
                    p: 2,
                    pl: 1,
                    cursor: 'pointer',
                    '&:hover': {
                      border: '1px solid',
                      borderColor: blue[600],
                      transition:
                        'border-color 0.6s ease, border-style 0.6s ease',
                    },
                  }}
                  display="flex"
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <Box display="flex" alignItems="center">
                    <IconButton size="small">
                      <AddIcon />
                    </IconButton>
                    <Typography
                      variant="body2"
                      sx={{ fontWeight: 'normal', ml: 1, color: grey[600] }}
                    >
                      Add New Route
                    </Typography>
                  </Box>
                </Box>
              </Grid>
            </Grid>
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
}
