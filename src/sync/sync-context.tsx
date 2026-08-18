/**
 * When sync runs, and what the rest of the app is allowed to know about it.
 *
 * The engine is a function; this decides when to call it. That split is
 * deliberate — everything with a rule behind it (ordering, cursors, conflict
 * resolution) is in `engine.ts` and tested against a fake server, and
 * everything here is scheduling and React state, which is the part that would
 * be tedious to test and cheap to get wrong in a way you can see.
 *
 * The scheduling rules:
 *
 *   - **Nothing happens until the user signs in.** The SDK is not even
 *     downloaded (see client.ts). An app that phones home before you ask it to
 *     is not offline-first, whatever its storage layer does.
 *   - **A local change schedules a cycle, debounced.** Typing an amount into a
 *     dialog queues an outbox entry per keystroke-committed save; syncing each
 *     one separately would be a request per edit for no benefit, since the
 *     outbox collapses repeated edits to one row anyway.
 *   - **One cycle at a time.** A second request while one is running sets a
 *     flag rather than starting a race — two cycles would both drain the
 *     outbox and push the same rows twice.
 *   - **A failure is remembered, not retried in a loop.** Being offline is the
 *     normal state of this app, not an error worth hammering the network over;
 *     the next local change, the next `online` event, or the next poll picks
 *     it up.
 */
import {useLiveQuery} from 'dexie-react-hooks';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {Session} from '@supabase/supabase-js';
import {db} from '../db/db';
import {getMeta} from '../db/meta';
import {LAST_SYNCED_AT_KEY, runSync} from './engine';
import {getSupabaseClient, hasOptedIn, isSyncConfigured, setOptedIn} from './client';
import {createSupabaseRemote} from './remote';

export type SyncState =
  /** No credentials in this build. Sync cannot be turned on at all. */
  | 'unconfigured'
  /** Configured, but nobody is signed in. The normal state for a new install. */
  | 'signed-out'
  /** Signed in, nothing to do. */
  | 'idle'
  | 'syncing'
  /** The last cycle failed. The queue is intact and will be retried. */
  | 'error';

export interface SyncStatus {
  state: SyncState;
  email: string | null;
  /** Epoch ms of the last fully successful cycle, across restarts. */
  lastSyncedAt: number | null;
  /** Rows waiting to be pushed. Drives "3 changes not yet saved to the cloud". */
  pendingCount: number;
  error: string | null;
}

export interface SyncContextValue extends SyncStatus {
  signIn(email: string, password: string): Promise<void>;
  /** Resolves to whether a confirmation email is waiting to be clicked. */
  signUp(email: string, password: string): Promise<{needsConfirmation: boolean}>;
  signOut(): Promise<void>;
  syncNow(): Promise<void>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

/** Long enough to absorb a burst of edits, short enough to feel immediate. */
const DEBOUNCE_MS = 2_000;
/** A backstop for changes made on another device while this one sits open. */
const POLL_MS = 5 * 60 * 1000;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function SyncProvider({children}: {children: ReactNode}) {
  const configured = isSyncConfigured();

  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<SyncState>(
    configured ? 'signed-out' : 'unconfigured',
  );
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

  // Rows waiting to go up. A live query rather than a counter this file keeps,
  // so it stays right no matter which screen wrote the row.
  const pendingCount = useLiveQuery(() => db.outbox.count(), [], 0);

  const running = useRef(false);
  const rerunWanted = useRef(false);
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;

  useEffect(() => {
    void getMeta<number>(LAST_SYNCED_AT_KEY).then((at) => {
      if (typeof at === 'number') setLastSyncedAt(at);
    });
  }, []);

  /**
   * Restore an existing session at boot — but only on a device that has
   * signed in before, so a user who never turned sync on never pays for the
   * SDK. `hasOptedIn` is read synchronously from localStorage, which is why it
   * can gate the dynamic import rather than being learned from it.
   */
  useEffect(() => {
    if (!configured || !hasOptedIn()) return;

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    void (async () => {
      try {
        const client = await getSupabaseClient();
        const {data} = await client.auth.getSession();
        if (cancelled) return;
        setSession(data.session);

        const {data: listener} = client.auth.onAuthStateChange((_event, next) => {
          setSession(next);
          // A signed-out session is not an error state, and leaving a stale
          // message on screen after the user signs out reads like one.
          if (!next) setError(null);
        });
        unsubscribe = () => listener.subscription.unsubscribe();
      } catch (caught) {
        if (!cancelled) setError(messageOf(caught));
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [configured]);

  const runCycle = useCallback(async () => {
    const active = sessionRef.current;
    if (!active) return;

    if (running.current) {
      // Something changed mid-cycle. Rather than racing, note that another
      // pass is owed and let the current one finish.
      rerunWanted.current = true;
      return;
    }

    running.current = true;

    try {
      // A loop rather than a recursive call: a cycle that was asked to run
      // again while it was working runs again here, still holding the guard,
      // so the "one at a time" promise covers the repeat too.
      do {
        rerunWanted.current = false;
        setState('syncing');
        setError(null);

        try {
          const client = await getSupabaseClient();
          const remote = createSupabaseRemote(client, active.user.id);
          const result = await runSync({remote, userId: active.user.id});
          setLastSyncedAt(result.finishedAt);
          setState('idle');
        } catch (caught) {
          setError(messageOf(caught));
          setState('error');
          // Whatever asked for a repeat, a failed cycle is not the moment to
          // grant it. The queue is intact; the next trigger tries again.
          break;
        }
      } while (rerunWanted.current);
    } finally {
      running.current = false;
    }
  }, []);

  // Sync on sign-in, and whenever there is something to send. `pendingCount`
  // dropping to zero also fires this, which is the cheap way to get a final
  // pull after the last push without tracking that separately.
  useEffect(() => {
    if (!session) {
      setState(configured ? 'signed-out' : 'unconfigured');
      return;
    }

    const timer = setTimeout(() => void runCycle(), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [session, pendingCount, configured, runCycle]);

  // Reconnecting, coming back to the tab, and a slow poll. All three exist for
  // the same reason: a change made on another device is not something this one
  // can be told about without asking.
  useEffect(() => {
    if (!session) return;

    const trigger = () => void runCycle();
    const onVisible = () => {
      if (document.visibilityState === 'visible') trigger();
    };

    globalThis.addEventListener('online', trigger);
    document.addEventListener('visibilitychange', onVisible);
    const poll = setInterval(trigger, POLL_MS);

    return () => {
      globalThis.removeEventListener('online', trigger);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(poll);
    };
  }, [session, runCycle]);

  const signIn = useCallback(async (email: string, password: string) => {
    const client = await getSupabaseClient();
    const {error: failure} = await client.auth.signInWithPassword({email, password});
    if (failure) throw new Error(failure.message);
    // Only now, so a failed attempt does not make every future boot load the
    // SDK to discover there was never a session.
    setOptedIn(true);
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const client = await getSupabaseClient();
    const {data, error: failure} = await client.auth.signUp({email, password});
    if (failure) throw new Error(failure.message);

    // With email confirmation on, sign-up returns a user but no session. That
    // is a success the user has to act on, not a failure, and saying nothing
    // leaves them staring at an unchanged form.
    const needsConfirmation = data.session === null;
    if (!needsConfirmation) setOptedIn(true);
    return {needsConfirmation};
  }, []);

  const signOut = useCallback(async () => {
    const client = await getSupabaseClient();
    await client.auth.signOut();
    setOptedIn(false);
    setSession(null);
    setError(null);
    // Cursors and the account stamp deliberately survive. Signing out is not
    // "forget this device": signing back into the same account should resume,
    // not re-download everything, and the stamp is what keeps a *different*
    // account from being merged in on top.
  }, []);

  const value = useMemo<SyncContextValue>(
    () => ({
      state,
      email: session?.user.email ?? null,
      lastSyncedAt,
      pendingCount: pendingCount ?? 0,
      error,
      signIn,
      signUp,
      signOut,
      syncNow: runCycle,
    }),
    [state, session, lastSyncedAt, pendingCount, error, signIn, signUp, signOut, runCycle],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

/**
 * Falls back to "unconfigured" outside a provider rather than throwing, for
 * the same reason `usePrivacyMode` does: a component rendered in isolation in
 * a test should render, and the provider is mounted at the app root so the
 * fallback only applies where there is no app.
 */
export function useSync(): SyncContextValue {
  return (
    useContext(SyncContext) ?? {
      state: 'unconfigured',
      email: null,
      lastSyncedAt: null,
      pendingCount: 0,
      error: null,
      signIn: async () => {},
      signUp: async () => ({needsConfirmation: false}),
      signOut: async () => {},
      syncNow: async () => {},
    }
  );
}
