/**
 * Domain entities.
 *
 * Ported from the old app's Room entities, with three deliberate changes:
 *
 *  1. Accounts store `openingBalance`, not a live `balance`. The old app
 *     mutated a denormalized balance on every write, so any failed or partial
 *     write desynced it from the ledger permanently. Current balance is
 *     derived from transactions instead (see domain/balances.ts).
 *  2. Category is a real entity with an id, not a bare string. Required for
 *     per-category budgets and for rename/recolor/merge.
 *  3. `isSynced` / `sheetRow` are gone — vestigial Google Sheets fields,
 *     replaced by the sync engine's outbox.
 */

/**
 * Fields every syncable row carries.
 *
 * These three are what make cloud sync addable later without a migration, so
 * they are not optional on any entity:
 *   - `id` is a client-generated UUIDv7, so two offline devices never collide
 *     and rows still sort by creation time.
 *   - `updatedAt` drives last-write-wins conflict resolution.
 *   - `deletedAt` makes deletes replicable (and undoable). A hard delete on
 *     one device would simply be resurrected by the next pull from another.
 */
export type SyncMeta = {
  id: string;
  createdAt: number;
  updatedAt: number;
  /** Epoch ms when soft-deleted; null when live. */
  deletedAt: number | null;
  /** Supabase auth user id. Null until the row has been synced. */
  userId: string | null;
};

export type TransactionType = 'EXPENSE' | 'INCOME' | 'TRANSFER';
export type CategoryKind = 'EXPENSE' | 'INCOME' | 'BOTH';
export type AccountIcon = 'wallet' | 'bank' | 'card' | 'savings';
export type IntervalType = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';
export type DebtType = 'DEBT' | 'DUE';
export type BudgetPeriod = 'WEEK' | 'MONTH' | 'YEAR' | 'CUSTOM';

export type Account = SyncMeta & {
  name: string;
  /** Balance before the first recorded transaction. */
  openingBalance: number;
  colorHex: string;
  icon: AccountIcon;
  /** ISO 4217 code. The old app stored a bare symbol; a code is unambiguous. */
  currency: string;
  /** When false, excluded from the dashboard's total balance. */
  includeInBalance: boolean;
  displayOrder: number;
};

export type Category = SyncMeta & {
  name: string;
  /** Lucide icon name; the theme ships lucide-react. */
  icon: string;
  colorHex: string;
  kind: CategoryKind;
  displayOrder: number;
  /** Seeded on first run. Can be renamed or merged, but not left un-restorable. */
  isDefault: boolean;
};

export type Transaction = SyncMeta & {
  amount: number;
  description: string;
  categoryId: string | null;
  /** Epoch ms. */
  date: number;
  type: TransactionType;
  accountId: string | null;
  /** Destination wallet; set only when type is TRANSFER. */
  toAccountId: string | null;
  tags: string[];
  /** Set when this row was materialized from a planned transaction. */
  plannedId: string | null;
  /** Which occurrence of `plannedId` this represents, as epoch ms. */
  occurrenceDate: number | null;
};

/** The recurrence *rule*. Individual occurrences live in `transactions`. */
export type PlannedTransaction = SyncMeta & {
  title: string;
  amount: number;
  categoryId: string | null;
  type: Exclude<TransactionType, 'TRANSFER'>;
  accountId: string | null;
  startDate: number;
  intervalType: IntervalType;
  /** Fire every N intervals. */
  intervalN: number;
  oneTime: boolean;
  nextDueDate: number;
  /** Set when a series is split by a "this and all future" edit. */
  endDate: number | null;
  isActive: boolean;
  description: string;
};

/**
 * A single occurrence that departs from its series — the thing the old app
 * could not express, and the reason recurring entries could not be corrected
 * after the fact.
 */
export type PlannedException = SyncMeta & {
  plannedId: string;
  /** Which occurrence this applies to, as epoch ms. */
  occurrenceDate: number;
  action: 'SKIP' | 'OVERRIDE';
  /** Field-level overrides for OVERRIDE; ignored for SKIP. */
  overrides: Partial<
    Pick<
      PlannedTransaction,
      'title' | 'amount' | 'categoryId' | 'accountId' | 'description'
    >
  > & {occurrenceDate?: number};
};

export type Debt = SyncMeta & {
  personName: string;
  /** Original principal. Outstanding balance is derived from debtPayments. */
  amount: number;
  description: string;
  date: number;
  dueDate: number | null;
  /** DEBT = you owe them. DUE = they owe you. */
  type: DebtType;
  isCleared: boolean;
  accountId: string | null;
};

export type DebtPayment = SyncMeta & {
  debtId: string;
  amount: number;
  date: number;
  /** Set when the settlement was also posted to the ledger. */
  transactionId: string | null;
};

export type Budget = SyncMeta & {
  /** Null means an overall budget rather than a per-category one. */
  categoryId: string | null;
  amount: number;
  period: BudgetPeriod;
  startDate: number;
  /** Only meaningful when period is CUSTOM. */
  endDate: number | null;
  isActive: boolean;
};

/** Names of the tables that participate in sync. */
export const SYNCED_TABLES = [
  'accounts',
  'categories',
  'transactions',
  'plannedTransactions',
  'plannedExceptions',
  'debts',
  'debtPayments',
  'budgets',
] as const;

export type SyncedTable = (typeof SYNCED_TABLES)[number];

/**
 * Pending local change awaiting push. Deliberately not a SyncMeta row — the
 * outbox is device-local bookkeeping and must never itself be synced.
 */
export type OutboxEntry = {
  /** Auto-incremented; the only non-UUID key in the database. */
  seq?: number;
  table: SyncedTable;
  rowId: string;
  /** When the local change happened, for ordering pushes. */
  queuedAt: number;
};

/** Single-row table holding device-local settings and sync bookkeeping. */
export type AppMeta = {
  key: string;
  value: unknown;
};
