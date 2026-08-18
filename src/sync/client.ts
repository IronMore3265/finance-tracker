/**
 * The Supabase client, and the rules about when it is allowed to exist.
 *
 * Sync is opt-in, and this file is what makes that claim true rather than
 * aspirational:
 *
 *   - **The SDK is never statically imported.** `@supabase/supabase-js` is
 *     reached through `await import()`, so it is its own chunk and a user who
 *     never signs in never downloads it. A static import here would put ~120kb
 *     of auth and PostgREST machinery on the boot path of an offline-first
 *     app, which is exactly backwards.
 *   - **Nothing loads it at boot except a device that has opted in.** That is
 *     what `hasOptedIn` is for. Asking the SDK "is there a session?" would
 *     require loading the SDK to find out, so the answer is cached in
 *     localStorage under a key this app owns. Reading Supabase's own
 *     `sb-<ref>-auth-token` key would work today and break on the day they
 *     rename it.
 *   - **A build with no credentials configured still runs.** `readSyncConfig`
 *     returning null is a supported state, not an error — it is the state
 *     every fork of this repo starts in.
 */
import type {SupabaseClient} from '@supabase/supabase-js';

export interface SyncConfig {
  url: string;
  publishableKey: string;
}

/**
 * Credentials from the environment, or null if this build has none.
 *
 * The publishable key is safe to ship in a client bundle — it grants nothing
 * on its own, because every table is behind RLS and every policy is written
 * against `auth.uid()`. It still lives in `.env` rather than in source, so
 * that a fork points at its own project instead of silently at this one.
 */
export function readSyncConfig(): SyncConfig | null {
  const url = import.meta.env['VITE_SUPABASE_URL'];
  const publishableKey = import.meta.env['VITE_SUPABASE_PUBLISHABLE_KEY'];

  if (typeof url !== 'string' || url === '') return null;
  if (typeof publishableKey !== 'string' || publishableKey === '') return null;

  return {url, publishableKey};
}

export function isSyncConfigured(): boolean {
  return readSyncConfig() !== null;
}

const OPT_IN_KEY = 'finance-tracker.sync.enabled';

/**
 * Has this device signed in at some point?
 *
 * Set on a successful sign-in and cleared on sign-out, so it tracks intent
 * rather than session validity — an expired token still counts as opted in,
 * because the right response to one is to load the SDK and refresh it, not to
 * pretend sync was never turned on.
 */
export function hasOptedIn(): boolean {
  try {
    return globalThis.localStorage?.getItem(OPT_IN_KEY) === '1';
  } catch {
    // Private browsing modes throw on access rather than returning null.
    return false;
  }
}

export function setOptedIn(optedIn: boolean): void {
  try {
    if (optedIn) globalThis.localStorage?.setItem(OPT_IN_KEY, '1');
    else globalThis.localStorage?.removeItem(OPT_IN_KEY);
  } catch {
    // Not being able to remember the preference is survivable; the user signs
    // in again next launch. Failing the sign-in over it is not.
  }
}

let clientPromise: Promise<SupabaseClient> | null = null;

/**
 * The one client instance, created on first use.
 *
 * Memoized on the promise rather than the resolved client so two callers
 * racing at boot share one dynamic import and one auth instance — two
 * `createClient` calls against the same storage key produce two token
 * refreshers fighting over one refresh token.
 */
export function getSupabaseClient(): Promise<SupabaseClient> {
  if (clientPromise) return clientPromise;

  const config = readSyncConfig();
  if (!config) {
    return Promise.reject(
      new Error('Cloud sync is not configured in this build of the app.'),
    );
  }

  clientPromise = import('@supabase/supabase-js').then(({createClient}) =>
    createClient(config.url, config.publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // This app has no callback route: sign-in happens in a form on the
        // settings screen, and there is never a token in the URL to detect.
        // Leaving it on makes every navigation parse the fragment for one.
        detectSessionInUrl: false,
      },
    }),
  );

  return clientPromise;
}
