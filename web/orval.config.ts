import { defineConfig } from 'orval';

export default defineConfig({
  api: {
    input: {
      // Fetch OpenAPI spec from running FastAPI server
      target: 'http://localhost:8000/openapi.json',
    },
    output: {
      // Generate to a dedicated file (not in lib/ to avoid conflicts)
      target: './src/generated/api.ts',
      // Use plain fetch client (not React Query) to align with existing api.ts
      client: 'fetch',
      // Generate as single file with all types and operations
      mode: 'single',
      // Override default options
      override: {
        mutator: {
          // Use custom fetch wrapper for auth handling
          path: './src/lib/api-fetcher.ts',
          name: 'customFetch',
        },
      },
    },
  },
});
