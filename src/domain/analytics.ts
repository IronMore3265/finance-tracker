/**
 * Analytics aggregations.
 *
 * Everything the Analytics screen draws is computed here, as pure functions
 * over plain arrays — the charts receive finished series and do nothing but
 * render them. That split is deliberate: aggregation is where the arithmetic
 * bugs live (a half-open interval closed by accident, a transfer counted as
 * spending), and it is only cheap to test while it is separate from SVG.
 *
 * Three rules hold throughout, inherited from `balances.ts`:
 *
 *   1. **Ranges are half-open, [from, to).** A transaction at exactly `to`
 *      belongs to the next period. Closing both ends double-counts the
 *      boundary day into two periods, which is invisible until a month-end
 *      purchase shows up in two bars.
 *   2. **Transfers are never spending.** Moving your own money between
 *      wallets is not income and not expense; counting an ATM withdrawal
 *      would double it against the eventual purchase. Transfers *do* move net
 *      worth when exactly one leg is an included account.
 *   3. **Soft-deleted rows do not exist.** Filtered here rather than trusted
 *      to the caller, because a chart silently including deleted rows
 *      disagrees with every list in the app and nothing points at why.
 */
import type {Account, Category, Transaction} from '../db/types';
import {startOfDay, startOfMonth} from '../format/dates';
import {roundToMinorUnit} from './mathEval';
import {shift} from './recurrence';

/** Half-open interval [from, to), matching `budgets.ts`. */
export type Range = {from: number; to: number};

export type RangePreset = '3M' | '6M' | '12M' | 'ALL';

/**
 * The spans offered above the charts.
 *
 * All four are **calendar-month aligned**, and the shortest is three months,
 * for one reason: the cash-flow chart plots one column per month, and a
 * single-month range would render a one-column bar chart — which is a stat
 * tile pretending to be a chart. "This month" is the dashboard's job; this
 * screen answers the longer questions.
 */
export const RANGE_PRESETS: readonly {
  value: RangePreset;
  label: string;
  /** Whole calendar months, or null for "everything on record". */
  months: number | null;
}[] = [
  {value: '3M', label: '3 months', months: 3},
  {value: '6M', label: '6 months', months: 6},
  {value: '12M', label: '12 months', months: 12},
  {value: 'ALL', label: 'All time', months: null},
];

export type ResolvedRange = {
  current: Range;
  /**
   * The equally long span immediately before `current`, for "what changed".
   * Null for ALL, which has nothing before it to compare against.
   */
  previous: Range | null;
};

/**
 * Turn a preset into concrete bounds.
 *
 * Aligned to month boundaries rather than counted back in days, so the bars
 * are whole months and "3 months" means three named months rather than 90
 * days ending mid-March. The end is the start of *next* month, which is the
 * exclusive end of the month containing `now`.
 */
export function resolveRange(
  preset: RangePreset,
  transactions: readonly Transaction[],
  now: number,
): ResolvedRange {
  const to = addMonths(startOfMonth(now), 1);

  const months = RANGE_PRESETS.find((entry) => entry.value === preset)?.months ?? null;
  if (months === null) {
    // ALL starts at the earliest transaction on record. With no transactions
    // at all it collapses to the current month rather than to an empty or
    // backwards range, so the charts render their own empty states instead of
    // dividing by a zero-width domain.
    const earliest = earliestDate(transactions);
    const from = startOfMonth(earliest ?? now);
    return {current: {from, to}, previous: null};
  }

  const from = addMonths(to, -months);
  return {current: {from, to}, previous: {from: addMonths(from, -months), to: from}};
}

function earliestDate(transactions: readonly Transaction[]): number | null {
  let earliest: number | null = null;
  for (const txn of transactions) {
    if (!isLive(txn)) continue;
    if (earliest === null || txn.date < earliest) earliest = txn.date;
  }
  return earliest;
}

function isLive(row: {deletedAt: number | null}): boolean {
  return row.deletedAt === null;
}

function inRange(date: number, range: Range): boolean {
  return date >= range.from && date < range.to;
}

/** Calendar-month arithmetic, reusing the recurrence rules' clamping. */
function addMonths(epochMs: number, delta: number): number {
  return shift(new Date(epochMs), 'MONTH', delta).getTime();
}

/** Every month start inside `range`, ascending. */
export function monthStarts(range: Range): number[] {
  const starts: number[] = [];
  let cursor = startOfMonth(range.from);
  // Guard a backwards or empty range rather than looping forever.
  while (cursor < range.to) {
    starts.push(cursor);
    cursor = addMonths(cursor, 1);
  }
  return starts;
}

// --- Spending by category ---------------------------------------------------

/**
 * A category's share of spending, or the folded tail.
 *
 * `categoryId` is null for uncategorised spending and for the fold; `isOther`
 * is what distinguishes them, because "Uncategorised" is a real answer the
 * user can act on and "Other" is a presentation device.
 */
export type CategorySlice = {
  key: string;
  categoryId: string | null;
  label: string;
  /** The category's own colour, or null when there is no single category. */
  colorHex: string | null;
  amount: number;
  /** Fraction of total spending in the range, 0–1. */
  share: number;
  /** True for the bucket that absorbs everything past the display limit. */
  isOther: boolean;
};

/**
 * Spending per category over `range`, largest first, with the tail folded.
 *
 * The fold is not cosmetic. Past roughly seven classes adjacent colours blur
 * and the chart stops being readable, so everything below the cut collapses
 * into one "Other" row rather than growing the palette — see PROGRESS.md §7
 * on why the colour here is a label, not the encoding.
 */
export function spendByCategory(
  transactions: readonly Transaction[],
  categories: readonly Category[],
  range: Range,
  limit = 6,
): CategorySlice[] {
  const totals = new Map<string | null, number>();

  for (const txn of transactions) {
    if (!isLive(txn) || txn.type !== 'EXPENSE') continue;
    if (!inRange(txn.date, range)) continue;
    totals.set(txn.categoryId, (totals.get(txn.categoryId) ?? 0) + txn.amount);
  }

  const byId = new Map(categories.filter(isLive).map((row) => [row.id, row]));
  const total = roundToMinorUnit([...totals.values()].reduce((sum, n) => sum + n, 0));
  if (total <= 0) return [];

  const ranked = [...totals.entries()]
    .map(([categoryId, raw]) => {
      const amount = roundToMinorUnit(raw);
      const category = categoryId === null ? undefined : byId.get(categoryId);
      return {
        key: categoryId ?? 'uncategorised',
        categoryId,
        // A category deleted after the fact still has spending attributed to
        // it; naming it "Deleted category" beats dropping the money.
        label: category?.name ?? (categoryId === null ? 'Uncategorised' : 'Deleted category'),
        colorHex: category?.colorHex ?? null,
        amount,
        share: amount / total,
        isOther: false,
      };
    })
    // Name as the tiebreak so equal amounts keep a stable order between
    // renders instead of flipping with Map insertion order.
    .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));

  if (ranked.length <= limit) return ranked;

  const head = ranked.slice(0, limit - 1);
  const tail = ranked.slice(limit - 1);
  const tailAmount = roundToMinorUnit(tail.reduce((sum, slice) => sum + slice.amount, 0));

  return [
    ...head,
    {
      key: 'other',
      categoryId: null,
      label: `Other (${tail.length} categories)`,
      colorHex: null,
      amount: tailAmount,
      share: tailAmount / total,
      isOther: true,
    },
  ];
}

// --- Cash flow --------------------------------------------------------------

export type MonthlyFlow = {
  /** Local midnight on the 1st. Doubles as the series key. */
  monthStart: number;
  income: number;
  expense: number;
  /** income − expense. */
  net: number;
};

/**
 * Income and expense per calendar month across `range`.
 *
 * Months with no activity are emitted as zeros rather than skipped: a gap in
 * a time series must read as "nothing happened", and dropping the month would
 * silently compress the axis so two adjacent columns looked consecutive when
 * they were a year apart.
 */
export function monthlyFlow(
  transactions: readonly Transaction[],
  range: Range,
): MonthlyFlow[] {
  const buckets = new Map<number, {income: number; expense: number}>();
  for (const monthStart of monthStarts(range)) {
    buckets.set(monthStart, {income: 0, expense: 0});
  }

  for (const txn of transactions) {
    if (!isLive(txn) || txn.type === 'TRANSFER') continue;
    if (!inRange(txn.date, range)) continue;

    const bucket = buckets.get(startOfMonth(txn.date));
    if (bucket === undefined) continue;
    if (txn.type === 'INCOME') bucket.income += txn.amount;
    else bucket.expense += txn.amount;
  }

  return [...buckets.entries()].map(([monthStart, {income, expense}]) => {
    const rounded = {
      income: roundToMinorUnit(income),
      expense: roundToMinorUnit(expense),
    };
    return {
      monthStart,
      ...rounded,
      net: roundToMinorUnit(rounded.income - rounded.expense),
    };
  });
}

// --- Net worth --------------------------------------------------------------

export type NetWorthPoint = {date: number; value: number};

/**
 * Net worth sampled across `range`.
 *
 * Net worth at time *t* is a running total from the beginning of the ledger,
 * not from the start of the range, so this seeds with every account's opening
 * balance plus the effect of everything dated before `range.from`. A chart
 * that started each range at zero would say your savings vanished whenever
 * you switched the filter.
 *
 * Only accounts with `includeInBalance` count, matching
 * `computeTotalBalance`, and transactions pointing at an excluded or deleted
 * account are ignored — the same "no phantom balances" direction `addTo`
 * takes in balances.ts. A transfer between an included and an excluded
 * account therefore moves the line, which is correct: the money left the part
 * of the world this number describes.
 *
 * Sampling is lossless *at the points it emits*, because the value is
 * cumulative: a point's value is the true balance on that date whether or not
 * the days between were sampled. Only the exact shape between samples is
 * approximated, which is what a line chart draws anyway.
 */
export function netWorthSeries(
  accounts: readonly Account[],
  transactions: readonly Transaction[],
  range: Range,
  maxPoints = 180,
): NetWorthPoint[] {
  const included = new Set(
    accounts.filter((account) => isLive(account) && account.includeInBalance).map((a) => a.id),
  );
  if (included.size === 0) return [];

  let running = 0;
  for (const account of accounts) {
    if (included.has(account.id)) running += account.openingBalance;
  }

  // Sorting a copy: the caller's array is a live query result shared with
  // every other screen on the page.
  const ordered = transactions
    .filter((txn) => isLive(txn) && txn.date < range.to)
    .sort((a, b) => a.date - b.date);

  let cursor = 0;
  while (cursor < ordered.length && ordered[cursor]!.date < range.from) {
    running += effectOnIncluded(ordered[cursor]!, included);
    cursor += 1;
  }

  const firstDay = startOfDay(range.from);
  // `to` is exclusive, so the last day plotted is the day before it.
  const lastDay = startOfDay(range.to - 1);
  const days = Math.max(0, Math.round((lastDay - firstDay) / 86_400_000));
  const step = Math.max(1, Math.ceil((days + 1) / maxPoints));

  const points: NetWorthPoint[] = [];
  for (let offset = 0; offset <= days; offset += step) {
    // Rebuilt through the Date constructor rather than added as milliseconds,
    // so a DST transition inside the range does not drift the sample times by
    // an hour and land two samples on the same calendar day.
    const day = addDays(firstDay, offset);
    const boundary = addDays(day, 1);
    while (cursor < ordered.length && ordered[cursor]!.date < boundary) {
      running += effectOnIncluded(ordered[cursor]!, included);
      cursor += 1;
    }
    points.push({date: day, value: roundToMinorUnit(running)});
  }

  // Always close on the final day, which a step > 1 would otherwise skip —
  // the right-hand end of a net-worth line is the number the reader came for.
  const last = points[points.length - 1];
  if (last !== undefined && last.date !== lastDay) {
    while (cursor < ordered.length && ordered[cursor]!.date < range.to) {
      running += effectOnIncluded(ordered[cursor]!, included);
      cursor += 1;
    }
    points.push({date: lastDay, value: roundToMinorUnit(running)});
  }

  return points;
}

function addDays(epochMs: number, delta: number): number {
  const date = new Date(epochMs);
  date.setDate(date.getDate() + delta);
  return date.getTime();
}

/** Signed effect of one transaction on the total of the included accounts. */
function effectOnIncluded(txn: Transaction, included: ReadonlySet<string>): number {
  const from = txn.accountId !== null && included.has(txn.accountId);
  const to = txn.toAccountId !== null && included.has(txn.toAccountId);

  switch (txn.type) {
    case 'EXPENSE':
      return from ? -txn.amount : 0;
    case 'INCOME':
      return from ? txn.amount : 0;
    case 'TRANSFER':
      // Both legs inside the set cancel, which is the point: moving money
      // between two of your own tracked wallets leaves net worth unchanged.
      return (to ? txn.amount : 0) - (from ? txn.amount : 0);
  }
}

// --- What changed -----------------------------------------------------------

export type CategoryChange = {
  key: string;
  label: string;
  colorHex: string | null;
  current: number;
  previous: number;
  /** current − previous. Positive means spending went *up*. */
  delta: number;
};

/**
 * Per-category spending change between two equally long spans.
 *
 * This is the question the old app could not answer at all, and the reason
 * it is worth a chart of its own rather than a second column on the spending
 * table: "you spent 12,000 on food" is a fact, "you spent 4,000 more on food
 * than last quarter" is a decision.
 *
 * Categories present in only one of the two spans are kept, with zero on the
 * missing side — a category you stopped spending on entirely is exactly the
 * change worth seeing, and dropping it would quietly hide the best news on
 * the screen.
 */
export function categoryChanges(
  transactions: readonly Transaction[],
  categories: readonly Category[],
  current: Range,
  previous: Range,
  limit = 8,
): CategoryChange[] {
  const byId = new Map(categories.filter(isLive).map((row) => [row.id, row]));
  const totals = new Map<string | null, {current: number; previous: number}>();

  for (const txn of transactions) {
    if (!isLive(txn) || txn.type !== 'EXPENSE') continue;
    const isCurrent = inRange(txn.date, current);
    const isPrevious = inRange(txn.date, previous);
    if (!isCurrent && !isPrevious) continue;

    const entry = totals.get(txn.categoryId) ?? {current: 0, previous: 0};
    if (isCurrent) entry.current += txn.amount;
    else entry.previous += txn.amount;
    totals.set(txn.categoryId, entry);
  }

  return [...totals.entries()]
    .map(([categoryId, sums]) => {
      const category = categoryId === null ? undefined : byId.get(categoryId);
      const currentAmount = roundToMinorUnit(sums.current);
      const previousAmount = roundToMinorUnit(sums.previous);
      return {
        key: categoryId ?? 'uncategorised',
        label:
          category?.name ?? (categoryId === null ? 'Uncategorised' : 'Deleted category'),
        colorHex: category?.colorHex ?? null,
        current: currentAmount,
        previous: previousAmount,
        delta: roundToMinorUnit(currentAmount - previousAmount),
      };
    })
    // Biggest movement in either direction first: a 5,000 drop is as much the
    // story as a 5,000 rise, so this ranks on magnitude, not on signed value.
    .filter((entry) => entry.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.label.localeCompare(b.label))
    .slice(0, limit);
}

// --- Headline numbers -------------------------------------------------------

export type AnalyticsSummary = {
  income: number;
  expense: number;
  net: number;
  /** Mean spending per month across the range, for "is this month unusual?". */
  averageMonthlyExpense: number;
  /** Share of income kept, 0–1. Null when there was no income to keep. */
  savingsRate: number | null;
};

export function summarise(flow: readonly MonthlyFlow[]): AnalyticsSummary {
  const income = roundToMinorUnit(flow.reduce((sum, month) => sum + month.income, 0));
  const expense = roundToMinorUnit(flow.reduce((sum, month) => sum + month.expense, 0));

  return {
    income,
    expense,
    net: roundToMinorUnit(income - expense),
    averageMonthlyExpense:
      flow.length === 0 ? 0 : roundToMinorUnit(expense / flow.length),
    // Undefined rather than zero when nothing came in: 0% saved implies you
    // earned and spent it, which is a different situation from no income.
    savingsRate: income > 0 ? (income - expense) / income : null,
  };
}
