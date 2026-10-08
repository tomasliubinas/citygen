import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@citygen/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      '@citygen/house': fileURLToPath(new URL('../../packages/house/src/index.ts', import.meta.url)),
      '@citygen/interior': fileURLToPath(new URL('../../packages/interior/src/index.ts', import.meta.url)),
      '@citygen/city': fileURLToPath(new URL('../../packages/city/src/index.ts', import.meta.url)),
    },
  },
  // Relative asset paths: the build works from any subdirectory (e.g. zodele.lt/citygen/).
  base: './',
  server: { port: 5173 },
  build: {
    rollupOptions: {
      input: {
        house: fileURLToPath(new URL('./index.html', import.meta.url)),
        city: fileURLToPath(new URL('./city.html', import.meta.url)),
      },
    },
  },
});
