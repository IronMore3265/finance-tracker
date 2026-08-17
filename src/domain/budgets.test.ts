import {describe, expect, it} from 'vitest';
import type {Budget, Transaction, TransactionType} from '../db/types';
import {
  computeAllBudgetProgress,
  computeBudgetProgress,
  resolvePeriod,
  statusFor,
} from './budgets';

const at = (y: number, m: number, d: number): number =>
  new Date(y, m - 1, d, 0, 0, 0, 0).getTime();

const asDate = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
};

let seq = 0;

function budget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: `budget-${(seq += 1)}`,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    userId: null,
    categoryId: null,
    amount: 10000,
    period: 'MONTH',
    startDate: at(2026, 1, 1),
    endDate: null,
    isActive: true,
    ...overrides,
  };
}

function txn(
  type: TransactionType,
  amount: number,
  date: number,
  categoryId: string | null = null,
): Transaction {
  return {
    id: `txn-${(seq += 1)}`,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    userId: null,
    amount,
    description: '',
    categoryId,
    date,
    type,
    accountId: null,
    toAccountId: null,
    tags: [],
    plannedId: null,
    occurrenceDate: null,
  };
}

describe('resolvePeriod', () => {
  it('resolves a calendar-aligned monthly period', () => {
    const b = budget({period: 'MONTH', startDate: at(2026, 1, 1)});
    const period = resolvePeriod(b, at(2026, 3, 17));
    expect(asDate(period.from)).toBe('2026-03-01');
    expect(asDate(period.to)).toBe('2026-04-01');
  });

  /** The payroll-alignment case the old app's README called out. */
  it('anchors a monthly period to the pay date rather than the calendar', () => {
    const b = budget({period: 'MONTH', startDate: at(2026, 1, 15)});

    // Just after payday: the period should have just begun.
    const justAfter = resolvePeriod(b, at(2026, 3, 16));
    expect(asDate(justAfter.from)).toBe('2026-03-15');
    expect(asDate(justAfter.to)).toBe('2026-04-15');

    // Just before payday: still in the previous cycle.
    const justBefore = resolvePeriod(b, at(2026, 3, 14));
    expect(asDate(justBefore.from)).toBe('2026-02-15');
    expect(asDate(justBefore.to)).toBe('2026-03-15');
  });

  it('includes the exact period start (half-open interval)', () => {
    const b = budget({period: 'MONTH', startDate: at(2026, 1, 15)});
    const period = resolvePeriod(b, at(2026, 3, 15));
    expect(asDate(period.from)).toBe('2026-03-15');
  });

  it('clamps a month-end anchor without drifting', () => {
    const b = budget({period: 'MONTH', startDate: at(2026, 1, 31)});
    expect(asDate(resolvePeriod(b, at(2026, 2, 10)).from)).toBe('2026-01-31');
    // February clamps to the 28th, but March recovers the 31st anchor.
    expect(asDate(resolvePeriod(b, at(2026, 3, 15)).from)).toBe('2026-02-28');
    expect(asDate(resolvePeriod(b, at(2026, 4, 1)).from)).toBe('2026-03-31');
  });

  it('resolves weekly and yearly periods', () => {
    const weekly = budget({period: 'WEEK', startDate: at(2026, 1, 5)});
    const week = resolvePeriod(weekly, at(2026, 1, 14));
    expect(asDate(week.from)).toBe('2026-01-12');
    expect(asDate(week.to)).toBe('2026-01-19');

    const yearly = budget({period: 'YEAR', startDate: at(2024, 4, 1)});
    const year = resolvePeriod(yearly, at(2026, 6, 1));
    expect(asDate(year.from)).toBe('2026-04-01');
    expect(asDate(year.to)).toBe('2027-04-01');
  });

  it('returns the literal range for a custom period', () => {
    const b = budget({
      period: 'CUSTOM',
      startDate: at(2026, 5, 1),
      endDate: at(2026, 5, 20),
    });
    const period = resolvePeriod(b, at(2026, 5, 10));
    expect(asDate(period.from)).toBe('2026-05-01');
    expect(asDate(period.to)).toBe('2026-05-20');
  });

  it('reports the first period when asked about a date before the budget starts', () => {
    const b = budget({period: 'MONTH', startDate: at(2026, 6, 1)});
    const period = resolvePeriod(b, at(2026, 1, 1));
    expect(asDate(period.from)).toBe('2026-06-01');
    expect(asDate(period.to)).toBe('2026-07-01');
  });
});

describe('statusFor', () => {
  it('classifies against the warning threshold', () => {
    expect(statusFor(0, 1000)).toBe('ok');
    expect(statusFor(799, 1000)).toBe('ok');
    expect(statusFor(800, 1000)).toBe('warning'); // exactly 80%
    expect(statusFor(1000, 1000)).toBe('warning'); // at the limit, not over
    expect(statusFor(1001, 1000)).toBe('over');
  });

  it('never reports over for a zero or negative limit', () => {
    expect(statusFor(500, 0)).toBe('ok');
  });
});

describe('computeBudgetProgress', () => {
  it('counts only expenses inside the period', () => {
    const b = budget({period: 'MONTH', startDate: at(2026, 1, 1), amount: 10000});
    const progress = computeBudgetProgress(
      b,
      [
        txn('EXPENSE', 3000, at(2026, 3, 5)),
        txn('EXPENSE', 1500, at(2026, 3, 20)),
        txn('INCOME', 50000, at(2026, 3, 10)), // income is not spending
        txn('TRANSFER', 9999, at(2026, 3, 12)), // nor is a transfer
        txn('EXPENSE', 8000, at(2026, 2, 20)), // previous period
      ],
      at(2026, 3, 25),
    );

    expect(progress.spent).toBe(4500);
    expect(progress.remaining).toBe(5500);
    expect(progress.fraction).toBeCloseTo(0.45, 10);
    expect(progress.status).toBe('ok');
  });

  it('scopes a per-category budget to its category', () => {
    const b = budget({categoryId: 'food', amount: 5000, startDate: at(2026, 1, 1)});
    const progress = computeBudgetProgress(
      b,
      [
        txn('EXPENSE', 4500, at(2026, 3, 5), 'food'),
        txn('EXPENSE', 9000, at(2026, 3, 6), 'travel'),
      ],
      at(2026, 3, 10),
    );

    expect(progress.spent).toBe(4500);
    expect(progress.status).toBe('warning'); // 90% of the limit
  });

  it('reports overspend with a negative remaining and clamped fraction', () => {
    const b = budget({amount: 1000, startDate: at(2026, 1, 1)});
    const progress = computeBudgetProgress(
      b,
      [txn('EXPENSE', 1600, at(2026, 3, 5))],
      at(2026, 3, 10),
    );

    expect(progress.spent).toBe(1600);
    expect(progress.remaining).toBe(-600);
    expect(progress.fraction).toBe(1); // clamped for the progress bar
    expect(progress.status).toBe('over');
  });

  it('ignores soft-deleted transactions', () => {
    const b = budget({amount: 1000, startDate: at(2026, 1, 1)});
    const deleted = {...txn('EXPENSE', 900, at(2026, 3, 5)), deletedAt: 1};
    expect(computeBudgetProgress(b, [deleted], at(2026, 3, 10)).spent).toBe(0);
  });
});

describe('computeAllBudgetProgress', () => {
  it('skips inactive and deleted budgets', () => {
    const budgets = [
      budget({amount: 1000}),
      budget({amount: 1000, isActive: false}),
      budget({amount: 1000, deletedAt: 1}),
    ];
    expect(computeAllBudgetProgress(budgets, [], at(2026, 3, 1))).toHaveLength(1);
  });

  it('sorts worst-overspent first', () => {
    const light = budget({categoryId: 'a', amount: 10000, startDate: at(2026, 1, 1)});
    const heavy = budget({categoryId: 'b', amount: 1000, startDate: at(2026, 1, 1)});
    const progress = computeAllBudgetProgress(
      [light, heavy],
      [
        txn('EXPENSE', 1000, at(2026, 3, 5), 'a'), // 10%
        txn('EXPENSE', 1500, at(2026, 3, 5), 'b'), // 150%
      ],
      at(2026, 3, 10),
    );

    expect(progress[0]?.budget.categoryId).toBe('b');
    expect(progress[0]?.status).toBe('over');
    expect(progress[1]?.budget.categoryId).toBe('a');
  });
});
