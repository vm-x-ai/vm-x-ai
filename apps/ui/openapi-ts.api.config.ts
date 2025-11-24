import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: 'http://localhost:3000/docs-json',
  output: 'src/clients/api',
  plugins: [
    {
      enums: 'typescript',
      name: '@hey-api/typescript',
    },
    '@hey-api/client-next',
    '@tanstack/react-query',
    {
      name: 'zod',
      metadata: true,
      types: {
        infer: true,
      },
      requests: {
        types: {
          infer: true,
        },
      },
      responses: {
        types: {
          infer: true,
        },
      },
    },
  ],
});
