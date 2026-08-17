/**
 * The write layer.
 *
 * Every mutation goes through here so that three things are guaranteed rather
 * than remembered:
 *
 *   1. `updatedAt` is stamped — it is what last-write-wins compares on, so a
 *      write that forgets it would lose to a stale remote row.
 *   2. An outbox entry is queued — a write that skips it is silently never
 *      synced, which is the worst possible failure mode (looks fine locally,
 *      missing everywhere else).
 *   3. Deletes are soft — a hard delete would just be resurrected by the next
 *      pull from another device, and could not be undone.
 *
 * Both steps happen inside one Dexie transaction, so a row can never be
 * written without its outbox entry or vice versa.
 */
import type {FinanceDatabase} from './db';
import {db as defaultDb} from './db';
import {newId, now} from './ids';
import type {SyncedTable, SyncMeta} from './types';

/** Fields the caller supplies; sync bookkeeping is filled in here. */
export type NewRow<T extends SyncMeta> = Omit<T, keyof SyncMeta> &
  Partial<Pick<SyncMeta, 'id' | 'createdAt'>>;

/** Fields a caller may change. Sync metadata is not among them. */
export type RowPatch<T extends SyncMeta> = Partial<Omit<T, keyof SyncMeta>>;

function table<T extends SyncMeta>(database: FinanceDatabase, name: SyncedTable) {
  // The per-table types are structurally compatible for these operations; the
  // cast keeps one generic implementation instead of eight near-identical ones.
  return database[name] as unknown as {
    get(id: string): Promise<T | undefined>;
    put(row: T): Promise<string>;
    bulkPut(rows: T[]): Promise<unknown>;
    toArray(): Promise<T[]>;
  };
}

/**
 * Queue a row for push, collapsing repeated edits.
 *
 * The outbox records *that* a row changed, not what changed, so the pusher
 * always sends the current state. Editing one row ten times offline therefore
 * costs one entry and one push, not ten.
 */
async function enqueue(
  database: FinanceDatabase,
  tableName: SyncedTable,
  rowId: string,
  at: number,
): Promise<void> {
  const existing = await database.outbox
    .where('[table+rowId]')
    .equals([tableName, rowId])
    .first();

  if (existing?.seq !== undefined) {
    await database.outbox.update(existing.seq, {queuedAt: at});
    return;
  }

  await database.outbox.add({table: tableName, rowId, queuedAt: at});
}

export function createRepository<T extends SyncMeta>(
  tableName: SyncedTable,
  database: FinanceDatabase = defaultDb,
) {
  const rows = () => table<T>(database, tableName);

  /** Run `fn` with both the entity table and the outbox in transaction scope. */
  const write = <R>(fn: () => Promise<R>): Promise<R> =>
    database.transaction('rw', database[tableName], database.outbox, fn);

  return {
    async get(id: string): Promise<T | undefined> {
      const row = await rows().get(id);
      // Soft-deleted rows are invisible to normal reads; use getIncludingDeleted.
      return row && row.deletedAt === null ? row : undefined;
    },

    async getIncludingDeleted(id: string): Promise<T | undefined> {
      return rows().get(id);
    },

    /** Live rows only. */
    async all(): Promise<T[]> {
      const all = await rows().toArray();
      return all.filter((row) => row.deletedAt === null);
    },

    /** Soft-deleted rows, for the trash view. */
    async deleted(): Promise<T[]> {
      const all = await rows().toArray();
      return all.filter((row) => row.deletedAt !== null);
    },

    async create(data: NewRow<T>): Promise<T> {
      const at = now();
      const row = {
        ...data,
        id: data.id ?? newId(),
        createdAt: data.createdAt ?? at,
        updatedAt: at,
        deletedAt: null,
        userId: null,
      } as unknown as T;

      await write(async () => {
        await rows().put(row);
        await enqueue(database, tableName, row.id, at);
      });

      return row;
    },

    async createMany(items: readonly NewRow<T>[]): Promise<T[]> {
      const at = now();
      const built = items.map(
        (data) =>
          ({
            ...data,
            id: data.id ?? newId(),
            createdAt: data.createdAt ?? at,
            updatedAt: at,
            deletedAt: null,
            userId: null,
          }) as unknown as T,
      );

      await write(async () => {
        await rows().bulkPut(built);
        for (const row of built) {
          await enqueue(database, tableName, row.id, at);
        }
      });

      return built;
    },

    /**
     * Patch a live row. Returns undefined if the row is missing or deleted —
     * editing a deleted row would silently resurrect it.
     */
    async update(id: string, patch: RowPatch<T>): Promise<T | undefined> {
      return write(async () => {
        const existing = await rows().get(id);
        if (!existing || existing.deletedAt !== null) return undefined;

        const at = now();
        const updated = {...existing, ...patch, updatedAt: at} as T;
        await rows().put(updated);
        await enqueue(database, tableName, id, at);
        return updated;
      });
    },

    /** Soft delete. Reversible via restore, and replicable to other devices. */
    async softDelete(id: string): Promise<boolean> {
      return write(async () => {
        const existing = await rows().get(id);
        if (!existing || existing.deletedAt !== null) return false;

        const at = now();
        await rows().put({...existing, deletedAt: at, updatedAt: at});
        await enqueue(database, tableName, id, at);
        return true;
      });
    },

    async softDeleteMany(ids: readonly string[]): Promise<number> {
      return write(async () => {
        const at = now();
        let count = 0;

        for (const id of ids) {
          const existing = await rows().get(id);
          if (!existing || existing.deletedAt !== null) continue;
          await rows().put({...existing, deletedAt: at, updatedAt: at});
          await enqueue(database, tableName, id, at);
          count += 1;
        }

        return count;
      });
    },

    /** Undo a soft delete. Backs the undo toast and the trash view. */
    async restore(id: string): Promise<boolean> {
      return write(async () => {
        const existing = await rows().get(id);
        if (!existing || existing.deletedAt === null) return false;

        const at = now();
        await rows().put({...existing, deletedAt: null, updatedAt: at});
        await enqueue(database, tableName, id, at);
        return true;
      });
    },

    async restoreMany(ids: readonly string[]): Promise<number> {
      return write(async () => {
        const at = now();
        let count = 0;

        for (const id of ids) {
          const existing = await rows().get(id);
          if (!existing || existing.deletedAt === null) continue;
          await rows().put({...existing, deletedAt: null, updatedAt: at});
          await enqueue(database, tableName, id, at);
          count += 1;
        }

        return count;
      });
    },

    /**
     * Permanent removal, for emptying the trash.
     *
     * Deliberately does NOT enqueue: there is no way to express "forget this
     * row" to peers without a tombstone protocol, so purging is local-only and
     * a peer that still holds the row may push it back. Purge only rows whose
     * soft delete has already been pushed.
     */
    async purge(id: string): Promise<void> {
      await database.transaction('rw', database[tableName], async () => {
        await database[tableName].delete(id as never);
      });
    },
  };
}

export type Repository<T extends SyncMeta> = ReturnType<typeof createRepository<T>>;
