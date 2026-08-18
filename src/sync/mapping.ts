/**
 * Translation between the local row shape and the Postgres one.
 *
 * Two things differ across the boundary and nothing else does:
 *
 *   1. **Case.** Local rows are camelCase; the columns are snake_case. The
 *      conversion is mechanical, so it is *derived* rather than declared —
 *      there is no per-field table of `openingBalance -> opening_balance`
 *      pairs to mistype, and adding a field to `types.ts` needs no edit here
 *      beyond the timestamp question below.
 *   2. **Time.** Local rows hold epoch milliseconds, because that is what the
 *      whole domain layer computes in. The columns are `timestamptz`, because
 *      a replica you cannot read in the dashboard is a replica you cannot
 *      debug. `Date.parse(new Date(ms).toISOString())` returns `ms` exactly,
 *      so the round trip is lossless at millisecond precision — which is the
 *      precision last-write-wins compares at.
 *
 * Which fields are timestamps is the only thing that must be stated by hand,
 * and getting it wrong is caught by the round-trip tests rather than showing
 * up as a date in 1970.
 *
 * `overrides` on a planned exception is `jsonb` and passes through untouched,
 * camelCase keys and epoch-millisecond values and all. It is an opaque blob to
 * Postgres by design: its shape is a client concern, and converting inside it
 * would mean the server had opinions about a field the server never reads.
 */
import type {SyncedTable, SyncMeta} from '../db/types';

/** A row as PostgREST returns it: snake_case columns, ISO-8601 timestamps. */
export type RemoteRow = Record<string, unknown>;

/**
 * Timestamp fields per table, beyond the three every row carries.
 *
 * Listed by their *local* names — this map is consulted before the case
 * conversion, so it reads against `types.ts` rather than against the schema.
 */
const TIMESTAMP_FIELDS: Record<SyncedTable, readonly string[]> = {
  accounts: [],
  categories: [],
  transactions: ['date', 'occurrenceDate'],
  plannedTransactions: ['startDate', 'nextDueDate', 'endDate'],
  plannedExceptions: ['occurrenceDate'],
  debts: ['date', 'dueDate'],
  debtPayments: ['date'],
  budgets: ['startDate', 'endDate'],
};

/** Carried by every syncable row; handled once rather than eight times. */
const META_TIMESTAMP_FIELDS = ['createdAt', 'updatedAt', 'deletedAt'] as const;

/** The Postgres table backing each local table. */
export const REMOTE_TABLE: Record<SyncedTable, string> = {
  accounts: 'accounts',
  categories: 'categories',
  transactions: 'transactions',
  plannedTransactions: 'planned_transactions',
  plannedExceptions: 'planned_exceptions',
  debts: 'debts',
  debtPayments: 'debt_payments',
  budgets: 'budgets',
};

export function camelToSnake(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

export function snakeToCamel(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());
}

function timestampFieldsFor(table: SyncedTable): Set<string> {
  return new Set<string>([...META_TIMESTAMP_FIELDS, ...(TIMESTAMP_FIELDS[table] ?? [])]);
}

/**
 * Local row -> row ready to upsert.
 *
 * `userId` is required rather than read off the row: a row that has never
 * synced carries `userId: null`, and pushing that null would be rejected by
 * the `not null` column before RLS ever got a chance to reject it by policy.
 * Passing the session's user id makes ownership explicit at the one place
 * that knows it.
 */
export function toRemoteRow<T extends SyncMeta>(
  table: SyncedTable,
  row: T,
  userId: string,
): RemoteRow {
  const timestamps = timestampFieldsFor(table);
  const remote: RemoteRow = {};

  for (const [key, value] of Object.entries(row)) {
    const column = camelToSnake(key);
    remote[column] =
      timestamps.has(key) && typeof value === 'number'
        ? new Date(value).toISOString()
        : value;
  }

  remote['user_id'] = userId;
  return remote;
}

/**
 * Row as fetched -> local row.
 *
 * Deliberately not validating: both sides of this boundary are generated from
 * the same `types.ts`, the columns are `not null` where the type is, and the
 * enum-ish ones carry check constraints. A row that fails those never reaches
 * here because the push that would have written it was rejected.
 */
export function fromRemoteRow<T extends SyncMeta>(
  table: SyncedTable,
  remote: RemoteRow,
): T {
  const timestamps = timestampFieldsFor(table);
  const row: Record<string, unknown> = {};

  for (const [column, value] of Object.entries(remote)) {
    const key = snakeToCamel(column);
    row[key] =
      timestamps.has(key) && typeof value === 'string' ? Date.parse(value) : value;
  }

  return row as T;
}
