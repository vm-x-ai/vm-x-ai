'use client';

import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloseIcon from '@mui/icons-material/Close';
import ChevronDownIcon from '@mui/icons-material/ExpandMore';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import FormControl from '@mui/material/FormControl';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { Identifier } from 'dnd-core';
import React, { useRef, useState } from 'react';
import { useDrag, useDrop } from 'react-dnd';
import { useQuery } from '@tanstack/react-query';
import {
  buildMetadataExpression,
  DefaultRulesMap,
  DefaultRulesOptions,
  parseMetadataField,
} from './rules';
import {
  AiResourceRoutingCondition,
  RoutingConditionType,
  RoutingOperator,
} from '@/clients/api';
import { getRequestAuditMetadataValuesOptions } from '@/clients/api/@tanstack/react-query.gen';

export type OperatorTagProps = {
  operator: string;
  onClick: () => void;
};

function OperatorTag({ operator, onClick }: OperatorTagProps) {
  return (
    <Box
      onClick={onClick}
      sx={{
        position: 'absolute',
        top: '-1.6em',
        width: '100%',
        pl: '2.3em',
      }}
    >
      <Typography
        variant="caption"
        sx={{ color: 'text.secondary', cursor: 'pointer' }}
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
  /** Workspace + environment scope for the metadata-values lookup. */
  workspaceId?: string;
  environmentId?: string;
  /** Distinct metadata keys observed on recent audits — drives the
   *  field-picker autocomplete for metadata-shaped rules. */
  metadataKeys?: string[];
};

export default function ConditionCard({
  index,
  condition,
  operator,
  onChange,
  onDelete,
  moveRow,
  switchOperator,
  workspaceId,
  environmentId,
  metadataKeys = [],
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

  // Conditional hook below relies on `condition` being a leaf; the
  // group-shape branch returns early, so the metadata-rule check must
  // run first. Pull the active rule preset here so both the early
  // return and the metadata branch can see it.
  const activeRule =
    'conditions' in condition ? undefined : DefaultRulesMap[condition.id];
  const isMetadataRule = !!activeRule?.metadataField;
  const metadataField = isMetadataRule
    ? parseMetadataField(
        ('expression' in condition && condition.expression) || ''
      ) ?? ''
    : '';

  // Distinct values for the chosen metadata field — `enabled` keeps
  // the fetch idle until both scope + field are known so we don't
  // hammer the audit endpoint while the user is still typing the
  // field name.
  const { data: observedValues } = useQuery({
    ...getRequestAuditMetadataValuesOptions({
      path: {
        workspaceId: workspaceId ?? '',
        environmentId: environmentId ?? '',
        key: metadataField,
      },
    }),
    enabled:
      isMetadataRule &&
      !!workspaceId &&
      !!environmentId &&
      metadataField.length > 0,
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
      ref={ref}
      data-handler-id={collectedProps.handlerId}
      sx={{
        position: 'relative',
      }}
    >
      {index > 0 && operator && (
        <OperatorTag operator={operator} onClick={switchOperator} />
      )}
      <Box
        sx={{
          width: 'calc(100% - 2em)',
          mb: 1,
          ml: '2em',
          border: expanded
            ? '1px solid var(--mui-palette-divider)'
            : '1px solid transparent',
          borderRadius: 2,
        }}
      >
        {/* RULE CARD HEADER */}
        <Box
          onClick={() => setExpanded(!expanded)}
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            // Theme-aware tints — `action.selected`/`action.hover` are
            // alpha-blended overlays on top of `background.paper`, so
            // they read as a subtle highlight on both light and dark
            // schemes (vs the previous `blue[50]` / `grey[100]` which
            // were near-white in dark mode).
            backgroundColor: expanded
              ? 'var(--mui-palette-action-selected)'
              : 'var(--mui-palette-action-hover)',
            borderRadius: 2,
            height: '2.5em',
            p: 2,
            pl: 1,
            cursor: 'pointer',

            '&:hover': {
              backgroundColor: expanded
                ? 'var(--mui-palette-action-focus)'
                : 'var(--mui-palette-action-selected)',
            },
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <IconButton size="small">
              {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
            </IconButton>
            <Typography variant="body2" sx={{ fontWeight: 'bold', ml: 1 }}>
              {condition.label}
            </Typography>
          </Box>
          <IconButton size="small" sx={{ color: 'text.secondary', p: 0.5 }}>
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

            {/* RULE VALUE
                Metadata rules render two suggesting Autocompletes
                (field + value); everything else renders the static
                single-input fallback. */}
            {isMetadataRule ? (
              <>
                <FormControl fullWidth sx={{ width: '90%', mb: 2 }}>
                  <Autocomplete
                    freeSolo
                    options={metadataKeys}
                    value={metadataField}
                    onInputChange={(_, newValue) => {
                      onChange?.({
                        ...condition,
                        // Encode the field into the LHS expression so
                        // the routing engine evaluates against
                        // `request.metadata?.[<field>]`. When the user
                        // clears the field, the placeholder shape
                        // (`['']`) is preserved so re-rendering still
                        // recognises the rule as metadata-shaped.
                        expression: buildMetadataExpression(newValue.trim()),
                      });
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Metadata field"
                        placeholder="e.g. userId"
                      />
                    )}
                  />
                </FormControl>
                <FormControl fullWidth sx={{ width: '90%', mb: 2 }}>
                  <Autocomplete
                    freeSolo
                    // Remount the input when the active field
                    // changes so MUI's internal highlighted-option
                    // refs don't outlive the option list.
                    key={metadataField || '__no_field__'}
                    disabled={!metadataField}
                    options={observedValues ?? []}
                    value={condition.value.expression ?? ''}
                    onInputChange={(_, newValue) => {
                      onChange?.({
                        ...condition,
                        value: {
                          ...condition.value,
                          expression: newValue,
                        },
                      });
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Value"
                        helperText={
                          metadataField
                            ? `Values observed for metadata.${metadataField}`
                            : 'Pick a metadata field first'
                        }
                      />
                    )}
                  />
                </FormControl>
              </>
            ) : (
              DefaultRulesMap[condition.id].value &&
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
              )
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
}
