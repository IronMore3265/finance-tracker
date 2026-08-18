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
  // serve over an origin (Capacitor `https://localhost`, Tauri
  // `tauri://localhost`), not `file://`, so a root-absolute base resolves
  // correctly there too.
  //
  // Phase 7 confirmed the Android half in Capacitor's own source rather than
  // by guessing: `WebViewLocalServer.handleLocalRequest` serves `index.html`
  // for any path whose last segment contains no `.`, and `CapConfig.html5mode`
  // defaults to true — so `/ledger/<id>` gets the document and
  // `/assets/index-*.js` gets the file. No hash router is needed. If a
  // packaged build ever does 404 on its assets, the fix is `createHashRouter`
  // in app/App.tsx, not a relative base, which cannot work with nested paths.
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
            // Reached only through `await import()` in sync/client.ts, so a
            // user who never signs in never downloads it. Named for the same
            // reason `charts` is: if `supabase` ever appears in the initial
            // preload list, something has imported the SDK statically and
            // sync has stopped being opt-in.
            {name: 'supabase', test: /node_modules[\\/]@supabase[\\/]/},
            // Reached only through `await import()` in migration/xls.ts, on
            // the one screen that reads the old app's .xls. Roughly 800kb of
            // parser for a job most people do once and never again, so the
            // same rule applies: if `sheetjs` shows up in the initial preload
            // list, something has imported it statically and every user is
            // now paying for it.
            {name: 'sheetjs', test: /node_modules[\\/]xlsx[\\/]/},
            // The two native shells. Reached only through `await import()` in
            // platform/native.ts, and only after the shell's own globals have
            // identified it, so a browser downloads neither. Named for the same
            // reason as the two above: if `capacitor` or `tauri` ever appears
            // in the initial preload list, something has imported a plugin
            // statically and every web visitor is paying for a file handler
            // they cannot use.
            {name: 'capacitor', test: /node_modules[\\/]@capacitor[\\/]/},
            {name: 'tauri', test: /node_modules[\\/]@tauri-apps[\\/]/},
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
