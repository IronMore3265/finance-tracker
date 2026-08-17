/**
 * Budget periods and progress.
 *
 * The old app had exactly one global budget with a single period. This adds
 * per-category limits, and keeps the feature its README called out as most
 * valuable: a period anchored to *your* pay cycle rather than the calendar.
 * A budget starting on the 15th runs 15th to 15th, so "remaining balance"
 * tracks actual cash flow instead of resetting mid-cycle.
 */
import type {Budget, IntervalType, Transaction} from '../db/types';
import {computeSpendByCategory} from './balances';
import {roundToMinorUnit} from './mathEval';
import {shift} from './recurrence';

/** Fraction of the limit at which a budget starts warning. */
export const WARNING_THRESHOLD = 0.8;

export type Period = {from: number; to: number};

const INTERVAL_FOR_PERIOD: Record<'WEEK' | 'MONTH' | 'YEAR', IntervalType> = {
  WEEK: 'WEEK',
  MONTH: 'MONTH',
  YEAR: 'YEAR',
};

/**
 * The budget period containing `asOf`, as a half-open interval.
 *
 * Periods are counted forward from `startDate`, so the anchor day is
 * preserved: a monthly budget anchored on the 31st behaves like a recurring
 * rule (clamping in short months without drifting), because it reuses the
 * same date arithmetic.
 */
export function resolvePeriod(budget: Budget, asOf: number): Period {
  if (budget.period === 'CUSTOM') {
    // A custom range is literal: exactly the dates the user picked.
    return {
      from: budget.startDate,
      to: budget.endDate ?? Number.POSITIVE_INFINITY,
    };
  }

  const interval = INTERVAL_FOR_PERIOD[budget.period];
  const anchor = new Date(budget.startDate);

  // Estimate how many whole periods have elapsed, then correct. Estimating
  // rather than looping keeps a years-old weekly budget cheap to resolve.
  let index = estimatePeriodIndex(anchor, asOf, interval);
  if (index < 0) index = 0;

  // Walk back while the period start is still in the future.
  while (index > 0 && shift(anchor, interval, index).getTime() > asOf) index -= 1;
  // Walk forward while the *next* period would still contain asOf.
  while (shift(anchor, interval, index + 1).getTime() <= asOf) index += 1;

  const from = shift(anchor, interval, index).getTime();
  const to = shift(anchor, interval, index + 1).getTime();

  // Before the budget begins, report the first period rather than a period
  // running backwards from the anchor.
  if (asOf < budget.startDate) {
    return {from: budget.startDate, to: shift(anchor, interval, 1).getTime()};
  }

  return {from, to};
}

function estimatePeriodIndex(
  anchor: Date,
  asOf: number,
  interval: IntervalType,
): number {
  const target = new Date(asOf);

  switch (interval) {
    case 'DAY':
      return Math.floor((asOf - anchor.getTime()) / 86_400_000);
    case 'WEEK':
      return Math.floor((asOf - anchor.getTime()) / (86_400_000 * 7));
    case 'MONTH':
      return (
        (target.getFullYear() - anchor.getFullYear()) * 12 +
        (target.getMonth() - anchor.getMonth())
      );
    case 'YEAR':
      return target.getFullYear() - anchor.getFullYear();
  }
}

export type BudgetStatus = 'ok' | 'warning' | 'over';

export function statusFor(spent: number, limit: number): BudgetStatus {
  if (limit <= 0) return 'ok';
  if (spent > limit) return 'over';
  if (spent >= limit * WARNING_THRESHOLD) return 'warning';
  return 'ok';
}

export type BudgetProgress = {
  budget: Budget;
  period: Period;
  spent: number;
  limit: number;
  remaining: number;
  /** 0..1, clamped for display. Use `spent / limit` directly if you need overflow. */
  fraction: number;
  status: BudgetStatus;
};

/**
 * Progress for one budget.
 *
 * A budget with `categoryId: null` measures all expense spending in the
 * period; otherwise only that category's.
 */
export function computeBudgetProgress(
  budget: Budget,
  transactions: readonly Transaction[],
  asOf: number,
): BudgetProgress {
  const period = resolvePeriod(budget, asOf);
  const spendByCategory = computeSpendByCategory(transactions, period.from, period.to);

  let spent = 0;
  if (budget.categoryId === null) {
    for (const value of spendByCategory.values()) spent += value;
  } else {
    spent = spendByCategory.get(budget.categoryId) ?? 0;
  }

  spent = roundToMinorUnit(spent);
  const limit = budget.amount;

  return {
    budget,
    period,
    spent,
    limit,
    remaining: roundToMinorUnit(limit - spent),
    fraction: limit > 0 ? Math.min(spent / limit, 1) : 0,
    status: statusFor(spent, limit),
  };
}

/** Progress for every active budget, worst first so problems surface at the top. */
export function computeAllBudgetProgress(
  budgets: readonly Budget[],
  transactions: readonly Transaction[],
  asOf: number,
): BudgetProgress[] {
  return budgets
    .filter((budget) => budget.deletedAt === null && budget.isActive)
    .map((budget) => computeBudgetProgress(budget, transactions, asOf))
    .sort((a, b) => {
      const aRatio = a.limit > 0 ? a.spent / a.limit : 0;
      const bRatio = b.limit > 0 ? b.spent / b.limit : 0;
      return bRatio - aRatio;
    });
}
