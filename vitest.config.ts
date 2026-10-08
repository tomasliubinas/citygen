import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@citygen/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@citygen/house': fileURLToPath(new URL('./packages/house/src/index.ts', import.meta.url)),
      '@citygen/interior': fileURLToPath(new URL('./packages/interior/src/index.ts', import.meta.url)),
      '@citygen/city': fileURLToPath(new URL('./packages/city/src/index.ts', import.meta.url)),
    },
  },
  test: { include: ['packages/*/test/**/*.test.ts'] },
});
