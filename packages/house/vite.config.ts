// Lets `vite-node` resolve workspace packages from source when running the CLI.
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@citygen/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      '@citygen/house': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      '@citygen/interior': fileURLToPath(new URL('../interior/src/index.ts', import.meta.url)),
    },
  },
});
