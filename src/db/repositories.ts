/**
 * Typed repository instances, one per table.
 *
 * Features import from here rather than constructing repositories themselves,
 * so every write in the app shares the same sync and soft-delete guarantees.
 */
import {createRepository} from './repo';
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

export const accountsRepo = createRepository<Account>('accounts');
export const categoriesRepo = createRepository<Category>('categories');
export const transactionsRepo = createRepository<Transaction>('transactions');
export const plannedRepo = createRepository<PlannedTransaction>('plannedTransactions');
export const plannedExceptionsRepo =
  createRepository<PlannedException>('plannedExceptions');
export const debtsRepo = createRepository<Debt>('debts');
export const debtPaymentsRepo = createRepository<DebtPayment>('debtPayments');
export const budgetsRepo = createRepository<Budget>('budgets');

/**
 * The operations Trash needs, independent of what kind of row it is holding.
 *
 * Narrower than `Repository<T>` on purpose. A `Record<SyncedTable,
 * Repository<SyncMeta>>` does not typecheck — `update(patch: RowPatch<T>)` is
 * contravariant, so `Repository<Account>` is not a `Repository<SyncMeta>` —
 * and widening it with `any` would throw away the type safety everywhere else.
 * Trash only restores and purges, so that is all this asks for.
 */
export interface RestorableRepository {
  restore(id: string): Promise<boolean>;
  restoreMany(ids: readonly string[]): Promise<number>;
  purge(id: string): Promise<void>;
}

/** Every syncable table's repository, keyed the way `useTrash` reports rows. */
export const REPOSITORIES: Record<SyncedTable, RestorableRepository> = {
  accounts: accountsRepo,
  categories: categoriesRepo,
  transactions: transactionsRepo,
  plannedTransactions: plannedRepo,
  plannedExceptions: plannedExceptionsRepo,
  debts: debtsRepo,
  debtPayments: debtPaymentsRepo,
  budgets: budgetsRepo,
};
