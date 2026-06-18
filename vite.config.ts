import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    target: 'es2020',
    // Let Vite code-split naturally: the 3D board is a dynamic import, so
    // three.js / R3F land in their own async chunk and only download when a
    // player actually opens the 3D view — keeping the initial load lean.
    chunkSizeWarningLimit: 1600,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
