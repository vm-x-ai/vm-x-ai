'use client';

import AddIcon from '@mui/icons-material/Add';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import EastIcon from '@mui/icons-material/East';
import ChevronDownIcon from '@mui/icons-material/ExpandMore';
import Box from '@mui/material/Box';
import { grey, blue } from '@mui/material/colors';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { Identifier } from 'dnd-core';
import update from 'immutability-helper';
import React, { useCallback, useRef, useState } from 'react';
import { useDrag, useDrop } from 'react-dnd';
import ActionMenu from './ActionMenu';
import ActionSelector from './ActionSelector';
import AdvancedEditor from './AdvancedEditor';
import ConditionCard from './ConditionCard';
import { DefaultRulesOptions } from './rules';
import {
  AiConnectionEntity,
  AiProviderDto,
  AiResourceRoutingCondition,
  AiRoutingConditionGroup,
  RoutingMode,
  RoutingOperator,
} from '@/clients/api';

export type RouteCardProps = {
  route: AiRoutingConditionGroup;
  connections: AiConnectionEntity[];
  workspaceId: string;
  environmentId: string;
  providersMap: Record<string, AiProviderDto>;
  index: number;
  refreshConnectionAction?: () => Promise<AiConnectionEntity[]>;
  onChange?: (route: AiRoutingConditionGroup) => void;
  onDelete?: (route: AiRoutingConditionGroup) => void;
  initialExpanded?: boolean;
  moveRow?: (dragIndex: number, hoverIndex: number) => void;
};

type DragObject = { route: AiRoutingConditionGroup; index: number };

// Main RouteCard Component
export default function RouteCard({
  route,
  providersMap,
  workspaceId,
  environmentId,
  connections,
  index,
  refreshConnectionAction,
  onChange,
  onDelete,
  moveRow,
  initialExpanded = false,
}: RouteCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(initialExpanded);
  const [menuAnchorEl, setMenuAnchorEl] = useState<null | HTMLElement>(null); // Anchor for ActionMenu positioning

  const moveConditionRow = useCallback(
    (dragIndex: number, hoverIndex: number) => {
      onChange?.({
        ...route,
        conditions: update(route.conditions, {
          $splice: [
            [dragIndex, 1],
            [hoverIndex, 0, route.conditions[dragIndex]],
          ],
        }),
      });
    },
    [onChange, route]
  );

  const [collectedProps, drop] = useDrop<
    DragObject,
    unknown,
    { handlerId: Identifier | null }
  >({
    accept: 'route-card',
    collect(monitor) {
      return {
        handlerId: monitor.getHandlerId(),
      };
    },

    hover(item, monitor) {
      if (!ref.current) {
        return;
      }
      const dragIndex = item.index;
      const hoverIndex = index;
      if (dragIndex === hoverIndex) {
        return;
      }
      const hoverBoundingRect = ref.current?.getBoundingClientRect();
      const hoverMiddleY =
        (hoverBoundingRect.bottom - hoverBoundingRect.top) / 2;
      const clientOffset = monitor.getClientOffset();
      if (!clientOffset) {
        return;
      }

      const hoverClientY = clientOffset.y - hoverBoundingRect.top;
      if (dragIndex < hoverIndex && hoverClientY < hoverMiddleY) {
        return;
      }
      if (dragIndex > hoverIndex && hoverClientY > hoverMiddleY) {
        return;
      }
      moveRow?.(dragIndex, hoverIndex);
      item.index = hoverIndex;
    },
  });

  const [, drag] = useDrag({
    type: 'route-card',
    item: () => {
      return { route, index };
    },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  const handleOperatorClick = () => {
    onChange?.({
      ...route,
      operator:
        route.operator === RoutingOperator.AND
          ? RoutingOperator.OR
          : RoutingOperator.AND,
    });
  };

  const handleAdvancedEdit = () => {
    onChange?.({
      ...route,
      mode:
        route.mode === RoutingMode.ADVANCED
          ? RoutingMode.UI
          : RoutingMode.ADVANCED,
    });
  };

  const handleExpandClick = () => {
    if (!menuAnchorEl) {
      setExpanded((prev) => !prev);
    }
  };

  drag(drop(ref));

  return (
    <Box ref={ref} data-handler-id={collectedProps.handlerId}>
      <Grid container spacing={2}>
        {/* ROUTE CARD HEADER */}
        <Grid size={7}>
          <Box
            onClick={handleExpandClick}
            sx={{
              backgroundColor: expanded ? blue[50] : grey[100],
              borderRadius: 2,
              height: '3.7em',
              p: 2,
              pl: 1,
              cursor: 'pointer',
              '&:hover': {
                backgroundColor: expanded ? blue[100] : grey[200],
              },
            }}
            display="flex"
            alignItems="center"
            justifyContent="space-between"
          >
            <Box display="flex" alignItems="center">
              <IconButton size="small" disableRipple>
                {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
              </IconButton>
              <Typography variant="body1" sx={{ fontWeight: 'bold', ml: 1 }}>
                {route.description}
              </Typography>
            </Box>
            {expanded && (
              <ActionMenu
                onDelete={() => onDelete?.(route)}
                onAdvancedEdit={handleAdvancedEdit}
                advancedEditing={route.mode === RoutingMode.ADVANCED}
                menuAnchorEl={menuAnchorEl}
                setMenuAnchorEl={setMenuAnchorEl}
              />
            )}
          </Box>
        </Grid>

        {/* MODEL SELECTOR */}
        <Grid size={5} display="flex" alignItems="center">
          <Box display="flex" alignItems="center" width="100%">
            <Box sx={{ alignSelf: 'flex-start', mt: 2 }}>
              <EastIcon sx={{ color: grey[600], mr: 1 }} />
            </Box>
            <ActionSelector
              providersMap={providersMap}
              workspaceId={workspaceId}
              environmentId={environmentId}
              connections={connections}
              refreshConnectionAction={refreshConnectionAction}
              route={route}
              onChange={onChange}
            />
          </Box>
        </Grid>

        {/* CARD EXPANSION DETAILS */}
        {expanded && (
          <>
            {route.mode === RoutingMode.ADVANCED && (
              <Grid size={12}>
                <AdvancedEditor
                  route={route}
                  onChange={(newRoute) => {
                    onChange?.(newRoute);
                  }}
                />
              </Grid>
            )}

            {route.mode === RoutingMode.UI && (
              <>
                <Grid size={7}>
                  <Box
                    sx={{
                      width: 'calc(100% - 2em)',
                      ml: '2em',
                    }}
                  >
                    <TextField
                      label="Route Name"
                      name="description"
                      value={route.description}
                      size="small"
                      onChange={(event) => {
                        onChange?.({
                          ...route,
                          description: event.target.value,
                        });
                      }}
                      fullWidth
                      type="text"
                    />
                  </Box>
                </Grid>
                {route.conditions.map((condition, index) => (
                  <Grid size={7} key={index}>
                    {/* CONDITION OPERATOR CHANGER */}
                    <ConditionCard
                      index={index}
                      operator={route.operator}
                      moveRow={moveConditionRow}
                      condition={condition as AiResourceRoutingCondition}
                      switchOperator={handleOperatorClick}
                      onDelete={() => {
                        const newConditions = [...route.conditions];
                        newConditions.splice(index, 1);
                        onChange?.({
                          ...route,
                          conditions: newConditions,
                        });
                      }}
                      onChange={(newCondition) => {
                        const newConditions = [...route.conditions];
                        newConditions[index] = newCondition;
                        onChange?.({
                          ...route,
                          conditions: newConditions,
                        });
                      }}
                    />
                  </Grid>
                ))}

                {/* ADDITIONAL RULE CARD FOR ADDING NEW RULE */}
                <Grid size={7}>
                  <Box
                    onClick={() => {
                      onChange?.({
                        ...route,
                        conditions: [
                          ...route.conditions,
                          {
                            type: 'condition',
                            id: DefaultRulesOptions[0].id,
                            label: DefaultRulesOptions[0].label,
                            comparator: DefaultRulesOptions[0].comparator,
                            expression: DefaultRulesOptions[0].expression,
                            value: {
                              type: DefaultRulesOptions[0].value.type,
                              expression: '',
                            },
                          },
                        ],
                      });
                    }}
                    sx={{
                      width: 'calc(100% - 2em)',
                      ml: '2em',
                      border: '1px dashed',
                      borderColor: grey[400],
                      borderRadius: 2,
                      height: '2.5em',
                      display: 'flex',
                      alignItems: 'center',
                      p: 1,
                      '&:hover': {
                        border: '1px solid',
                        borderColor: blue[600],
                        transition:
                          'border-color 0.6s ease, border-style 0.6s ease',
                      },
                    }}
                  >
                    <Box display="flex" alignItems="center">
                      <IconButton size="small">
                        <AddIcon />
                      </IconButton>
                      <Typography
                        variant="body2"
                        sx={{ fontWeight: 'normal', ml: 1, color: grey[600] }}
                      >
                        Add New Rule
                      </Typography>
                    </Box>
                  </Box>
                </Grid>
              </>
            )}
          </>
        )}
      </Grid>
    </Box>
  );
}
