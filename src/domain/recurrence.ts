/**
 * Recurrence rules for planned transactions.
 *
 * The old app stored only a `nextDueDate` and advanced it in place, which is
 * why an occurrence could never be corrected after the fact: there was no
 * notion of an occurrence, just a moving pointer. Here a rule generates an
 * indexed sequence of occurrences, and individual occurrences can be skipped
 * or overridden without disturbing the rest of the series.
 *
 * Two things this gets right that naive implementations usually do not:
 *
 *  1. **Month-end anchoring.** A rule starting 31 Jan yields 31 Jan, 28 Feb,
 *     31 Mar — not 28 Feb, 28 Mar, 28 Apr. Every occurrence is computed from
 *     the original start date, so a clamped month never drags the rest of the
 *     series backwards.
 *
 *  2. **DST safety.** Dates advance by calendar fields, never by adding
 *     86_400_000 ms. A daily 09:00 reminder stays at 09:00 across a DST
 *     boundary instead of sliding to 08:00 or 10:00.
 */
import type {IntervalType, PlannedException, PlannedTransaction} from '../db/types';

/**
 * Just the fields that define a schedule.
 *
 * The date arithmetic reads nothing else, so taking this rather than a whole
 * `PlannedTransaction` lets a caller ask "when would this fire?" about a rule
 * being composed in a form, before it has an id or sync metadata. Any real
 * `PlannedTransaction` satisfies it structurally.
 */
export type RecurrenceRule = Pick<
  PlannedTransaction,
  'startDate' | 'intervalType' | 'intervalN' | 'oneTime' | 'endDate'
>;

/** Days in a given month; `month` is 0-indexed, matching Date. */
function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(year, month + 1, 0).getDate();
}

/**
 * Advance `start` by `delta` units, clamping to the end of the target month
 * where the anchor day does not exist (31 Jan + 1 month -> 28/29 Feb).
 */
export function shift(start: Date, type: IntervalType, delta: number): Date {
  const result = new Date(start.getTime());

  switch (type) {
    case 'DAY':
      result.setDate(start.getDate() + delta);
      return result;
    case 'WEEK':
      result.setDate(start.getDate() + delta * 7);
      return result;
    case 'MONTH': {
      // Move to the 1st first: setMonth on the 31st would roll over into the
      // following month when the target is shorter.
      result.setDate(1);
      result.setMonth(start.getMonth() + delta);
      result.setDate(
        Math.min(start.getDate(), daysInMonth(result.getFullYear(), result.getMonth())),
      );
      return result;
    }
    case 'YEAR': {
      result.setDate(1);
      result.setFullYear(start.getFullYear() + delta);
      // Catches 29 Feb in a non-leap year.
      result.setDate(
        Math.min(start.getDate(), daysInMonth(result.getFullYear(), result.getMonth())),
      );
      return result;
    }
  }
}

/** Date of the `index`-th occurrence (0-based), ignoring exceptions. */
export function occurrenceAt(rule: RecurrenceRule, index: number): number {
  if (index < 0) throw new RangeError('Occurrence index must be >= 0');
  const step = Math.max(1, Math.trunc(rule.intervalN));
  return shift(new Date(rule.startDate), rule.intervalType, index * step).getTime();
}

/** Approximate index for `timestamp`, used as a search seed rather than an answer. */
function estimateIndex(rule: RecurrenceRule, timestamp: number): number {
  const start = new Date(rule.startDate);
  const target = new Date(timestamp);
  const step = Math.max(1, Math.trunc(rule.intervalN));

  switch (rule.intervalType) {
    case 'DAY':
    case 'WEEK': {
      const perStep = (rule.intervalType === 'WEEK' ? 7 : 1) * step;
      const days = Math.floor((timestamp - rule.startDate) / 86_400_000);
      return Math.floor(days / perStep);
    }
    case 'MONTH': {
      const months =
        (target.getFullYear() - start.getFullYear()) * 12 +
        (target.getMonth() - start.getMonth());
      return Math.floor(months / step);
    }
    case 'YEAR':
      return Math.floor((target.getFullYear() - start.getFullYear()) / step);
  }
}

/** True once the series has run past `endDate`. */
function isPastEnd(rule: RecurrenceRule, timestamp: number): boolean {
  return rule.endDate !== null && timestamp > rule.endDate;
}

/**
 * Index of the first occurrence at or after `timestamp`, or null if the series
 * ends first.
 *
 * Seeds from an estimate then walks, so a daily rule started years ago costs a
 * handful of steps rather than thousands.
 */
export function indexOnOrAfter(
  rule: RecurrenceRule,
  timestamp: number,
): number | null {
  if (rule.oneTime) {
    const only = occurrenceAt(rule, 0);
    return only >= timestamp && !isPastEnd(rule, only) ? 0 : null;
  }

  let index = Math.max(0, estimateIndex(rule, timestamp));

  // Walk back to the first index that is genuinely before the target, so the
  // forward walk below cannot skip past the answer.
  while (index > 0 && occurrenceAt(rule, index - 1) >= timestamp) index -= 1;

  // Then walk forward to the first occurrence at or after it.
  for (let guard = 0; guard < 1000; guard += 1) {
    const at = occurrenceAt(rule, index);
    if (isPastEnd(rule, at)) return null;
    if (at >= timestamp) return index;
    index += 1;
  }

  return null;
}

/** Exceptions indexed by the occurrence they apply to. */
export function indexExceptions(
  exceptions: readonly PlannedException[],
): Map<number, PlannedException> {
  const byDate = new Map<number, PlannedException>();
  for (const exception of exceptions) {
    if (exception.deletedAt !== null) continue;
    byDate.set(exception.occurrenceDate, exception);
  }
  return byDate;
}

export type Occurrence = {
  /** Canonical date generated by the rule. Stable identity for the occurrence. */
  occurrenceDate: number;
  /** Date after any override — what the user actually sees. */
  effectiveDate: number;
  index: number;
  amount: number;
  title: string;
  categoryId: string | null;
  accountId: string | null;
  description: string;
};

function materialize(
  rule: PlannedTransaction,
  index: number,
  exception: PlannedException | undefined,
): Occurrence {
  const occurrenceDate = occurrenceAt(rule, index);
  const overrides = exception?.action === 'OVERRIDE' ? exception.overrides : undefined;

  return {
    occurrenceDate,
    effectiveDate: overrides?.occurrenceDate ?? occurrenceDate,
    index,
    amount: overrides?.amount ?? rule.amount,
    title: overrides?.title ?? rule.title,
    categoryId: overrides?.categoryId ?? rule.categoryId,
    accountId: overrides?.accountId ?? rule.accountId,
    description: overrides?.description ?? rule.description,
  };
}

/**
 * Occurrences falling in the half-open interval [from, to), with SKIP
 * exceptions removed and OVERRIDE exceptions applied.
 */
export function occurrencesBetween(
  rule: PlannedTransaction,
  from: number,
  to: number,
  exceptions: readonly PlannedException[] = [],
  limit = 500,
): Occurrence[] {
  if (!rule.isActive || rule.deletedAt !== null) return [];

  const byDate = indexExceptions(exceptions);
  const results: Occurrence[] = [];

  let index = indexOnOrAfter(rule, from);
  if (index === null) return results;

  while (results.length < limit) {
    const occurrenceDate = occurrenceAt(rule, index);
    if (occurrenceDate >= to || isPastEnd(rule, occurrenceDate)) break;

    const exception = byDate.get(occurrenceDate);
    if (exception?.action !== 'SKIP') {
      results.push(materialize(rule, index, exception));
    }

    if (rule.oneTime) break;
    index += 1;
  }

  return results;
}

/**
 * The next occurrence due at or after `from`, skipping exceptions.
 *
 * This is what replaces the old app's mutable `nextDueDate` pointer: the due
 * date is computed from the rule and the ledger, so editing or skipping one
 * occurrence cannot corrupt the schedule.
 */
export function nextOccurrence(
  rule: PlannedTransaction,
  from: number,
  exceptions: readonly PlannedException[] = [],
): Occurrence | null {
  if (!rule.isActive || rule.deletedAt !== null) return null;

  const byDate = indexExceptions(exceptions);
  let index = indexOnOrAfter(rule, from);
  if (index === null) return null;

  for (let guard = 0; guard < 1000; guard += 1) {
    const occurrenceDate = occurrenceAt(rule, index);
    if (isPastEnd(rule, occurrenceDate)) return null;

    const exception = byDate.get(occurrenceDate);
    if (exception?.action !== 'SKIP') {
      return materialize(rule, index, exception);
    }

    if (rule.oneTime) return null;
    index += 1;
  }

  return null;
}

/**
 * Occurrences that were due before `asOf` and have not been paid.
 *
 * `paidOccurrenceDates` comes from transactions already materialized for this
 * rule, so paying an occurrence removes it from this list without any pointer
 * being advanced.
 */
export function overdueOccurrences(
  rule: PlannedTransaction,
  asOf: number,
  paidOccurrenceDates: ReadonlySet<number>,
  exceptions: readonly PlannedException[] = [],
  lookbackDays = 365,
): Occurrence[] {
  const from = shift(new Date(asOf), 'DAY', -lookbackDays).getTime();
  return occurrencesBetween(rule, from, asOf, exceptions).filter(
    (occurrence) => !paidOccurrenceDates.has(occurrence.occurrenceDate),
  );
}

/**
 * Split a series for a "this and all future occurrences" edit.
 *
 * The original rule is capped just before `fromDate` rather than deleted, so
 * history stays intact and already-paid occurrences keep their rule.
 */
export function splitSeriesAt(fromDate: number): {
  endDate: number;
  newStartDate: number;
} {
  return {endDate: fromDate - 1, newStartDate: fromDate};
}
