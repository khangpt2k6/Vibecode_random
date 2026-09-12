import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@stackmon/engine': fileURLToPath(new URL('../engine/src/index.ts', import.meta.url)),
      '@stackmon/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      '@stackmon/content': fileURLToPath(new URL('../content/src/index.ts', import.meta.url)),
      '@stackmon/util': fileURLToPath(new URL('../util/src/index.ts', import.meta.url)),
    },
  },
  server: { port: 5173, strictPort: false },
  build: { target: 'es2022', sourcemap: true },
});
