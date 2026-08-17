// vitest/config re-exports Vite's defineConfig with the `test` block typed.
import {defineConfig} from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// Astryx ships pre-built CSS and JS, so it needs no Vite plugin,
// no PostCSS config, and no Babel config. Tailwind is the only
// style-layer plugin here.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {'@': path.resolve(import.meta.dirname, 'src')},
  },
  // Capacitor and Tauri both load the build from the filesystem,
  // so asset URLs must be relative rather than root-absolute.
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 5173,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
