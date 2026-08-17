/**
 * Dates at the UI boundary.
 *
 * Two representations meet here and must not be confused:
 *
 *   - The database stores **epoch milliseconds**, because that is what sorts,
 *     indexes, and compares correctly across time zones.
 *   - Astryx's `DateInput` speaks **`YYYY-MM-DD`**, a calendar date with no
 *     time and no zone.
 *
 * Every conversion between them happens in this file. The conversion is
 * deliberately *local*, not UTC: "the 3rd of August" means the user's 3rd of
 * August. `new Date(iso)` would parse a bare `YYYY-MM-DD` as UTC midnight per
 * the ECMAScript spec, which lands on the 2nd for anyone west of Greenwich —
 * the classic off-by-one-day bug. The parts are pulled out and handed to the
 * `Date(y, m, d)` constructor, which is local by definition.
 */

/** Epoch ms -> `YYYY-MM-DD` in the local zone. */
export function toISODate(epochMs: number): string {
  const date = new Date(epochMs);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * `YYYY-MM-DD` -> epoch ms at local midnight.
 *
 * Returns null for anything that is not a well-formed calendar date, so a
 * cleared or half-typed field cannot write `NaN` into a date column.
 */
export function fromISODate(iso: string | undefined | null): number | null {
  if (!iso) return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(year, month - 1, day);
  // Rejects impossible dates like 2026-02-30, which the constructor rolls
  // forward into March rather than refusing.
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;

  return date.getTime();
}

/**
 * Keep the calendar day from `iso` but preserve the clock time already on
 * `existing`.
 *
 * Editing a transaction's date should not silently move a 14:30 coffee to
 * midnight, which is what writing `fromISODate` straight back would do. Only
 * relevant when re-dating an existing row; new rows get "now".
 */
export function withDateFrom(existing: number, iso: string): number | null {
  const day = fromISODate(iso);
  if (day === null) return null;

  const source = new Date(existing);
  const result = new Date(day);
  result.setHours(
    source.getHours(),
    source.getMinutes(),
    source.getSeconds(),
    source.getMilliseconds(),
  );
  return result.getTime();
}

/** Local midnight starting the day containing `epochMs`. */
export function startOfDay(epochMs: number): number {
  const date = new Date(epochMs);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Local midnight starting the *next* day — the exclusive end of a day range. */
export function endOfDay(epochMs: number): number {
  const date = new Date(epochMs);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 1);
  return date.getTime();
}

export function startOfMonth(epochMs: number): number {
  const date = new Date(epochMs);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

/** Exclusive end: local midnight on the 1st of the following month. */
export function endOfMonth(epochMs: number): number {
  const date = new Date(epochMs);
  return new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime();
}

/** Half-open [from, to) covering the calendar month containing `epochMs`. */
export function monthRange(epochMs: number): {from: number; to: number} {
  return {from: startOfMonth(epochMs), to: endOfMonth(epochMs)};
}

/** Whole days from `from` to `to`, negative when `to` is earlier. */
export function daysBetween(from: number, to: number): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / 86_400_000);
}

/**
 * "Today", "Tomorrow", "3 days ago", or a plain date beyond a week.
 *
 * Relative wording is what makes a due-date list scannable, but it stops being
 * informative past about a week — "in 84 days" tells you less than the date.
 */
export function describeRelativeDay(epochMs: number, now = Date.now()): string {
  const days = daysBetween(now, epochMs);

  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days > 1 && days <= 7) return `In ${days} days`;
  if (days < -1 && days >= -7) return `${Math.abs(days)} days ago`;

  return new Date(epochMs).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: new Date(epochMs).getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric',
  });
}

/** `3 Aug 2026`, for row labels where the exact day matters. */
export function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** `August 2026`, for period headings. */
export function formatMonth(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}
