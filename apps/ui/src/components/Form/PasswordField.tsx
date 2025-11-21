'use client';

import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import type { TextFieldProps } from '@mui/material/TextField';
import TextField from '@mui/material/TextField';
import React from 'react';
import { useState } from 'react';

export type PasswordFieldProps = {
  errorMessage?: string;
} & TextFieldProps;

function PasswordField({ errorMessage, ...field }: PasswordFieldProps, ref: React.ForwardedRef<HTMLInputElement>) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <TextField
      {...field}
      ref={ref}
      type={showPassword ? 'text' : 'password'}
      error={!!errorMessage}
      helperText={
        <>
          {errorMessage?.split('\n').map((msg, idx) => (
            <React.Fragment key={idx}>
              {msg}
              <br />
            </React.Fragment>
          ))}
        </>
      }
      InputProps={{
        endAdornment: (
          <InputAdornment position="end">
            <IconButton
              aria-label="toggle password visibility"
              tabIndex={-1}
              onClick={() => setShowPassword((prev) => !prev)}
              onMouseDown={(event) => event.preventDefault()}
              onMouseUp={(event) => event.preventDefault()}
              edge="end"
            >
              {showPassword ? <VisibilityOff /> : <Visibility />}
            </IconButton>
          </InputAdornment>
        ),
      }}
    />
  );
}

export default React.forwardRef(PasswordField);
