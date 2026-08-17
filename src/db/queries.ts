/**
 * The read layer: live queries.
 *
 * `repo.ts` owns writes; this owns reads. Everything here goes through Dexie's
 * `useLiveQuery`, which re-runs the query when any row it touched changes, so
 * a screen never has to refetch or invalidate after a mutation — deleting a
 * transaction updates the list, the account balance, and the budget bar
 * without any of them knowing the delete happened.
 *
 * Two conventions hold throughout:
 *
 *   1. **Soft-deleted rows are filtered in memory, not by index.** `deletedAt`
 *      is `null` on live rows and IndexedDB cannot index null (see db.ts), so
 *      a `where('deletedAt')` query would return the exact opposite of what it
 *      looks like it returns.
 *   2. **`undefined` means "still loading", `[]` means "genuinely empty".**
 *      Collapsing the two would flash "No transactions yet" on every mount.
 *      Screens are expected to check.
 */
import {useLiveQuery} from 'dexie-react-hooks';
import {useMemo} from 'react';
import {computeBalances} from '../domain/balances';
import {db} from './db';
import type {
  Account,
  Budget,
  Category,
  Debt,
  DebtPayment,
  PlannedException,
  PlannedTransaction,
  SyncedTable,
  Transaction,
} from './types';

function live<T extends {deletedAt: number | null}>(rows: T[]): T[] {
  return rows.filter((row) => row.deletedAt === null);
}

/** Accounts in the user's chosen order. */
export function useAccounts(): Account[] | undefined {
  return useLiveQuery(async () => {
    const rows = await db.accounts.toArray();
    return live(rows).sort(byDisplayOrderThenName);
  }, []);
}

/** Categories in the user's chosen order. */
export function useCategories(): Category[] | undefined {
  return useLiveQuery(async () => {
    const rows = await db.categories.toArray();
    return live(rows).sort(byDisplayOrderThenName);
  }, []);
}

/**
 * Every live transaction, newest first.
 *
 * Deliberately unpaginated. At this app's scale (~100 rows, and a few thousand
 * after years of use) one array is cheaper than the bookkeeping a windowed
 * query needs, and it lets balances and totals be computed from a single pass
 * rather than re-querying per screen. Revisit when the ledger is actually
 * slow, not before — PROGRESS.md §7.
 */
export function useTransactions(): Transaction[] | undefined {
  return useLiveQuery(async () => {
    const rows = await db.transactions.toArray();
    return live(rows).sort(byDateDescending);
  }, []);
}

export function usePlannedRules(): PlannedTransaction[] | undefined {
  return useLiveQuery(async () => {
    const rows = await db.plannedTransactions.toArray();
    return live(rows).sort((a, b) => a.nextDueDate - b.nextDueDate);
  }, []);
}

export function usePlannedExceptions(): PlannedException[] | undefined {
  return useLiveQuery(async () => live(await db.plannedExceptions.toArray()), []);
}

export function useDebts(): Debt[] | undefined {
  return useLiveQuery(async () => {
    const rows = await db.debts.toArray();
    return live(rows).sort(byDateDescending);
  }, []);
}

export function useDebtPayments(): DebtPayment[] | undefined {
  return useLiveQuery(async () => live(await db.debtPayments.toArray()), []);
}

export function useBudgets(): Budget[] | undefined {
  return useLiveQuery(async () => live(await db.budgets.toArray()), []);
}

/**
 * Current balance per account id.
 *
 * Derived from the ledger on every change rather than stored — the whole
 * reason accounts carry `openingBalance` instead of `balance`. See
 * domain/balances.ts.
 */
export function useAccountBalances(
  accounts: readonly Account[] | undefined,
  transactions: readonly Transaction[] | undefined,
): Map<string, number> {
  return useMemo(() => {
    if (!accounts || !transactions) return new Map<string, number>();
    return computeBalances(accounts, transactions);
  }, [accounts, transactions]);
}

/** Id -> row, for resolving the foreign keys a transaction row carries. */
export function useById<T extends {id: string}>(
  rows: readonly T[] | undefined,
): Map<string, T> {
  return useMemo(() => {
    const map = new Map<string, T>();
    for (const row of rows ?? []) map.set(row.id, row);
    return map;
  }, [rows]);
}

/** Every distinct tag in use, for the tag filter and the tag input's suggestions. */
export function useAllTags(transactions: readonly Transaction[] | undefined): string[] {
  return useMemo(() => {
    const seen = new Set<string>();
    for (const txn of transactions ?? []) {
      for (const tag of txn.tags) seen.add(tag);
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [transactions]);
}

/**
 * Soft-deleted rows across every table, newest deletion first.
 *
 * One query rather than eight hooks so the Trash screen has a single loading
 * state and a single sort, and so "empty trash" can act on exactly what was
 * shown.
 */
export interface TrashEntry {
  table: SyncedTable;
  id: string;
  deletedAt: number;
  /** What the row was, e.g. "Coffee" or "Brac Bank". */
  label: string;
  /** Extra context under the label, e.g. an amount or a date. */
  detail: string;
}

export function useTrash(): TrashEntry[] | undefined {
  return useLiveQuery(async () => {
    const [accounts, categories, transactions, planned, debts, budgets] = await Promise.all([
      db.accounts.toArray(),
      db.categories.toArray(),
      db.transactions.toArray(),
      db.plannedTransactions.toArray(),
      db.debts.toArray(),
      db.budgets.toArray(),
    ]);

    const entries: TrashEntry[] = [];
    const deleted = <T extends {deletedAt: number | null}>(rows: T[]) =>
      rows.filter((row): row is T & {deletedAt: number} => row.deletedAt !== null);

    for (const row of deleted(accounts)) {
      entries.push({
        table: 'accounts',
        id: row.id,
        deletedAt: row.deletedAt,
        label: row.name,
        detail: 'Account',
      });
    }
    for (const row of deleted(categories)) {
      entries.push({
        table: 'categories',
        id: row.id,
        deletedAt: row.deletedAt,
        label: row.name,
        detail: 'Category',
      });
    }
    for (const row of deleted(transactions)) {
      entries.push({
        table: 'transactions',
        id: row.id,
        deletedAt: row.deletedAt,
        label: row.description || 'Untitled transaction',
        detail: 'Transaction',
      });
    }
    for (const row of deleted(planned)) {
      entries.push({
        table: 'plannedTransactions',
        id: row.id,
        deletedAt: row.deletedAt,
        label: row.title,
        detail: 'Planned',
      });
    }
    for (const row of deleted(debts)) {
      entries.push({
        table: 'debts',
        id: row.id,
        deletedAt: row.deletedAt,
        label: row.personName,
        detail: row.type === 'DEBT' ? 'Debt owed' : 'Money lent',
      });
    }
    for (const row of deleted(budgets)) {
      entries.push({
        table: 'budgets',
        id: row.id,
        deletedAt: row.deletedAt,
        label: 'Budget',
        detail: 'Budget',
      });
    }

    return entries.sort((a, b) => b.deletedAt - a.deletedAt);
  }, []);
}

function byDisplayOrderThenName<T extends {displayOrder: number; name: string}>(
  a: T,
  b: T,
): number {
  if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
  return a.name.localeCompare(b.name);
}

/**
 * Newest first, with `createdAt` as the tiebreak.
 *
 * Two transactions on the same day are common (the date carries no clock time
 * when it came from the importer), and without a stable second key their order
 * would flip between renders.
 */
function byDateDescending<T extends {date: number; createdAt: number}>(a: T, b: T): number {
  if (a.date !== b.date) return b.date - a.date;
  return b.createdAt - a.createdAt;
}
