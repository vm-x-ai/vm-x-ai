import { UserEntity } from '@/clients/api';
import type { FormActionState } from '@/types';
import { z } from 'zod';
import { schema as createSchema } from '../Create/schema';

const { roleIds, ...rest } = createSchema.shape;

export const schema = z
  .object({
    ...rest,
    id: z.string({ error: 'User ID is required.' }),
    password: createSchema.shape.password.optional(),
    confirmPassword: createSchema.shape.confirmPassword.optional(),
  })
  .superRefine((data, ctx) => {
    if (
      data.password &&
      data.confirmPassword &&
      data.password !== data.confirmPassword
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Passwords must match.',
        path: ['confirmPassword'],
      });
    }
  });

export type FormSchema = z.output<typeof schema>;

export type FormAction = FormActionState<FormSchema, UserEntity>;
