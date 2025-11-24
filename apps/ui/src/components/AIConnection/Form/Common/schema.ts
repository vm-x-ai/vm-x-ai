import { AiProviderDto } from '@/clients/api';
import { aiProviderConfigSchemaValidator } from '@vm-x-ai/shared-ai-provider';
import type { ErrorObject } from 'ajv';
import type { ZodType } from 'zod';
import { z } from 'zod';

export const ProviderFieldsetFormSchema = z.object({
  provider: z.string({
    error: 'Provider is required.',
  }),
  allowedModels: z.array(z.string()),
  config: z.record(z.string(), z.any()).optional(),
  providersMap: z.record(z.string(), z.custom<AiProviderDto>()).optional(),
});

export type ProviderFieldsetFormSchema = z.output<
  typeof ProviderFieldsetFormSchema
>;

export const applyProviderValidation = <
  TSchema extends ProviderFieldsetFormSchema
>(
  schema: ZodType<TSchema>
): ZodType<TSchema> => {
  return schema.superRefine((data, ctx) => {
    if (!data.providersMap) {
      ctx.addIssue({
        code: 'custom',
        message: 'Providers map is required.',
        path: ['provider'],
      });
      return;
    }

    const providerSchema =
      data.providersMap[data.provider].config.connection.form;

    const validate = aiProviderConfigSchemaValidator.compile(providerSchema);
    const valid = validate(data.config ?? {});
    if (!valid) {
      for (const error of validate.errors ?? []) {
        addValidationIssue(error, ctx);
      }
    }
  });
};

function addValidationIssue(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error: ErrorObject<string, Record<string, any>, unknown>,
  ctx: z.RefinementCtx,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  patternError?: ErrorObject<string, Record<string, any>, unknown>
) {
  if (error.keyword === 'required') {
    ctx.addIssue({
      code: 'custom',
      message: patternError ? patternError.message : error.message,
      path: [`config.${error.params.missingProperty}`],
    });
  } else if (error.instancePath) {
    console.log('path', `config${error.instancePath.replace(/\//g, '.')}`);
    ctx.addIssue({
      code: 'custom',
      message: error.message,
      path: [`config${error.instancePath.replace(/\//g, '.')}`],
    });
  } else if (error.keyword === 'errorMessage') {
    for (const customError of error.params.errors) {
      addValidationIssue(customError, ctx, error);
    }
  }
}
