import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@stackmon/util': fileURLToPath(new URL('./packages/util/src/index.ts', import.meta.url)),
      '@stackmon/content': fileURLToPath(new URL('./packages/content/src/index.ts', import.meta.url)),
      '@stackmon/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@stackmon/engine': fileURLToPath(new URL('./packages/engine/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    environment: 'node',
  },
});
