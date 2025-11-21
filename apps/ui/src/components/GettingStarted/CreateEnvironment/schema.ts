import { z } from 'zod';

export const schema = z.object({
  name: z
    .string({
      error: 'Name is required.',
    })
    .trim()
    .min(3, {
      message: 'Name must be at least 3 characters long.',
    }),
});

export type FormSchema = z.output<typeof schema>;
