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
  // Root-absolute, NOT './'.
  //
  // A relative base resolves asset URLs against the *current path*, which is
  // fine for a single-page document and broken for a router: at `/ledger/abc`
  // the browser asks for `/ledger/assets/index.js` and gets a 404, so the app
  // renders nothing. One-segment routes happen to work, which is what makes
  // this fail late — it only appears once a route nests, i.e. the first detail
  // page in Phase 3.
  //
  // This replaces an earlier `base: './'` justified by "Capacitor and Tauri
  // load the build from the filesystem". That premise no longer holds: both
  // serve over a custom-protocol origin (Capacitor `http://localhost`, Tauri
  // `tauri://localhost`), not `file://`, so a root-absolute base resolves
  // correctly there too. Phase 7 must confirm that on a real device — if a
  // packaged build 404s on its assets, the fix is `createHashRouter` in
  // app/App.tsx, not a relative base, which cannot work with nested paths.
  //
  // Web hosts need an SPA fallback (rewrite unknown paths to index.html).
  base: '/',
  build: {
    outDir: 'dist',
    sourcemap: true,
    rolldownOptions: {
      output: {
        // Split the dependencies that never change between deploys away from
        // app code that changes on every one. Route-level splitting already
        // keeps individual screens out of the initial download; this is about
        // the other axis — after a deploy a returning user re-fetches only the
        // app chunk, not React and the router again.
        //
        // It also makes `npm run build` legible: framework, database and app
        // weight are three separate numbers instead of one opaque total.
        advancedChunks: {
          groups: [
            {name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/},
            {name: 'router', test: /node_modules[\\/]react-router[\\/]/},
            {name: 'dexie', test: /node_modules[\\/]dexie[\\/]/},
            // visx and the d3 modules under it are reached only from the
            // Analytics route, so this group is loaded on demand rather than
            // at boot. Naming it keeps that visible in the build output —
            // if `charts` ever shows up in the initial download, something
            // has imported a chart from a screen that should not have.
            {name: 'charts', test: /node_modules[\\/](@visx|d3-[a-z]+|internmap)[\\/]/},
            // Every nav icon is its own module, and the nav needs all of them
            // up front. Left alone that is a dozen sub-kilobyte requests on
            // first load, where the round trips cost more than the bytes.
            {name: 'icons', test: /node_modules[\\/]lucide-react[\\/]/},
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
