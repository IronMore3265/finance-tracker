/**
 * The device-local key/value store.
 *
 * `meta` is the one table that is deliberately never synced: it holds where
 * *this* device has got to, which is meaningless on any other device. Sync
 * cursors live here, and so does the stamp recording which account this
 * device's data belongs to.
 *
 * Everything sync writes is namespaced under `sync.`, and that prefix is a
 * contract rather than a convention — `clearSyncState` deletes by it. A
 * restore calls that (see backup.ts): the local rows have just been replaced
 * wholesale, so any record of what had already been pushed or pulled is
 * describing data that is no longer here.
 */
import type {FinanceDatabase} from './db';
import {db as defaultDb} from './db';

/** Keys under this prefix are sync bookkeeping and are cleared together. */
export const SYNC_META_PREFIX = 'sync.';

export async function getMeta<T>(
  key: string,
  database: FinanceDatabase = defaultDb,
): Promise<T | undefined> {
  const row = await database.meta.get(key);
  return row === undefined ? undefined : (row.value as T);
}

export async function setMeta(
  key: string,
  value: unknown,
  database: FinanceDatabase = defaultDb,
): Promise<void> {
  await database.meta.put({key, value});
}

export async function deleteMeta(
  key: string,
  database: FinanceDatabase = defaultDb,
): Promise<void> {
  await database.meta.delete(key);
}

/**
 * Forget everything this device knows about its relationship to the server.
 *
 * Cursors go, so the next pull starts from the beginning; the account stamp
 * goes, so the device re-identifies rather than refusing to sync as a
 * different user. Nothing in `transactions` or any other table is touched —
 * this only discards bookkeeping, and the worst case of getting it wrong is a
 * redundant full pull that last-write-wins then resolves to the same state.
 */
export async function clearSyncState(
  database: FinanceDatabase = defaultDb,
): Promise<void> {
  const keys = await database.meta.toCollection().primaryKeys();
  const syncKeys = keys.filter((key) => key.startsWith(SYNC_META_PREFIX));
  if (syncKeys.length > 0) await database.meta.bulkDelete(syncKeys);
}
