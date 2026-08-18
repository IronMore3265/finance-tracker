/**
 * Push, pull, and the rules for who wins.
 *
 * The shape of a cycle is deliberately boring: drain the outbox, then pull
 * everything newer than the cursor, then stop. In that order, because pushing
 * first means the server has seen this device's edits before this device asks
 * what the truth is — the reverse order would resolve a conflict against a
 * copy of the row the server had not been told about yet.
 *
 * Three invariants hold throughout, and each one is a bug that would be very
 * hard to see if it broke:
 *
 *   1. **A pull never enqueues.** Pulled rows are written with `bulkPut`, not
 *      through the repositories, so applying a remote change does not queue it
 *      to be pushed straight back. Going through `repo.update` would also
 *      re-stamp `updatedAt` with the local clock, which is the field the whole
 *      conflict resolution compares on.
 *   2. **An outbox entry is only cleared if it is still the one that was
 *      pushed.** `queuedAt` is re-checked after the network call: if the row
 *      was edited again while the push was in flight, the entry stays and the
 *      newer version goes next cycle. Deleting unconditionally would drop that
 *      edit on the floor.
 *   3. **Nothing here deletes local data.** `deletedAt` replicates as an
 *      ordinary field, so a delete on another device arrives as an update.
 *      Actual removal is only ever the user emptying the trash, which is
 *      local-only by design (see `repo.purge`).
 */
import type {FinanceDatabase} from '../db/db';
import {db as defaultDb} from '../db/db';
import {getMeta, setMeta} from '../db/meta';
import {SYNCED_TABLES, type OutboxEntry, type SyncedTable, type SyncMeta} from '../db/types';
import type {PullCursor, SyncRemote} from './remote';

/** Which account this device's rows belong to. */
export const SYNC_USER_KEY = 'sync.userId';
/** When the last fully successful cycle finished, as epoch ms. */
export const LAST_SYNCED_AT_KEY = 'sync.lastSyncedAt';

export function cursorKey(table: SyncedTable): string {
  return `sync.cursor.${table}`;
}

/**
 * Rows per request.
 *
 * Sized for the request, not the dataset: this app has hundreds of rows, so
 * the page size only ever matters on a first sync or a restore. Small enough
 * that a failure costs one retry of a modest payload, large enough that a
 * hundred-row import is a single round trip.
 */
const DEFAULT_PAGE_SIZE = 500;

export interface SyncResult {
  pushed: number;
  pulled: number;
  /** Of the rows pulled, how many actually won and were written. */
  applied: number;
  finishedAt: number;
}

/**
 * Thrown when this device's data belongs to a different account.
 *
 * Signing in as someone else on a device that already holds synced rows would
 * push those rows into the new account — quietly merging two people's
 * finances, in a direction no undo reaches. Refusing is the only safe answer
 * this layer can give on its own; clearing the local database or restoring a
 * backup are both decisions for the person at the keyboard.
 */
export class SyncAccountMismatchError extends Error {
  constructor(
    readonly stampedUserId: string,
    readonly attemptedUserId: string,
  ) {
    super(
      'This device holds data synced to a different account. Sign in with the ' +
        'original account, or export a backup and reset this device first.',
    );
    this.name = 'SyncAccountMismatchError';
  }
}

/**
 * Does the remote copy replace the local one?
 *
 * Strictly newer wins. A tie keeps the local row, which is the choice that
 * settles: rewriting a row with an identical `updatedAt` would produce a new
 * outbox entry on every cycle for as long as both sides disagreed, so a tie
 * would sync forever rather than converge. Two devices editing the same row in
 * the same millisecond is the only case this decides differently from "newest
 * wins", and it resolves the moment either side is edited again.
 */
export function remoteWins(local: SyncMeta | undefined, remote: SyncMeta): boolean {
  if (!local) return true;
  return remote.updatedAt > local.updatedAt;
}

/** The eight entity tables, narrowed to the operations sync performs. */
function rowsOf(database: FinanceDatabase, table: SyncedTable) {
  return database[table] as unknown as {
    get(id: string): Promise<SyncMeta | undefined>;
    bulkGet(ids: readonly string[]): Promise<(SyncMeta | undefined)[]>;
    put(row: SyncMeta): Promise<unknown>;
    bulkPut(rows: readonly SyncMeta[]): Promise<unknown>;
  };
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/**
 * Push everything queued for one table.
 *
 * Returns the number of rows the server accepted. Entries whose row has since
 * been purged are dropped rather than retried forever — there is nothing left
 * to send, and `purge` is local-only by design.
 */
async function pushTable(
  database: FinanceDatabase,
  remote: SyncRemote,
  userId: string,
  table: SyncedTable,
  entries: readonly OutboxEntry[],
  pageSize: number,
): Promise<number> {
  const rows = rowsOf(database, table);
  let pushed = 0;

  for (const batch of chunk(entries, pageSize)) {
    const found: SyncMeta[] = [];

    for (const entry of batch) {
      const row = await rows.get(entry.rowId);
      // A row that is gone was purged from the trash after being queued.
      // There is nothing to send, and its entry is cleared below with the
      // rest — retrying it forever would block the queue on a row that no
      // longer exists.
      if (row) found.push(row);
    }

    await remote.push(table, found);
    pushed += found.length;

    // Clearing the queue is a separate transaction from the network call on
    // purpose: holding a Dexie transaction open across an await that leaves
    // the event loop is what makes IndexedDB transactions commit early and
    // then throw on their next operation.
    await database.transaction('rw', database[table], database.outbox, async () => {
      for (const entry of batch) {
        if (entry.seq === undefined) continue;

        const current = await database.outbox.get(entry.seq);
        // Re-queued while the push was in flight: leave it for the next cycle.
        if (!current || current.queuedAt !== entry.queuedAt) continue;
        await database.outbox.delete(entry.seq);
      }

      // Record which account now holds these rows. Written field-by-field
      // rather than through the repository so `updatedAt` is untouched —
      // stamping it here would mark every row as changed the instant it was
      // successfully pushed, and sync would never reach an empty queue.
      for (const row of found) {
        if (row.userId === userId) continue;
        const current = await rows.get(row.id);
        if (current && current.updatedAt === row.updatedAt) {
          await rows.put({...current, userId});
        }
      }
    });
  }

  return pushed;
}

/** Apply one page of pulled rows, keeping whichever copy is newer. */
async function applyPulled(
  database: FinanceDatabase,
  table: SyncedTable,
  page: readonly SyncMeta[],
): Promise<number> {
  const rows = rowsOf(database, table);

  return database.transaction('rw', database[table], async () => {
    const locals = await rows.bulkGet(page.map((row) => row.id));
    const winners = page.filter((row, index) => remoteWins(locals[index], row));
    if (winners.length > 0) await rows.bulkPut(winners);
    return winners.length;
  });
}

async function pullTable(
  database: FinanceDatabase,
  remote: SyncRemote,
  table: SyncedTable,
  pageSize: number,
): Promise<{pulled: number; applied: number}> {
  let cursor = (await getMeta<PullCursor>(cursorKey(table), database)) ?? null;
  let pulled = 0;
  let applied = 0;

  for (;;) {
    const page = await remote.pull(table, cursor, pageSize);
    if (page.length === 0) break;

    pulled += page.length;
    applied += await applyPulled(database, table, page);

    const last = page[page.length - 1];
    if (!last) break;
    cursor = {updatedAt: last.updatedAt, id: last.id};
    // Saved per page rather than per table, so a connection dropping halfway
    // through a first sync resumes where it stopped instead of starting over.
    await setMeta(cursorKey(table), cursor, database);

    if (page.length < pageSize) break;
  }

  return {pulled, applied};
}

/**
 * Stamp the account this device syncs with, or refuse if it is already
 * stamped with a different one.
 */
async function assertSameAccount(
  database: FinanceDatabase,
  userId: string,
): Promise<void> {
  const stamped = await getMeta<string>(SYNC_USER_KEY, database);

  if (stamped === undefined) {
    await setMeta(SYNC_USER_KEY, userId, database);
    return;
  }

  if (stamped !== userId) throw new SyncAccountMismatchError(stamped, userId);
}

/**
 * One full cycle.
 *
 * Not re-entrant — two cycles running at once would both drain the outbox and
 * push the same rows twice. The caller (`sync-context.tsx`) owns that guard,
 * because it is also the thing that knows a second cycle was asked for and
 * should run once this one finishes.
 */
export async function runSync(options: {
  remote: SyncRemote;
  userId: string;
  database?: FinanceDatabase;
  /** Rows per request. Overridden only by tests, to exercise paging. */
  pageSize?: number;
}): Promise<SyncResult> {
  const database = options.database ?? defaultDb;
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const {remote, userId} = options;

  await assertSameAccount(database, userId);

  // Read once and group, rather than a query per table: the outbox holds only
  // what is pending, so it is empty on most cycles and small on the rest.
  const queued = await database.outbox.orderBy('queuedAt').toArray();
  const byTable = new Map<SyncedTable, OutboxEntry[]>();
  for (const entry of queued) {
    const existing = byTable.get(entry.table);
    if (existing) existing.push(entry);
    else byTable.set(entry.table, [entry]);
  }

  let pushed = 0;
  let pulled = 0;
  let applied = 0;

  // Tables in dependency order. Nothing enforces it — there are no foreign
  // keys between these tables on the server, deliberately (see the migration)
  // — but a partial sync that stops halfway leaves a more coherent remote
  // state if accounts and categories got there before the transactions
  // referring to them.
  for (const table of SYNCED_TABLES) {
    const entries = byTable.get(table);
    if (entries && entries.length > 0) {
      pushed += await pushTable(database, remote, userId, table, entries, pageSize);
    }
  }

  for (const table of SYNCED_TABLES) {
    const result = await pullTable(database, remote, table, pageSize);
    pulled += result.pulled;
    applied += result.applied;
  }

  const finishedAt = Date.now();
  await setMeta(LAST_SYNCED_AT_KEY, finishedAt, database);

  return {pushed, pulled, applied, finishedAt};
}
