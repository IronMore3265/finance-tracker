import Dexie, {type EntityTable} from 'dexie';
import type {
  Account,
  AppMeta,
  Budget,
  Category,
  Debt,
  DebtPayment,
  OutboxEntry,
  PlannedException,
  PlannedTransaction,
  Transaction,
} from './types';

/**
 * The local database — the source of truth for this app. Supabase is a
 * replica, not the primary, so every read path here must work with no
 * network and no signed-in user.
 *
 * A note on what is and is not indexed:
 *
 * IndexedDB only accepts number, string, Date, ArrayBuffer, and Array as key
 * values. Booleans and null are NOT valid keys — a row whose indexed field
 * holds one is silently omitted from that index rather than erroring. So
 * `isActive`, `isCleared`, and `deletedAt` are deliberately left unindexed and
 * filtered in memory instead. At this app's scale (hundreds of rows, not
 * millions) that costs nothing, and it avoids the classic bug where a
 * "deletedAt" index quietly returns only the deleted rows.
 */
export class FinanceDatabase extends Dexie {
  accounts!: EntityTable<Account, 'id'>;
  categories!: EntityTable<Category, 'id'>;
  transactions!: EntityTable<Transaction, 'id'>;
  plannedTransactions!: EntityTable<PlannedTransaction, 'id'>;
  plannedExceptions!: EntityTable<PlannedException, 'id'>;
  debts!: EntityTable<Debt, 'id'>;
  debtPayments!: EntityTable<DebtPayment, 'id'>;
  budgets!: EntityTable<Budget, 'id'>;
  outbox!: EntityTable<OutboxEntry, 'seq'>;
  meta!: EntityTable<AppMeta, 'key'>;

  constructor(name = 'finance-tracker') {
    super(name);

    this.version(1).stores({
      accounts: 'id, displayOrder, updatedAt',
      categories: 'id, displayOrder, kind, updatedAt',
      // *tags is a multi-entry index, so tag search hits an index rather than
      // scanning every row.
      transactions:
        'id, date, accountId, toAccountId, categoryId, type, plannedId, *tags, updatedAt',
      plannedTransactions: 'id, nextDueDate, startDate, updatedAt',
      // The compound index is what makes "does this occurrence have an
      // exception?" a point lookup instead of a scan.
      plannedExceptions: 'id, plannedId, [plannedId+occurrenceDate], updatedAt',
      debts: 'id, type, dueDate, date, updatedAt',
      debtPayments: 'id, debtId, date, updatedAt',
      budgets: 'id, categoryId, period, updatedAt',
      outbox: '++seq, [table+rowId], queuedAt',
      meta: 'key',
    });
  }
}

export const db = new FinanceDatabase();

/** Fresh instance for tests, so cases cannot leak state into each other. */
export function createTestDatabase(name: string): FinanceDatabase {
  return new FinanceDatabase(name);
}
