'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Alert from '@mui/material/Alert';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import InputAdornment from '@mui/material/InputAdornment';
import TextField, { type TextFieldProps } from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import SubmitButton from '@/components/Form/SubmitButton';
import { useRouter } from 'next/navigation';
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Controller, FormProvider, useForm } from 'react-hook-form';
import { toast } from 'react-toastify';
import { schema, type FormSchema, type FormAction } from './schema';
import { formatPlainDecimal } from './format';

/**
 * Convert a free-text decimal input to a number — or `null` for the
 * optional fields when the box is cleared. Returns `undefined` if the
 * text isn't a parseable number so the caller can preserve the
 * current value (and zod surfaces the validation error on submit).
 */
function parseDecimalInput(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  // Permissive parse — accepts `0.0000003`, `3e-7`, and bare digits.
  // The DB stores either form indistinguishably.
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

type DecimalInputProps = Omit<
  TextFieldProps,
  'value' | 'onChange' | 'type' | 'inputMode'
> & {
  value: number | null | undefined;
  onChange: (next: number | null) => void;
};

/**
 * Decimal text input backed by a local string. Deriving the display
 * straight from `formatPlainDecimal(value)` on every render is wrong:
 * mid-edit, typing `0.00000` parses to `0`, the form re-renders the
 * display as `'0'`, and the trailing decimal context vanishes under
 * the cursor — so a single backspace on `0.000004` would jump to `0`
 * instead of stepping to `0.00000`. We instead hold the raw text in
 * local state and only resync from `value` when the bound number
 * truly diverges (e.g. a form reset), leaving the user's in-progress
 * keystrokes untouched.
 */
function DecimalInput({ value, onChange, ...rest }: DecimalInputProps) {
  const [text, setText] = useState<string>(() => formatPlainDecimal(value));

  useEffect(() => {
    const parsedFromText = parseDecimalInput(text);
    const sameValue =
      parsedFromText === value || (parsedFromText == null && value == null);
    if (!sameValue) {
      setText(formatPlainDecimal(value));
    }
  }, [value, text]);

  return (
    <TextField
      {...rest}
      // See `Table.tsx` formatPlainDecimal comment for why
      // `type="number"` is wrong here; `inputMode` still surfaces a
      // numeric keypad on mobile without the browser's exponential
      // formatting.
      type="text"
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        const parsed = parseDecimalInput(raw);
        if (parsed === undefined) return; // unparseable — preserve prior numeric value
        onChange(parsed);
      }}
    />
  );
}

export type ModelPricingFormProps = {
  submitAction: (
    prevState: FormAction,
    data: FormSchema
  ) => Promise<FormAction>;
  /** When provided, hydrates the form for the edit flow. */
  initialValues?: FormSchema;
  /** Title shown above the form — "New" vs "Edit". */
  title: string;
};

/**
 * Pricing entry create/edit form. The shape matches the server's
 * `CreateModelPricingDto` 1:1; per-token costs are entered as decimals
 * (e.g. `0.0000025` for $2.50 / 1M tokens). The form intentionally
 * exposes raw per-token numbers — converting to "per 1M" is a UI
 * affordance that's risky to round-trip without losing precision, and
 * the seed migration uses the per-token form.
 */
export default function ModelPricingForm({
  submitAction,
  initialValues,
  title,
}: ModelPricingFormProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState(submitAction, {
    message: '',
    data: undefined,
    success: undefined,
  });

  useEffect(() => {
    if (state.success && state.response) {
      toast.success(state.message);
      router.push('/settings/pricing');
    }
  }, [router, state]);

  const form = useForm<FormSchema>({
    resolver: zodResolver(schema as never),
    defaultValues: initialValues ?? {
      provider: '',
      model: '',
      inputCostPerToken: 0,
      outputCostPerToken: 0,
      cachedInputCostPerToken: null,
      reasoningCostPerToken: null,
    },
  });

  return (
    <Grid container spacing={3}>
      {state.success === false && (
        <Grid size={12}>
          <Alert severity="error">{state.message}</Alert>
        </Grid>
      )}
      <Grid size={12}>
        <FormProvider {...form}>
          <form
            ref={formRef}
            action={() => {
              form.handleSubmit((values) => {
                startTransition(() => formAction(values));
              })({
                target: formRef.current,
              } as unknown as React.FormEvent<HTMLFormElement>);
            }}
            noValidate
          >
            <Grid container size={12} spacing={3}>
              <Grid size={12}>
                <Typography variant="h6">{title}</Typography>
                <Divider />
                <Typography variant="caption">
                  Per-token cost the Usage + Audit pages use to compute spend.
                  Enter raw per-token decimals — e.g. <code>0.0000025</code> is
                  $2.50 per 1M tokens.
                </Typography>
              </Grid>

              <Grid size={6}>
                <Controller
                  name="provider"
                  control={form.control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      variant="outlined"
                      margin="normal"
                      fullWidth
                      label="Provider"
                      placeholder="openai"
                      error={!!form.formState.errors.provider}
                      helperText={form.formState.errors.provider?.message}
                    />
                  )}
                />
              </Grid>
              <Grid size={6}>
                <Controller
                  name="model"
                  control={form.control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      variant="outlined"
                      margin="normal"
                      fullWidth
                      label="Model"
                      placeholder="gpt-4o-mini"
                      error={!!form.formState.errors.model}
                      helperText={form.formState.errors.model?.message}
                    />
                  )}
                />
              </Grid>

              <Grid size={6}>
                <Controller
                  name="inputCostPerToken"
                  control={form.control}
                  render={({ field }) => (
                    <DecimalInput
                      value={field.value}
                      onChange={(v) => field.onChange(v ?? 0)}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                      variant="outlined"
                      margin="normal"
                      fullWidth
                      label="Input cost per token"
                      slotProps={{
                        input: {
                          startAdornment: (
                            <InputAdornment position="start">$</InputAdornment>
                          ),
                        },
                      }}
                      error={!!form.formState.errors.inputCostPerToken}
                      helperText={
                        form.formState.errors.inputCostPerToken?.message
                      }
                    />
                  )}
                />
              </Grid>
              <Grid size={6}>
                <Controller
                  name="outputCostPerToken"
                  control={form.control}
                  render={({ field }) => (
                    <DecimalInput
                      value={field.value}
                      onChange={(v) => field.onChange(v ?? 0)}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                      variant="outlined"
                      margin="normal"
                      fullWidth
                      label="Output cost per token"
                      slotProps={{
                        input: {
                          startAdornment: (
                            <InputAdornment position="start">$</InputAdornment>
                          ),
                        },
                      }}
                      error={!!form.formState.errors.outputCostPerToken}
                      helperText={
                        form.formState.errors.outputCostPerToken?.message
                      }
                    />
                  )}
                />
              </Grid>

              <Grid size={6}>
                <Controller
                  name="cachedInputCostPerToken"
                  control={form.control}
                  render={({ field }) => (
                    <DecimalInput
                      value={field.value}
                      onChange={(v) => field.onChange(v)}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                      variant="outlined"
                      margin="normal"
                      fullWidth
                      label="Cached input cost per token (optional)"
                      slotProps={{
                        input: {
                          startAdornment: (
                            <InputAdornment position="start">$</InputAdornment>
                          ),
                        },
                      }}
                      error={!!form.formState.errors.cachedInputCostPerToken}
                      helperText={
                        form.formState.errors.cachedInputCostPerToken?.message
                      }
                    />
                  )}
                />
              </Grid>
              <Grid size={6}>
                <Controller
                  name="reasoningCostPerToken"
                  control={form.control}
                  render={({ field }) => (
                    <DecimalInput
                      value={field.value}
                      onChange={(v) => field.onChange(v)}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                      variant="outlined"
                      margin="normal"
                      fullWidth
                      label="Reasoning cost per token (optional)"
                      slotProps={{
                        input: {
                          startAdornment: (
                            <InputAdornment position="start">$</InputAdornment>
                          ),
                        },
                      }}
                      error={!!form.formState.errors.reasoningCostPerToken}
                      helperText={
                        form.formState.errors.reasoningCostPerToken?.message
                      }
                    />
                  )}
                />
              </Grid>

              <Grid size={12}>
                <SubmitButton label="Save" submittingLabel="Saving..." />
              </Grid>
            </Grid>
          </form>
        </FormProvider>
      </Grid>
    </Grid>
  );
}
