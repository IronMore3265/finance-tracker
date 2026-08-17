// Patches indexedDB onto globalThis so Dexie runs under Node.
import 'fake-indexeddb/auto';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
  clearOccurrenceException,
  computeDebtOutstanding,
  deleteDebtPayment,
  applyDisplayOrder,
  materializeOccurrence,
  mergeCategories,
  nextDueDateFor,
  overrideOccurrence,
  settleDebt,
  skipOccurrence,
  splitSeries,
} from './commands';
import {createTestDatabase, type FinanceDatabase} from './db';
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

let db: FinanceDatabase;
let dbCount = 0;

let accounts: ReturnType<typeof createRepository<Account>>;
let categories: ReturnType<typeof createRepository<Category>>;
let transactions: ReturnType<typeof createRepository<Transaction>>;
let planned: ReturnType<typeof createRepository<PlannedTransaction>>;
let exceptions: ReturnType<typeof createRepository<PlannedException>>;
let budgets: ReturnType<typeof createRepository<Budget>>;
let debts: ReturnType<typeof createRepository<Debt>>;
let payments: ReturnType<typeof createRepository<DebtPayment>>;

const day = (iso: string) => new Date(`${iso}T00:00:00`).getTime();

const category = (overrides: Partial<Category> = {}) => ({
  name: 'Food',
  icon: 'utensils',
  colorHex: '#EA3B35',
  kind: 'EXPENSE' as const,
  displayOrder: 0,
  isDefault: false,
  ...overrides,
});

const transaction = (overrides: Partial<Transaction> = {}) => ({
  amount: 100,
  description: 'Lunch',
  categoryId: null,
  date: day('2026-08-01'),
  type: 'EXPENSE' as const,
  accountId: null,
  toAccountId: null,
  tags: [] as string[],
  plannedId: null,
  occurrenceDate: null,
  ...overrides,
});

const rule = (overrides: Partial<PlannedTransaction> = {}) => ({
  title: 'Rent',
  amount: 12000,
  categoryId: null,
  type: 'EXPENSE' as const,
  accountId: null,
  startDate: day('2026-01-15'),
  intervalType: 'MONTH' as const,
  intervalN: 1,
  oneTime: false,
  nextDueDate: day('2026-01-15'),
  endDate: null,
  isActive: true,
  description: '',
  ...overrides,
});

const debt = (overrides: Partial<Debt> = {}) => ({
  personName: 'Rafi',
  amount: 5000,
  description: '',
  date: day('2026-07-01'),
  dueDate: null,
  type: 'DEBT' as const,
  isCleared: false,
  accountId: null,
  ...overrides,
});

beforeEach(async () => {
  db = createTestDatabase(`cmd-${(dbCount += 1)}-${Date.now()}`);
  await db.open();

  accounts = createRepository<Account>('accounts', db);
  categories = createRepository<Category>('categories', db);
  transactions = createRepository<Transaction>('transactions', db);
  planned = createRepository<PlannedTransaction>('plannedTransactions', db);
  exceptions = createRepository<PlannedException>('plannedExceptions', db);
  budgets = createRepository<Budget>('budgets', db);
  debts = createRepository<Debt>('debts', db);
  payments = createRepository<DebtPayment>('debtPayments', db);
});

afterEach(() => {
  db.close();
});

describe('mergeCategories', () => {
  it('reassigns transactions and retires the source', async () => {
    const source = await categories.create(category({name: 'Movie'}));
    const target = await categories.create(category({name: 'Entertainment'}));
    const moved = await transactions.create(transaction({categoryId: source.id}));
    const untouched = await transactions.create(transaction({categoryId: target.id}));

    const result = await mergeCategories(source.id, target.id, db);

    expect(result.transactionsMoved).toBe(1);
    expect((await transactions.get(moved.id))?.categoryId).toBe(target.id);
    expect((await transactions.get(untouched.id))?.categoryId).toBe(target.id);
    // Soft-deleted, so the merge shows up in Trash rather than vanishing.
    expect(await categories.get(source.id)).toBeUndefined();
    expect(await categories.getIncludingDeleted(source.id)).toBeDefined();
  });

  it('reassigns planned rules and their per-occurrence overrides', async () => {
    const source = await categories.create(category({name: 'Movie'}));
    const target = await categories.create(category({name: 'Fun'}));

    const series = await planned.create(rule({categoryId: source.id}));
    const exception = await exceptions.create({
      plannedId: series.id,
      occurrenceDate: day('2026-03-15'),
      action: 'OVERRIDE',
      overrides: {categoryId: source.id, amount: 500},
    });

    await mergeCategories(source.id, target.id, db);

    expect((await planned.get(series.id))?.categoryId).toBe(target.id);
    const updated = await exceptions.get(exception.id);
    expect(updated?.overrides.categoryId).toBe(target.id);
    // Untouched fields survive the merge.
    expect(updated?.overrides.amount).toBe(500);
  });

  it('moves the source budget when the target has none', async () => {
    const source = await categories.create(category({name: 'Movie'}));
    const target = await categories.create(category({name: 'Fun'}));
    const budget = await budgets.create({
      categoryId: source.id,
      amount: 2000,
      period: 'MONTH',
      startDate: day('2026-01-01'),
      endDate: null,
      isActive: true,
    });

    const result = await mergeCategories(source.id, target.id, db);

    expect(result.budgetsMoved).toBe(1);
    expect(result.budgetsDiscarded).toBe(0);
    expect((await budgets.get(budget.id))?.categoryId).toBe(target.id);
  });

  it('discards the source budget when the target already has one', async () => {
    const source = await categories.create(category({name: 'Movie'}));
    const target = await categories.create(category({name: 'Fun'}));
    const sourceBudget = await budgets.create({
      categoryId: source.id,
      amount: 2000,
      period: 'MONTH',
      startDate: day('2026-01-01'),
      endDate: null,
      isActive: true,
    });
    const targetBudget = await budgets.create({
      categoryId: target.id,
      amount: 3000,
      period: 'MONTH',
      startDate: day('2026-01-01'),
      endDate: null,
      isActive: true,
    });

    const result = await mergeCategories(source.id, target.id, db);

    // Two budgets for one category would render as two bars measuring the
    // same spend, so the kept category's own limit wins.
    expect(result.budgetsDiscarded).toBe(1);
    expect(await budgets.get(sourceBudget.id)).toBeUndefined();
    expect((await budgets.get(targetBudget.id))?.amount).toBe(3000);
  });

  it('refuses to merge a category into itself', async () => {
    const only = await categories.create(category());
    await expect(mergeCategories(only.id, only.id, db)).rejects.toThrow(/itself/);
  });
});

describe('applyDisplayOrder', () => {
  it('rewrites the order densely, leaving no ties', async () => {
    const a = await categories.create(category({name: 'A', displayOrder: 0}));
    const b = await categories.create(category({name: 'B', displayOrder: 1}));
    const c = await categories.create(category({name: 'C', displayOrder: 2}));

    await applyDisplayOrder('categories', [c.id, a.id, b.id], db);

    expect((await categories.get(c.id))?.displayOrder).toBe(0);
    expect((await categories.get(a.id))?.displayOrder).toBe(1);
    expect((await categories.get(b.id))?.displayOrder).toBe(2);
  });

  it('works across accounts too', async () => {
    const first = await accounts.create({
      name: 'Cash',
      openingBalance: 0,
      colorHex: '#000000',
      icon: 'wallet',
      currency: 'BDT',
      includeInBalance: true,
      displayOrder: 0,
    });
    const second = await accounts.create({
      name: 'Bank',
      openingBalance: 0,
      colorHex: '#000000',
      icon: 'bank',
      currency: 'BDT',
      includeInBalance: true,
      displayOrder: 1,
    });

    await applyDisplayOrder('accounts', [second.id, first.id], db);

    expect((await accounts.get(second.id))?.displayOrder).toBe(0);
    expect((await accounts.get(first.id))?.displayOrder).toBe(1);
  });
});

describe('materializeOccurrence', () => {
  const occurrence = {
    occurrenceDate: day('2026-03-15'),
    effectiveDate: day('2026-03-15'),
    amount: 12000,
    title: 'Rent',
    categoryId: null,
    accountId: null,
    description: '',
  };

  it('posts an occurrence to the ledger with its identity attached', async () => {
    const series = await planned.create(rule());
    const posted = await materializeOccurrence(series, occurrence, db);

    expect(posted.plannedId).toBe(series.id);
    expect(posted.occurrenceDate).toBe(occurrence.occurrenceDate);
    expect(posted.amount).toBe(12000);
    expect(posted.description).toBe('Rent');
  });

  it('is idempotent, so a double tap cannot double-post', async () => {
    const series = await planned.create(rule());

    const first = await materializeOccurrence(series, occurrence, db);
    const second = await materializeOccurrence(series, occurrence, db);

    expect(second.id).toBe(first.id);
    expect(await transactions.all()).toHaveLength(1);
  });
});

describe('occurrence exceptions', () => {
  it('skips one occurrence without touching the rule', async () => {
    const series = await planned.create(rule());
    await skipOccurrence(series.id, day('2026-03-15'), db);

    const stored = await exceptions.all();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.action).toBe('SKIP');
    // The series itself is untouched: no pointer was advanced.
    expect((await planned.get(series.id))?.startDate).toBe(day('2026-01-15'));
  });

  it('merges repeated overrides of the same occurrence into one row', async () => {
    const series = await planned.create(rule());

    await overrideOccurrence(series.id, day('2026-03-15'), {amount: 13000}, db);
    await overrideOccurrence(series.id, day('2026-03-15'), {title: 'Rent (raised)'}, db);

    const stored = await exceptions.all();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.overrides).toMatchObject({
      amount: 13000,
      title: 'Rent (raised)',
    });
  });

  it('drops the overrides when an override is turned into a skip', async () => {
    const series = await planned.create(rule());
    await overrideOccurrence(series.id, day('2026-03-15'), {amount: 13000}, db);
    await skipOccurrence(series.id, day('2026-03-15'), db);

    const stored = await exceptions.all();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.action).toBe('SKIP');
    expect(stored[0]?.overrides).toEqual({});
  });

  it('restores an occurrence to the rule when its exception is cleared', async () => {
    const series = await planned.create(rule());
    await skipOccurrence(series.id, day('2026-03-15'), db);

    expect(await clearOccurrenceException(series.id, day('2026-03-15'), db)).toBe(true);
    expect(await exceptions.all()).toHaveLength(0);
    // Clearing twice is a no-op rather than an error.
    expect(await clearOccurrenceException(series.id, day('2026-03-15'), db)).toBe(false);
  });
});

describe('splitSeries', () => {
  it('caps the original and starts a successor', async () => {
    const series = await planned.create(rule());
    const splitAt = day('2026-06-15');

    const successor = await splitSeries(series, splitAt, {amount: 14000}, db);

    expect(successor.id).not.toBe(series.id);
    expect(successor.amount).toBe(14000);
    expect(successor.startDate).toBe(splitAt);
    // One millisecond before, so the two rules cannot both claim the date.
    expect((await planned.get(series.id))?.endDate).toBe(splitAt - 1);
    expect((await planned.get(series.id))?.amount).toBe(12000);
  });

  it('moves exceptions at or after the split to the successor', async () => {
    const series = await planned.create(rule());
    const early = await exceptions.create({
      plannedId: series.id,
      occurrenceDate: day('2026-03-15'),
      action: 'SKIP',
      overrides: {},
    });
    const late = await exceptions.create({
      plannedId: series.id,
      occurrenceDate: day('2026-08-15'),
      action: 'SKIP',
      overrides: {},
    });

    const successor = await splitSeries(series, day('2026-06-15'), {}, db);

    expect((await exceptions.get(early.id))?.plannedId).toBe(series.id);
    expect((await exceptions.get(late.id))?.plannedId).toBe(successor.id);
  });

  it('edits in place when the split lands on or before the start', async () => {
    const series = await planned.create(rule());

    const result = await splitSeries(series, series.startDate, {amount: 15000}, db);

    // Capping here would leave the original with an empty range and orphan it.
    expect(result.id).toBe(series.id);
    expect(result.amount).toBe(15000);
    expect(await planned.all()).toHaveLength(1);
  });
});

describe('nextDueDateFor', () => {
  it('finds the next occurrence without counting up from the start', async () => {
    const series = rule({startDate: day('2020-01-15')}) as PlannedTransaction;
    expect(nextDueDateFor(series, day('2026-08-18'))).toBe(day('2026-09-15'));
  });

  it('returns the occurrence itself when it is exactly due', () => {
    const series = rule({startDate: day('2026-01-15')}) as PlannedTransaction;
    expect(nextDueDateFor(series, day('2026-03-15'))).toBe(day('2026-03-15'));
  });

  it('parks a finished series on its end date rather than running forward', () => {
    const series = rule({
      startDate: day('2026-01-15'),
      endDate: day('2026-03-01'),
    }) as PlannedTransaction;
    expect(nextDueDateFor(series, day('2026-08-18'))).toBe(day('2026-03-01'));
  });
});

describe('settleDebt', () => {
  it('records a payment and posts it to the ledger', async () => {
    const owed = await debts.create(debt());
    const account = await accounts.create({
      name: 'Cash',
      openingBalance: 10000,
      colorHex: '#000000',
      icon: 'wallet',
      currency: 'BDT',
      includeInBalance: true,
      displayOrder: 0,
    });

    const payment = await settleDebt(
      owed,
      {amount: 2000, date: day('2026-08-01'), accountId: account.id, isClearing: false},
      db,
    );

    expect(payment.transactionId).not.toBeNull();
    const posted = await transactions.get(payment.transactionId as string);
    // Money you owe leaves your account when you repay it.
    expect(posted?.type).toBe('EXPENSE');
    expect(posted?.amount).toBe(2000);
    expect(posted?.accountId).toBe(account.id);
  });

  it('posts money owed to you as income when collected', async () => {
    const lent = await debts.create(debt({type: 'DUE'}));
    const account = await accounts.create({
      name: 'Cash',
      openingBalance: 0,
      colorHex: '#000000',
      icon: 'wallet',
      currency: 'BDT',
      includeInBalance: true,
      displayOrder: 0,
    });

    const payment = await settleDebt(
      lent,
      {amount: 2000, date: day('2026-08-01'), accountId: account.id, isClearing: true},
      db,
    );

    expect((await transactions.get(payment.transactionId as string))?.type).toBe('INCOME');
    expect((await debts.get(lent.id))?.isCleared).toBe(true);
  });

  it('records a payment without a ledger entry when no account is given', async () => {
    const owed = await debts.create(debt());

    const payment = await settleDebt(
      owed,
      {amount: 2000, date: day('2026-08-01'), accountId: null, isClearing: false},
      db,
    );

    expect(payment.transactionId).toBeNull();
    expect(await transactions.all()).toHaveLength(0);
  });
});

describe('deleteDebtPayment', () => {
  it('removes the ledger entry along with the payment', async () => {
    const owed = await debts.create(debt());
    const account = await accounts.create({
      name: 'Cash',
      openingBalance: 10000,
      colorHex: '#000000',
      icon: 'wallet',
      currency: 'BDT',
      includeInBalance: true,
      displayOrder: 0,
    });

    const payment = await settleDebt(
      owed,
      {amount: 2000, date: day('2026-08-01'), accountId: account.id, isClearing: false},
      db,
    );

    await deleteDebtPayment(payment, db);

    // An orphaned expense would keep moving the account balance forever.
    expect(await transactions.all()).toHaveLength(0);
    expect(await payments.all()).toHaveLength(0);
  });
});

describe('computeDebtOutstanding', () => {
  it('subtracts live payments from the principal', () => {
    const rows = [
      {id: 'a', amount: 5000, deletedAt: null},
      {id: 'b', amount: 3000, deletedAt: null},
    ] as Debt[];
    const paid = [
      {debtId: 'a', amount: 2000, deletedAt: null},
      {debtId: 'a', amount: 500, deletedAt: null},
      // A deleted payment must not reduce what is owed.
      {debtId: 'b', amount: 3000, deletedAt: 1},
    ] as DebtPayment[];

    const outstanding = computeDebtOutstanding(rows, paid);
    expect(outstanding.get('a')).toBe(2500);
    expect(outstanding.get('b')).toBe(3000);
  });

  it('floors at zero when overpaid', () => {
    const rows = [{id: 'a', amount: 1000, deletedAt: null}] as Debt[];
    const paid = [{debtId: 'a', amount: 1500, deletedAt: null}] as DebtPayment[];
    expect(computeDebtOutstanding(rows, paid).get('a')).toBe(0);
  });
});
