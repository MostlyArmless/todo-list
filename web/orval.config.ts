import { defineConfig } from 'orval';

export default defineConfig({
  api: {
    input: {
      // Fetch OpenAPI spec from running FastAPI server
      target: 'http://localhost:8000/openapi.json',
    },
    output: {
      target: './src/generated/api.ts',
      // Use React Query for automatic caching, loading states, and type-safe hooks
      client: 'react-query',
      mode: 'single',
      override: {
        mutator: {
          // Use custom fetch wrapper for auth handling
          path: './src/lib/api-fetcher.ts',
          name: 'customFetch',
        },
        query: {
          // Signal support for request cancellation
          signal: true,
        },
      },
    },
  },
});
