/**
 * The server, behind an interface.
 *
 * The engine talks to `SyncRemote` in *local* row terms — camelCase, epoch
 * milliseconds — and this file is the only place that knows about PostgREST,
 * snake_case, or ISO strings. Two things fall out of that:
 *
 *   - The engine's tests run against an in-memory fake and exercise the real
 *     ordering, cursor and conflict logic with no network and no SDK.
 *   - Swapping to PowerSync or ElectricSQL (the escape hatch named in
 *     PROGRESS.md §6) means writing another implementation of this interface,
 *     not rewriting the engine.
 */
import type {SupabaseClient} from '@supabase/supabase-js';
import type {SyncedTable, SyncMeta} from '../db/types';
import {REMOTE_TABLE, fromRemoteRow, toRemoteRow, type RemoteRow} from './mapping';

/**
 * How far a pull has got, as a keyset rather than a timestamp alone.
 *
 * `updatedAt` on its own is not a unique ordering: `createMany` stamps every
 * row it writes with one millisecond, so an import of a hundred transactions
 * produces a hundred rows that tie. If a page boundary lands inside a tie, a
 * cursor of `updated_at > last` skips the rest of it — silently, and only for
 * the rows that happened to fall the wrong side. Carrying the id makes the
 * ordering total, so `(updated_at, id) > (last, lastId)` cannot skip anything.
 */
export interface PullCursor {
  updatedAt: number;
  id: string;
}

export interface SyncRemote {
  /** Upsert rows by id. Callers batch; this pushes exactly what it is given. */
  push(table: SyncedTable, rows: readonly SyncMeta[]): Promise<void>;
  /** Rows strictly after `after`, oldest first, at most `limit` of them. */
  pull(
    table: SyncedTable,
    after: PullCursor | null,
    limit: number,
  ): Promise<SyncMeta[]>;
}

/** Postgres rejects a push with a message worth showing; a fetch failure has none. */
function describeError(error: {message?: string; details?: string} | null): string {
  if (!error) return 'Unknown error.';
  const message = error.message ?? 'The request failed.';
  return error.details ? `${message} (${error.details})` : message;
}

export function createSupabaseRemote(
  client: SupabaseClient,
  userId: string,
): SyncRemote {
  return {
    async push(table, rows) {
      if (rows.length === 0) return;

      const payload = rows.map((row) => toRemoteRow(table, row, userId));
      const {error} = await client
        .from(REMOTE_TABLE[table])
        // Every row is sent whole, so the server copy becomes the client copy
        // rather than being patched toward it. The outbox records that a row
        // changed, never which fields did — see repo.ts.
        //
        // This is an unconditional upsert *as written*, but not as executed:
        // the `reject_stale_write` BEFORE UPDATE trigger drops any row whose
        // `updated_at` is not strictly newer than the stored one. That is what
        // stops a device that was offline for a week from overwriting a newer
        // edit simply by reconnecting last, and it is load-bearing — without
        // it two devices that edited the same row offline never converge. A
        // rejected row is not an error here: the pull that follows in the same
        // cycle brings back the version that won.
        .upsert(payload, {onConflict: 'id'});

      if (error) {
        throw new Error(`Could not save ${table}: ${describeError(error)}`);
      }
    },

    async pull(table, after, limit) {
      let query = client
        .from(REMOTE_TABLE[table])
        .select('*')
        // Redundant against RLS, which already restricts the rows to this
        // user. Present so the query can use the (user_id, updated_at, id)
        // index directly rather than relying on the planner seeing through
        // the policy.
        .eq('user_id', userId);

      if (after) {
        const at = new Date(after.updatedAt).toISOString();
        // The keyset comparison, spelled out because PostgREST has no row
        // constructor: strictly later, or the same instant and a later id.
        query = query.or(
          `updated_at.gt."${at}",and(updated_at.eq."${at}",id.gt."${after.id}")`,
        );
      }

      const {data, error} = await query
        .order('updated_at', {ascending: true})
        .order('id', {ascending: true})
        .limit(limit);

      if (error) {
        throw new Error(`Could not read ${table}: ${describeError(error)}`);
      }

      return (data ?? []).map((row) => fromRemoteRow<SyncMeta>(table, row as RemoteRow));
    },
  };
}
