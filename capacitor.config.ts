import type {CapacitorConfig} from '@capacitor/cli';

/**
 * The Android wrapper. `npx cap sync android` copies `dist/` into the project
 * and regenerates `android/` from this file — which is why `android/` is
 * gitignored: it is output, and anything hand-edited there is lost the next
 * time someone regenerates it. Native changes belong here.
 *
 * `androidScheme` is set explicitly even though `https` is already the default,
 * because it is the app's **origin** and IndexedDB is keyed to the origin.
 * Changing it in a later release — to `http`, or to a custom hostname — points
 * the WebView at a different origin and every installed copy comes up with an
 * empty database and no error. There is no migration for that. It is also what
 * makes the WebView a secure context, which `crypto.subtle` and the Supabase
 * SDK both require.
 *
 * There is no `server.url` here on purpose: that field points the shipped app
 * at a dev server, and a release built with it left in is a release that shows
 * a blank screen to anyone not on the developer's network.
 */
const config: CapacitorConfig = {
  appId: 'io.github.ironmore3265.financetracker',
  appName: 'Finance Tracker',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    // The app already draws its own background from the Astryx theme; letting
    // the WebView paint white first is what causes a light flash on launch in
    // dark mode.
    backgroundColor: '#00000000',
  },
};

export default config;
