import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works on GitHub Pages or any sub-path.
  base: './',
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['manifold-3d'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  test: { environment: 'node', testTimeout: 60000, setupFiles: ['tests/setup.ts'] },
} as never);
