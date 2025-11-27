'use client';

import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloseIcon from '@mui/icons-material/Close';
import ChevronDownIcon from '@mui/icons-material/ExpandMore';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import { grey, blue } from '@mui/material/colors';
import FormControl from '@mui/material/FormControl';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { Identifier } from 'dnd-core';
import React, { useRef, useState } from 'react';
import { useDrag, useDrop } from 'react-dnd';
import { DefaultRulesMap, DefaultRulesOptions } from './rules';
import {
  AiResourceRoutingCondition,
  RoutingConditionType,
  RoutingOperator,
} from '@/clients/api';

export type OperatorTagProps = {
  operator: string;
  onClick: () => void;
};

function OperatorTag({ operator, onClick }: OperatorTagProps) {
  return (
    <Box
      position="absolute"
      top="-1.6em"
      width="100%"
      sx={{ pl: '2.3em' }}
      onClick={onClick}
    >
      <Typography
        variant="caption"
        sx={{ color: grey[500], cursor: 'pointer' }}
      >
        {operator}
      </Typography>
    </Box>
  );
}

type DragObject = { condition: AiResourceRoutingCondition; index: number };

export type ConditionCardProps = {
  index: number;
  condition: AiResourceRoutingCondition;
  operator: RoutingOperator;
  switchOperator: () => void;
  onChange?: (condition: AiResourceRoutingCondition) => void;
  onDelete?: (condition: AiResourceRoutingCondition) => void;
  moveRow?: (dragIndex: number, hoverIndex: number) => void;
};

export default function ConditionCard({
  index,
  condition,
  operator,
  onChange,
  onDelete,
  moveRow,
  switchOperator,
}: ConditionCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);

  const [collectedProps, drop] = useDrop<
    DragObject,
    unknown,
    { handlerId: Identifier | null }
  >({
    accept: 'condition-card',
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
    type: 'condition-card',
    item: () => {
      return { condition, index };
    },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  if ('conditions' in condition) {
    return <>Unsupported UI configuration.</>;
  }

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onChange?.({
      ...condition,
      value: { ...condition.value, expression: event.target.value },
    });
  };

  drag(drop(ref));

  return (
    <Box
      position="relative"
      ref={ref}
      data-handler-id={collectedProps.handlerId}
    >
      {index > 0 && operator && (
        <OperatorTag operator={operator} onClick={switchOperator} />
      )}
      <Box
        sx={{
          width: 'calc(100% - 2em)',
          mb: 1,
          ml: '2em',
          border: expanded ? `1px solid ${grey[300]}` : '1px solid transparent',
          borderRadius: 2,
        }}
      >
        {/* RULE CARD HEADER */}
        <Box
          sx={{
            backgroundColor: expanded ? blue[50] : grey[100],
            borderRadius: 2,
            height: '2.5em',
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
          onClick={() => setExpanded(!expanded)}
        >
          <Box display="flex" alignItems="center">
            <IconButton size="small">
              {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
            </IconButton>
            <Typography variant="body2" sx={{ fontWeight: 'bold', ml: 1 }}>
              {condition.label}
            </Typography>
          </Box>
          <IconButton size="small" sx={{ color: grey[600], p: 0.5 }}>
            <CloseIcon
              fontSize="small"
              onClick={() => {
                onDelete?.(condition);
              }}
            />
          </IconButton>
        </Box>

        {/* RULE CARD EXPANSION DETAILS */}
        {expanded && (
          <Box sx={{ mt: 3, pl: 2 }}>
            {/* NAME */}
            <FormControl fullWidth sx={{ width: '90%', mb: 2 }}>
              <TextField
                label="Rule Name"
                name="label"
                value={condition.label}
                onChange={(event) =>
                  onChange?.({ ...condition, label: event.target.value })
                }
                fullWidth
              />
            </FormControl>

            {/* RULE SELECTOR */}
            <Autocomplete
              value={DefaultRulesMap[condition.id]}
              onChange={(_, newValue) => {
                if (newValue) {
                  onChange?.({
                    ...condition,
                    type: 'condition',
                    id: newValue.id,
                    label: newValue.label,
                    comparator: newValue.comparator,
                    expression: newValue.expression,
                    value: { type: newValue.value.type, expression: '' },
                  });
                }
              }}
              id="rule-select"
              options={DefaultRulesOptions}
              sx={{ width: '90%', mb: 2 }}
              renderInput={(params) => (
                <TextField {...params} label="Select Rule" />
              )}
            />

            {/* RULE VALUE */}
            {DefaultRulesMap[condition.id].value &&
              !DefaultRulesMap[condition.id].value.readOnly && (
                <FormControl fullWidth sx={{ width: '90%', mb: 2 }}>
                  <TextField
                    label={DefaultRulesMap[condition.id].value.label}
                    name="value"
                    value={condition.value.expression}
                    onChange={handleInputChange}
                    fullWidth
                    type={
                      DefaultRulesMap[condition.id].value.type ===
                      RoutingConditionType.NUMBER
                        ? 'number'
                        : 'text'
                    }
                  />
                </FormControl>
              )}
          </Box>
        )}
      </Box>
    </Box>
  );
}
