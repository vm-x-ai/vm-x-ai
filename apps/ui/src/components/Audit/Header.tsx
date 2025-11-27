'use client';

import { CalendarMonth } from '@mui/icons-material';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';
import { DateRangeEditor } from '@/components/DateRangePicker';
import { subDays } from 'date-fns';
import Image from 'next/image';
import {
  parseAsString,
  parseAsIsoDateTime,
  useQueryState,
  parseAsInteger,
} from 'nuqs';
import React, { useEffect, useState } from 'react';
import type {
  DateRangePickerValue,
  RelativeValueUnit,
} from '../DateRangePicker/types';
import {
  AiConnectionEntity,
  AiProviderDto,
  AiResourceEntity,
} from '@/clients/api';

export type AuditHeaderProps = {
  resources?: AiResourceEntity[];
  aiConnectionMap?: Record<string, AiConnectionEntity>;
  providersMap?: Record<string, AiProviderDto>;
};

export default function AuditHeader({
  resources,
  aiConnectionMap,
  providersMap,
}: AuditHeaderProps) {
  const [resourceMap, setResourceMap] = useState<
    Record<string, AiResourceEntity> | undefined
  >();

  useEffect(() => {
    setResourceMap(
      resources?.reduce(
        (acc, resource) => ({ ...acc, [resource.resource]: resource }),
        {}
      )
    );
  }, [resources]);

  const [dateType, setDateType] = useQueryState(
    'dateType',
    parseAsString.withDefault('relative').withOptions({
      history: 'push',
      shallow: false,
    })
  );

  const [relativeValue, setRelativeValue] = useQueryState(
    'relativeValue',
    parseAsInteger.withDefault(7).withOptions({
      history: 'push',
      shallow: false,
    })
  );

  const [relativeUnit, setRelativeUnit] = useQueryState(
    'relativeUnit',
    parseAsString.withDefault('day').withOptions({
      history: 'push',
      shallow: false,
    })
  );

  const [startDate, setStartDate] = useQueryState(
    'start',
    parseAsIsoDateTime.withDefault(subDays(new Date(), 7)).withOptions({
      history: 'push',
      shallow: false,
    })
  );
  const [endDate, setEndDate] = useQueryState(
    'end',
    parseAsIsoDateTime.withDefault(new Date()).withOptions({
      history: 'push',
      shallow: false,
    })
  );

  const [datePickerValue, setDatePickerValue] = useState<DateRangePickerValue>({
    type: dateType as 'relative' | 'absolute',
    relative: {
      unit: relativeUnit as RelativeValueUnit,
      value: relativeValue,
    },
    absolute: {
      endDate,
      startDate,
    },
  });

  const [connectionId, setConnectionId] = useQueryState(
    'connectionId',
    parseAsString.withOptions({
      history: 'push',
      shallow: false,
    })
  );

  const [resource, setResource] = useQueryState(
    'resource',
    parseAsString.withOptions({
      history: 'push',
      shallow: false,
    })
  );

  const [statusCode, setStatusCode] = useQueryState(
    'statusCode',
    parseAsInteger.withOptions({
      history: 'push',
      shallow: false,
    })
  );

  useEffect(() => {
    if (
      datePickerValue.absolute &&
      datePickerValue.absolute.startDate &&
      datePickerValue.absolute.endDate
    ) {
      setStartDate(datePickerValue.absolute.startDate);
      setEndDate(datePickerValue.absolute.endDate);
    }
    if (datePickerValue.relative) {
      setRelativeUnit(datePickerValue.relative.unit);
      setRelativeValue(datePickerValue.relative.value);
    }
    setDateType(datePickerValue.type);
  }, [
    datePickerValue,
    setEndDate,
    setStartDate,
    setDateType,
    setRelativeUnit,
    setRelativeValue,
  ]);

  return (
    <Box
      sx={{
        display: 'flex',
        gap: '1rem',
      }}
    >
      <DateRangeEditor
        value={datePickerValue}
        onChange={(newValue) => {
          setDatePickerValue(newValue);
        }}
        renderRelativeInput={(inputProps) => (
          <Grid size={12}>
            <TextField
              {...inputProps}
              size="small"
              label="Date Range"
              sx={{ width: '23rem' }}
            />
          </Grid>
        )}
        renderAbsoluteInput={(startProps, endProps) => (
          <React.Fragment>
            <Grid size={12}>
              <TextField
                value={`${startProps.value} - ${endProps.value}`}
                onClick={startProps.onClick}
                label="Date Range"
                size="small"
                slotProps={{
                  input: {
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          aria-label="calendar"
                          onClick={() => {
                            startProps.onClick &&
                              startProps.onClick(null as never);
                          }}
                          edge="end"
                        >
                          <CalendarMonth />
                        </IconButton>
                      </InputAdornment>
                    ),
                  },
                }}
                sx={{ width: '30rem' }}
              />
            </Grid>
          </React.Fragment>
        )}
        cloneOnSelection={false}
      />

      {resourceMap && (
        <Autocomplete
          disablePortal
          value={resource}
          options={Object.keys(resourceMap)}
          onChange={(_, newValue) => {
            setResource(newValue);
          }}
          size="small"
          sx={{
            width: '20rem',
          }}
          renderInput={(params) => (
            <TextField {...params} label="AI Resource" />
          )}
        />
      )}

      {providersMap && aiConnectionMap && (
        <Autocomplete
          disablePortal
          value={connectionId}
          options={Object.keys(aiConnectionMap)}
          getOptionLabel={(option) =>
            aiConnectionMap[option]?.name ?? 'Unknown'
          }
          onChange={(_, newValue) => {
            setConnectionId(newValue);
          }}
          size="small"
          sx={{
            width: '20rem',
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
                  alt={providersMap[aiConnectionMap[option].provider]?.name}
                  src={
                    providersMap[aiConnectionMap[option].provider]?.config?.logo
                      ?.url
                  }
                  height={18}
                  width={18}
                />
                {aiConnectionMap[option]?.name}
              </Box>
            );
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              label="AI Connection"
              slotProps={
                connectionId
                  ? {
                      input: {
                        ...params.InputProps,
                        startAdornment: (
                          <InputAdornment position="start">
                            <Image
                              alt={
                                providersMap[
                                  aiConnectionMap[connectionId].provider
                                ].name
                              }
                              src={
                                providersMap[
                                  aiConnectionMap[connectionId].provider
                                ].config.logo.url
                              }
                              height={20}
                              width={25}
                              style={{
                                marginLeft: '.2rem',
                                marginTop: '.2rem',
                              }}
                            />
                          </InputAdornment>
                        ),
                      },
                    }
                  : {}
              }
            />
          )}
        />
      )}

      <Autocomplete
        disablePortal
        value={statusCode}
        options={[200, 400, 401, 429, 500]}
        onChange={(_, newValue) => {
          setStatusCode(newValue);
        }}
        size="small"
        sx={{
          width: '20rem',
        }}
        renderInput={(params) => <TextField {...params} label="Status Code" />}
      />
    </Box>
  );
}
