/**
 * Export and import of the whole local database.
 *
 * This is the escape hatch, and PROGRESS.md §7 leans on it: the old Android
 * app stays installed until Phase 6's importer is verified, which is only
 * reasonable advice if the data here can also be got *out*. It also covers
 * the case sync will not — moving to a new device before Phase 5 exists.
 *
 * Two deliberate choices:
 *
 *   - **JSON, not CSV.** The old app exported `.xls` and lost every
 *     relationship in the process — accounts and categories referenced by
 *     name, no ids, so re-importing could only guess. This carries the real
 *     rows, ids and all, which is what makes a restore lossless rather than
 *     approximate.
 *   - **Soft-deleted rows are included.** They are part of the state: leaving
 *     them out would silently empty the trash, and would resurrect anything a
 *     peer had deleted the moment sync compared the two.
 *
 * The `outbox` table is excluded. It is device-local push bookkeeping, and
 * restoring another device's queue would try to push rows this device never
 * changed.
 */
import type {FinanceDatabase} from './db';
import {db as defaultDb} from './db';
import {SYNCED_TABLES, type SyncedTable} from './types';

/** Bumped only when the shape changes in a way an older reader cannot handle. */
export const BACKUP_FORMAT_VERSION = 1;

export interface BackupFile {
  format: 'finance-tracker-backup';
  version: number;
  exportedAt: string;
  /** Rows per table, including soft-deleted ones. */
  tables: Partial<Record<SyncedTable, unknown[]>>;
}

export async function exportBackup(
  database: FinanceDatabase = defaultDb,
): Promise<BackupFile> {
  const tables: Partial<Record<SyncedTable, unknown[]>> = {};

  for (const name of SYNCED_TABLES) {
    tables[name] = await database[name].toArray();
  }

  return {
    format: 'finance-tracker-backup',
    version: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    tables,
  };
}

export interface BackupSummary {
  exportedAt: string;
  counts: Record<string, number>;
  total: number;
}

/**
 * Validate a parsed file and describe what it holds, without writing anything.
 *
 * Separate from `importBackup` so the UI can show "1 account, 104
 * transactions, 15 categories" and let the user decide *before* the database
 * is touched. Restoring blind over real financial data is not a thing to make
 * easy.
 */
export function summarizeBackup(parsed: unknown): BackupSummary {
  const file = parsed as Partial<BackupFile> | null;

  if (!file || typeof file !== 'object' || file.format !== 'finance-tracker-backup') {
    throw new Error('That does not look like a Finance Tracker backup.');
  }
  if (typeof file.version !== 'number' || file.version > BACKUP_FORMAT_VERSION) {
    throw new Error(
      `That backup was written by a newer version of the app (format ${String(file.version)}).`,
    );
  }
  if (!file.tables || typeof file.tables !== 'object') {
    throw new Error('That backup has no data in it.');
  }

  const counts: Record<string, number> = {};
  let total = 0;

  for (const name of SYNCED_TABLES) {
    const rows = file.tables[name];
    const count = Array.isArray(rows) ? rows.length : 0;
    counts[name] = count;
    total += count;
  }

  return {
    exportedAt: typeof file.exportedAt === 'string' ? file.exportedAt : 'unknown',
    counts,
    total,
  };
}

export type ImportMode =
  /** Wipe each table first. The backup becomes the whole truth. */
  | 'replace'
  /** Keep existing rows; the backup wins on id collisions. */
  | 'merge';

/**
 * Write a backup into the database.
 *
 * One transaction across every table, so a failure part way through does not
 * leave half a restore behind — the failure mode that would be hardest to
 * notice and impossible to unpick.
 *
 * Rows are written with `bulkPut` rather than through the repositories, on
 * purpose: this restores rows *as they were*, including their original
 * `updatedAt`. Going through `repo.create` would re-stamp every row with the
 * time of the restore, which would make a restored copy beat a newer remote
 * row under last-write-wins.
 */
export async function importBackup(
  parsed: unknown,
  mode: ImportMode,
  database: FinanceDatabase = defaultDb,
): Promise<BackupSummary> {
  const summary = summarizeBackup(parsed);
  const file = parsed as BackupFile;

  await database.transaction(
    'rw',
    SYNCED_TABLES.map((name) => database[name]),
    async () => {
      for (const name of SYNCED_TABLES) {
        const rows = file.tables[name];
        if (!Array.isArray(rows)) continue;

        // `database[name]` is a union of eight differently-typed tables, and
        // TypeScript cannot pick a single `bulkPut` overload across it. The
        // restore is genuinely schema-agnostic — it writes rows back exactly
        // as they came out — so the operation is narrowed rather than the row
        // type.
        const table = database[name] as unknown as {
          clear(): Promise<void>;
          bulkPut(rows: unknown[]): Promise<unknown>;
        };

        if (mode === 'replace') await table.clear();
        if (rows.length > 0) await table.bulkPut(rows);
      }
    },
  );

  return summary;
}

/** Parse text into a backup, with a readable error rather than a raw JSON one. */
export function parseBackupText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
}
