import { RoleEntity } from '@/clients/api';
import { zRolePolicy } from '@/clients/api/zod.gen';
import type { FormActionState } from '@/types';
import { z } from 'zod';

export const memberSchema = z.object({
  userId: z.string(),
  assignedAt: z.string().optional(),
  assignedBy: z.string().optional(),
});

export type MemberSchema = z.output<typeof memberSchema>;

export const schema = z.object({
  roleId: z.string().optional(),
  name: z
    .string({
      error: 'Role name is required.',
    })
    .trim()
    .min(3, { message: 'Role name must be at least 3 characters long.' }),
  description: z.string(),
  policy: z.object(
    {
      ...zRolePolicy.shape,
    },
    {
      error: 'Policy is required.',
    }
  ),
  members: z.array(memberSchema).optional(),
  newMembers: z.array(memberSchema).optional(),
  removedMembers: z.array(memberSchema).optional(),
});

// Use z.input here: the regenerated zRolePolicy has $schema with a `.default(...)`,
// which makes $schema optional in the *input* type (what the user submits) but
// required in the *output* type (what zod.parse returns). react-hook-form's
// resolver works on the input shape, so pinning FormSchema to z.input keeps
// the resolver type compatible without weakening runtime validation.
export type FormSchema = z.input<typeof schema>;

export type FormAction = FormActionState<FormSchema, RoleEntity>;
