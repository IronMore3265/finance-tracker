/**
 * Operations that span more than one table.
 *
 * `repo.ts` guarantees per-row correctness — stamping, outbox, soft delete —
 * but each of its writes scopes a single table. The operations here touch
 * several at once and are only correct if they land together: a category merge
 * that reassigns half the transactions and then fails has silently split the
 * user's history across a category that no longer exists.
 *
 * So each function opens one Dexie transaction covering every table it will
 * touch, and calls the repositories inside it. Dexie joins a nested
 * transaction to its parent when the parent's scope is a superset, so the
 * repository writes keep their stamping and outbox behaviour while inheriting
 * this atomicity rather than committing independently.
 *
 * These live in `db/` rather than `domain/` because they write. `domain/` is
 * pure functions over arrays and must stay that way — it is what makes the
 * recurrence and budget maths testable without a database.
 */
import {indexOnOrAfter, occurrenceAt, splitSeriesAt} from '../domain/recurrence';
import type {FinanceDatabase} from './db';
import {db as defaultDb} from './db';
import {newId, now} from './ids';
import {createRepository} from './repo';
import type {
  Account,
  Budget,
  Category,
  Debt,
  DebtPayment,
  PlannedException,
  PlannedTransaction,
  Transaction,
} from './types';

/** Repositories bound to a specific database, so tests can pass their own. */
function repos(database: FinanceDatabase) {
  return {
    categories: createRepository<Category>('categories', database),
    transactions: createRepository<Transaction>('transactions', database),
    planned: createRepository<PlannedTransaction>('plannedTransactions', database),
    exceptions: createRepository<PlannedException>('plannedExceptions', database),
    budgets: createRepository<Budget>('budgets', database),
    debts: createRepository<Debt>('debts', database),
    payments: createRepository<DebtPayment>('debtPayments', database),
  };
}

export interface MergeCategoriesResult {
  transactionsMoved: number;
  plannedMoved: number;
  budgetsMoved: number;
  /** Budgets dropped because the target already had one — see below. */
  budgetsDiscarded: number;
}

/**
 * Fold `sourceId` into `targetId` and retire the source.
 *
 * The reason per-category budgets and analytics need categories to be a real
 * table rather than a string: renaming a string category leaves history
 * pointing at the old spelling, and there is no way to say "these two were
 * always the same thing".
 *
 * The source is **soft-deleted, not purged**, so the merge is visible in Trash
 * and reversible in the sense that matters — the row can come back. The
 * reassignment itself is not undone by restoring it; that would require
 * recording every moved id, which is what an import/export round trip is for.
 *
 * Budgets are the one asymmetric case. Two budgets for the same category is
 * not a state the rest of the app can render — `computeAllBudgetProgress`
 * would show two bars measuring the same spend. So a source budget is moved
 * only when the target has none; otherwise it is soft-deleted and the target's
 * own limit is kept, on the grounds that the category being merged *into* is
 * the one the user is keeping.
 */
export async function mergeCategories(
  sourceId: string,
  targetId: string,
  database: FinanceDatabase = defaultDb,
): Promise<MergeCategoriesResult> {
  if (sourceId === targetId) {
    throw new Error('Cannot merge a category into itself');
  }

  const repo = repos(database);

  // The array form rather than positional tables: Dexie's typed overloads stop
  // at five, and this needs six plus the outbox.
  return database.transaction(
    'rw',
    [
      database.categories,
      database.transactions,
      database.plannedTransactions,
      database.plannedExceptions,
      database.budgets,
      database.outbox,
    ],
    async () => {
      const source = await repo.categories.get(sourceId);
      const target = await repo.categories.get(targetId);
      if (!source) throw new Error('The category being merged no longer exists');
      if (!target) throw new Error('The destination category no longer exists');

      const result: MergeCategoriesResult = {
        transactionsMoved: 0,
        plannedMoved: 0,
        budgetsMoved: 0,
        budgetsDiscarded: 0,
      };

      for (const txn of await repo.transactions.all()) {
        if (txn.categoryId !== sourceId) continue;
        await repo.transactions.update(txn.id, {categoryId: targetId});
        result.transactionsMoved += 1;
      }

      for (const rule of await repo.planned.all()) {
        if (rule.categoryId !== sourceId) continue;
        await repo.planned.update(rule.id, {categoryId: targetId});
        result.plannedMoved += 1;
      }

      // Per-occurrence overrides carry their own categoryId. Missing these
      // would leave a single occurrence pointing at a deleted category.
      for (const exception of await repo.exceptions.all()) {
        if (exception.overrides.categoryId !== sourceId) continue;
        await repo.exceptions.update(exception.id, {
          overrides: {...exception.overrides, categoryId: targetId},
        });
      }

      const budgets = await repo.budgets.all();
      const targetHasBudget = budgets.some(
        (budget) => budget.categoryId === targetId && budget.isActive,
      );

      for (const budget of budgets) {
        if (budget.categoryId !== sourceId) continue;

        if (targetHasBudget) {
          await repo.budgets.softDelete(budget.id);
          result.budgetsDiscarded += 1;
        } else {
          await repo.budgets.update(budget.id, {categoryId: targetId});
          result.budgetsMoved += 1;
        }
      }

      await repo.categories.softDelete(sourceId);
      return result;
    },
  );
}

/**
 * Reorder categories or accounts by rewriting `displayOrder` across the list.
 *
 * Takes the whole ordered list rather than a (from, to) pair so the result is
 * idempotent and cannot leave gaps or ties — a sparse order that ties two rows
 * would make their relative position depend on the name tiebreak, which looks
 * like the reorder silently failed.
 */
export async function applyDisplayOrder(
  table: 'categories' | 'accounts',
  orderedIds: readonly string[],
  database: FinanceDatabase = defaultDb,
): Promise<void> {
  // Typed on the field being written rather than on either entity: both
  // Account and Category carry `displayOrder`, and claiming this is a
  // `Repository<Category>` while handing it accounts would be a lie the
  // compiler happens not to catch.
  const repo = createRepository<Account & Category>(table, database);

  await database.transaction('rw', database[table], database.outbox, async () => {
    for (const [index, id] of orderedIds.entries()) {
      const row = await repo.get(id);
      if (!row || row.displayOrder === index) continue;
      await repo.update(id, {displayOrder: index});
    }
  });
}

/**
 * Post a planned occurrence to the ledger.
 *
 * The transaction records both `plannedId` and `occurrenceDate`, which is what
 * lets `overdueOccurrences` tell paid from unpaid without any pointer being
 * advanced — the old app's `nextDueDate` mutation is what made a recurring
 * entry impossible to correct afterwards.
 *
 * Idempotent: posting the same occurrence twice returns the existing row
 * rather than duplicating it, so a double-tap on "Mark paid" is harmless.
 */
export async function materializeOccurrence(
  rule: PlannedTransaction,
  occurrence: {
    occurrenceDate: number;
    effectiveDate: number;
    amount: number;
    title: string;
    categoryId: string | null;
    accountId: string | null;
    description: string;
  },
  database: FinanceDatabase = defaultDb,
): Promise<Transaction> {
  const repo = repos(database);

  return database.transaction(
    'rw',
    database.transactions,
    database.outbox,
    async () => {
      const existing = (await repo.transactions.all()).find(
        (txn) =>
          txn.plannedId === rule.id && txn.occurrenceDate === occurrence.occurrenceDate,
      );
      if (existing) return existing;

      return repo.transactions.create({
        amount: occurrence.amount,
        // The rule's title is the closest thing it has to a description; the
        // ledger has no separate title column.
        description: occurrence.description || occurrence.title,
        categoryId: occurrence.categoryId,
        date: occurrence.effectiveDate,
        type: rule.type,
        accountId: occurrence.accountId,
        toAccountId: null,
        tags: [],
        plannedId: rule.id,
        occurrenceDate: occurrence.occurrenceDate,
      });
    },
  );
}

/**
 * Skip one occurrence.
 *
 * Writes a SKIP exception rather than advancing anything, so the rest of the
 * series is untouched and the skip itself can be undone by deleting the
 * exception. Re-skipping an already-skipped occurrence is a no-op.
 */
export async function skipOccurrence(
  plannedId: string,
  occurrenceDate: number,
  database: FinanceDatabase = defaultDb,
): Promise<PlannedException> {
  return upsertException(plannedId, occurrenceDate, {action: 'SKIP', overrides: {}}, database);
}

/**
 * Edit one occurrence and leave the series alone — "this occurrence only".
 *
 * Merges into any existing exception for the same date so editing an
 * occurrence twice does not leave two rows disagreeing about it.
 */
export async function overrideOccurrence(
  plannedId: string,
  occurrenceDate: number,
  overrides: PlannedException['overrides'],
  database: FinanceDatabase = defaultDb,
): Promise<PlannedException> {
  return upsertException(plannedId, occurrenceDate, {action: 'OVERRIDE', overrides}, database);
}

/** Drop an exception, restoring the occurrence to whatever the rule says. */
export async function clearOccurrenceException(
  plannedId: string,
  occurrenceDate: number,
  database: FinanceDatabase = defaultDb,
): Promise<boolean> {
  const repo = repos(database);

  return database.transaction(
    'rw',
    database.plannedExceptions,
    database.outbox,
    async () => {
      const existing = await findException(plannedId, occurrenceDate, database);
      if (!existing) return false;
      return repo.exceptions.softDelete(existing.id);
    },
  );
}

async function upsertException(
  plannedId: string,
  occurrenceDate: number,
  next: Pick<PlannedException, 'action' | 'overrides'>,
  database: FinanceDatabase,
): Promise<PlannedException> {
  const repo = repos(database);

  return database.transaction(
    'rw',
    database.plannedExceptions,
    database.outbox,
    async () => {
      const existing = await findException(plannedId, occurrenceDate, database);

      if (existing) {
        const merged = await repo.exceptions.update(existing.id, {
          action: next.action,
          overrides:
            next.action === 'SKIP'
              ? {}
              : {...existing.overrides, ...next.overrides},
        });
        if (merged) return merged;
      }

      return repo.exceptions.create({
        plannedId,
        occurrenceDate,
        action: next.action,
        overrides: next.overrides,
      });
    },
  );
}

async function findException(
  plannedId: string,
  occurrenceDate: number,
  database: FinanceDatabase,
): Promise<PlannedException | undefined> {
  const rows = await database.plannedExceptions
    .where('[plannedId+occurrenceDate]')
    .equals([plannedId, occurrenceDate])
    .toArray();
  return rows.find((row) => row.deletedAt === null);
}

/**
 * "This and all future occurrences": cap the existing rule and start a new one.
 *
 * The original is capped rather than edited, so occurrences already posted to
 * the ledger keep pointing at the rule that produced them and history does not
 * retroactively change. `splitSeriesAt` puts the cap one millisecond before
 * the split date, so the two rules cannot both claim it.
 *
 * The new rule starts at `fromDate` and inherits everything not overridden,
 * which makes "change the amount from next month" a single call.
 */
export async function splitSeries(
  rule: PlannedTransaction,
  fromDate: number,
  changes: Partial<
    Pick<
      PlannedTransaction,
      | 'title'
      | 'amount'
      | 'categoryId'
      | 'accountId'
      | 'description'
      | 'intervalType'
      | 'intervalN'
      | 'type'
    >
  >,
  database: FinanceDatabase = defaultDb,
): Promise<PlannedTransaction> {
  const repo = repos(database);
  const {endDate, newStartDate} = splitSeriesAt(fromDate);

  return database.transaction(
    'rw',
    database.plannedTransactions,
    database.plannedExceptions,
    database.outbox,
    async () => {
      // A split at or before the rule's own start would leave the original
      // with an empty range; replace it in place instead of orphaning it.
      if (newStartDate <= rule.startDate) {
        const updated = await repo.planned.update(rule.id, {
          ...changes,
          startDate: newStartDate,
          nextDueDate: newStartDate,
        });
        if (!updated) throw new Error('The planned transaction no longer exists');
        return updated;
      }

      await repo.planned.update(rule.id, {endDate});

      const successor = await repo.planned.create({
        title: changes.title ?? rule.title,
        amount: changes.amount ?? rule.amount,
        categoryId: changes.categoryId ?? rule.categoryId,
        type: changes.type ?? rule.type,
        accountId: changes.accountId ?? rule.accountId,
        startDate: newStartDate,
        intervalType: changes.intervalType ?? rule.intervalType,
        intervalN: changes.intervalN ?? rule.intervalN,
        oneTime: rule.oneTime,
        nextDueDate: newStartDate,
        endDate: null,
        isActive: rule.isActive,
        description: changes.description ?? rule.description,
      });

      // Exceptions at or after the split belong to the new rule; leaving them
      // pointing at the capped one would silently drop them.
      for (const exception of await repo.exceptions.all()) {
        if (exception.plannedId !== rule.id) continue;
        if (exception.occurrenceDate < newStartDate) continue;
        await repo.exceptions.update(exception.id, {plannedId: successor.id});
      }

      return successor;
    },
  );
}

/**
 * Recompute a rule's `nextDueDate` from the rule itself.
 *
 * `nextDueDate` is kept as a stored column because it is what the planned list
 * sorts and indexes on, but it is *derived* — the truth is the rule plus its
 * exceptions. Anything that changes the schedule calls this rather than
 * incrementing the old value, which is precisely the mistake the old app made.
 */
export function nextDueDateFor(rule: PlannedTransaction, asOf: number): number {
  if (rule.oneTime) return occurrenceAt(rule, 0);

  // `indexOnOrAfter` seeds from a date-based estimate rather than counting up
  // from zero, so a daily rule started years ago costs a handful of steps.
  const index = indexOnOrAfter(rule, asOf);

  // Null means the series has ended. The column is non-nullable, so park it on
  // the last occurrence the rule produced: past-dated, which is exactly how a
  // finished series should sort in the planned list.
  if (index === null) {
    return rule.endDate ?? occurrenceAt(rule, 0);
  }

  return occurrenceAt(rule, index);
}

export interface SettleDebtOptions {
  amount: number;
  date: number;
  /** When set, the settlement is also posted to the ledger against this account. */
  accountId: string | null;
  /** Mark the debt cleared once this payment lands. */
  isClearing: boolean;
}

/**
 * Record a payment against a debt, optionally posting it to the ledger.
 *
 * Paying a debt is two facts, not one: the debt's outstanding balance changed,
 * and money left an account. The old app conflated them, so settling a debt
 * either skipped the ledger or double-counted. Here `debtPayments` records the
 * first, an optional transaction records the second, and `transactionId` links
 * them so deleting one can find the other.
 *
 * Direction follows the debt's type: money you owe (`DEBT`) leaves your
 * account when paid; money owed to you (`DUE`) arrives when collected.
 */
export async function settleDebt(
  debt: Debt,
  options: SettleDebtOptions,
  database: FinanceDatabase = defaultDb,
): Promise<DebtPayment> {
  const repo = repos(database);

  return database.transaction(
    'rw',
    database.debts,
    database.debtPayments,
    database.transactions,
    database.outbox,
    async () => {
      let transactionId: string | null = null;

      if (options.accountId !== null) {
        const posted = await repo.transactions.create({
          amount: options.amount,
          description:
            debt.type === 'DEBT'
              ? `Repaid ${debt.personName}`
              : `Received from ${debt.personName}`,
          categoryId: null,
          date: options.date,
          type: debt.type === 'DEBT' ? 'EXPENSE' : 'INCOME',
          accountId: options.accountId,
          toAccountId: null,
          tags: ['debt'],
          plannedId: null,
          occurrenceDate: null,
        });
        transactionId = posted.id;
      }

      const payment = await repo.payments.create({
        debtId: debt.id,
        amount: options.amount,
        date: options.date,
        transactionId,
      });

      if (options.isClearing && !debt.isCleared) {
        await repo.debts.update(debt.id, {isCleared: true});
      }

      return payment;
    },
  );
}

/**
 * Remove a debt payment, and the ledger entry it created.
 *
 * Deleting only the payment would leave an orphaned expense that still moves
 * the account balance, which is exactly the desync the derived-balance design
 * exists to prevent.
 */
export async function deleteDebtPayment(
  payment: DebtPayment,
  database: FinanceDatabase = defaultDb,
): Promise<void> {
  const repo = repos(database);

  await database.transaction(
    'rw',
    database.debtPayments,
    database.transactions,
    database.outbox,
    async () => {
      if (payment.transactionId !== null) {
        await repo.transactions.softDelete(payment.transactionId);
      }
      await repo.payments.softDelete(payment.id);
    },
  );
}

/**
 * Outstanding balance per debt id.
 *
 * Derived from payments for the same reason account balances are derived from
 * transactions: a stored remaining-amount column desyncs the first time a
 * write half-fails, and nothing ever notices.
 */
export function computeDebtOutstanding(
  debts: readonly Debt[],
  payments: readonly DebtPayment[],
): Map<string, number> {
  const paid = new Map<string, number>();
  for (const payment of payments) {
    if (payment.deletedAt !== null) continue;
    paid.set(payment.debtId, (paid.get(payment.debtId) ?? 0) + payment.amount);
  }

  const outstanding = new Map<string, number>();
  for (const debt of debts) {
    if (debt.deletedAt !== null) continue;
    outstanding.set(debt.id, Math.max(0, debt.amount - (paid.get(debt.id) ?? 0)));
  }

  return outstanding;
}

/** A fresh id, for callers building rows before writing them. */
export {newId, now};
