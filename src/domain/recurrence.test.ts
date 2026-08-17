import {describe, expect, it} from 'vitest';
import type {PlannedException, PlannedTransaction} from '../db/types';
import {
  indexOnOrAfter,
  nextOccurrence,
  occurrenceAt,
  occurrencesBetween,
  overdueOccurrences,
  splitSeriesAt,
} from './recurrence';

/** Local-time date literal, so assertions read as calendar dates. */
const at = (
  y: number,
  m: number,
  d: number,
  hh = 9,
  mm = 0,
): number => new Date(y, m - 1, d, hh, mm, 0, 0).getTime();

const asDate = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
};

let seq = 0;

function rule(overrides: Partial<PlannedTransaction> = {}): PlannedTransaction {
  return {
    id: `plan-${(seq += 1)}`,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    userId: null,
    title: 'Netflix',
    amount: 500,
    categoryId: null,
    type: 'EXPENSE',
    accountId: null,
    startDate: at(2026, 1, 15),
    intervalType: 'MONTH',
    intervalN: 1,
    oneTime: false,
    nextDueDate: at(2026, 1, 15),
    endDate: null,
    isActive: true,
    description: '',
    ...overrides,
  };
}

function exception(
  overrides: Partial<PlannedException> & Pick<PlannedException, 'plannedId' | 'occurrenceDate' | 'action'>,
): PlannedException {
  return {
    id: `exc-${(seq += 1)}`,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    userId: null,
    overrides: {},
    ...overrides,
  };
}

describe('occurrenceAt', () => {
  it('steps daily', () => {
    const r = rule({intervalType: 'DAY', intervalN: 1, startDate: at(2026, 3, 1)});
    expect(asDate(occurrenceAt(r, 0))).toBe('2026-03-01');
    expect(asDate(occurrenceAt(r, 5))).toBe('2026-03-06');
  });

  it('steps every N days and weeks', () => {
    const every3Days = rule({
      intervalType: 'DAY',
      intervalN: 3,
      startDate: at(2026, 3, 1),
    });
    expect(asDate(occurrenceAt(every3Days, 2))).toBe('2026-03-07');

    const biweekly = rule({
      intervalType: 'WEEK',
      intervalN: 2,
      startDate: at(2026, 3, 2),
    });
    expect(asDate(occurrenceAt(biweekly, 1))).toBe('2026-03-16');
  });

  it('preserves time of day', () => {
    const r = rule({intervalType: 'DAY', startDate: at(2026, 3, 1, 14, 30)});
    const occurrence = new Date(occurrenceAt(r, 10));
    expect(occurrence.getHours()).toBe(14);
    expect(occurrence.getMinutes()).toBe(30);
  });

  /**
   * The month-end case. A rule anchored on the 31st must not be dragged back
   * to the 28th permanently by a single short month.
   */
  it('anchors to the start day rather than drifting after a short month', () => {
    const r = rule({intervalType: 'MONTH', startDate: at(2026, 1, 31)});
    expect(asDate(occurrenceAt(r, 0))).toBe('2026-01-31');
    expect(asDate(occurrenceAt(r, 1))).toBe('2026-02-28'); // clamped
    expect(asDate(occurrenceAt(r, 2))).toBe('2026-03-31'); // recovers
    expect(asDate(occurrenceAt(r, 3))).toBe('2026-04-30'); // clamped again
    expect(asDate(occurrenceAt(r, 4))).toBe('2026-05-31');
  });

  it('clamps 30th into February too', () => {
    const r = rule({intervalType: 'MONTH', startDate: at(2026, 1, 30)});
    expect(asDate(occurrenceAt(r, 1))).toBe('2026-02-28');
    expect(asDate(occurrenceAt(r, 2))).toBe('2026-03-30');
  });

  it('handles leap years for a 29 Feb yearly rule', () => {
    const r = rule({intervalType: 'YEAR', startDate: at(2024, 2, 29)});
    expect(asDate(occurrenceAt(r, 0))).toBe('2024-02-29');
    expect(asDate(occurrenceAt(r, 1))).toBe('2025-02-28'); // clamped
    expect(asDate(occurrenceAt(r, 4))).toBe('2028-02-29'); // leap again
  });

  it('crosses year boundaries for multi-month intervals', () => {
    const quarterly = rule({
      intervalType: 'MONTH',
      intervalN: 3,
      startDate: at(2026, 11, 15),
    });
    expect(asDate(occurrenceAt(quarterly, 1))).toBe('2027-02-15');
    expect(asDate(occurrenceAt(quarterly, 2))).toBe('2027-05-15');
  });
});

describe('indexOnOrAfter', () => {
  it('finds the first occurrence at or after a timestamp', () => {
    const r = rule({intervalType: 'MONTH', startDate: at(2026, 1, 15)});
    expect(indexOnOrAfter(r, at(2026, 1, 15))).toBe(0); // inclusive
    expect(indexOnOrAfter(r, at(2026, 1, 16))).toBe(1);
    expect(indexOnOrAfter(r, at(2026, 6, 1))).toBe(5);
  });

  it('returns 0 for a timestamp before the series starts', () => {
    const r = rule({startDate: at(2026, 5, 1)});
    expect(indexOnOrAfter(r, at(2020, 1, 1))).toBe(0);
  });

  it('is efficient for a long-running daily rule', () => {
    const r = rule({intervalType: 'DAY', startDate: at(2020, 1, 1)});
    expect(indexOnOrAfter(r, at(2026, 1, 1))).toBe(2192);
  });

  it('returns null once the series has ended', () => {
    const r = rule({startDate: at(2026, 1, 15), endDate: at(2026, 3, 20)});
    expect(indexOnOrAfter(r, at(2026, 6, 1))).toBeNull();
  });

  it('treats a one-time rule as a single occurrence', () => {
    const r = rule({oneTime: true, startDate: at(2026, 4, 10)});
    expect(indexOnOrAfter(r, at(2026, 1, 1))).toBe(0);
    expect(indexOnOrAfter(r, at(2026, 5, 1))).toBeNull();
  });
});

describe('occurrencesBetween', () => {
  it('lists occurrences in a half-open interval', () => {
    const r = rule({intervalType: 'MONTH', startDate: at(2026, 1, 15)});
    const found = occurrencesBetween(r, at(2026, 1, 1), at(2026, 5, 1));
    expect(found.map((o) => asDate(o.occurrenceDate))).toEqual([
      '2026-01-15',
      '2026-02-15',
      '2026-03-15',
      '2026-04-15',
    ]);
  });

  it('omits skipped occurrences without shifting the rest', () => {
    const r = rule({intervalType: 'MONTH', startDate: at(2026, 1, 15)});
    const skipped = [
      exception({
        plannedId: r.id,
        occurrenceDate: at(2026, 2, 15),
        action: 'SKIP',
      }),
    ];
    const found = occurrencesBetween(r, at(2026, 1, 1), at(2026, 5, 1), skipped);
    expect(found.map((o) => asDate(o.occurrenceDate))).toEqual([
      '2026-01-15',
      '2026-03-15',
      '2026-04-15',
    ]);
  });

  it('applies overrides to a single occurrence only', () => {
    const r = rule({intervalType: 'MONTH', startDate: at(2026, 1, 15), amount: 500});
    const overridden = [
      exception({
        plannedId: r.id,
        occurrenceDate: at(2026, 2, 15),
        action: 'OVERRIDE',
        overrides: {amount: 650, title: 'Netflix (price rise)'},
      }),
    ];
    const found = occurrencesBetween(r, at(2026, 1, 1), at(2026, 4, 1), overridden);
    expect(found.map((o) => o.amount)).toEqual([500, 650, 500]);
    expect(found[1]?.title).toBe('Netflix (price rise)');
    // The canonical date is untouched, so the occurrence keeps its identity.
    expect(asDate(found[1]!.occurrenceDate)).toBe('2026-02-15');
  });

  it('lets an override move one occurrence to a different date', () => {
    const r = rule({intervalType: 'MONTH', startDate: at(2026, 1, 15)});
    const moved = [
      exception({
        plannedId: r.id,
        occurrenceDate: at(2026, 2, 15),
        action: 'OVERRIDE',
        overrides: {occurrenceDate: at(2026, 2, 20)},
      }),
    ];
    const found = occurrencesBetween(r, at(2026, 2, 1), at(2026, 3, 1), moved);
    expect(asDate(found[0]!.occurrenceDate)).toBe('2026-02-15');
    expect(asDate(found[0]!.effectiveDate)).toBe('2026-02-20');
  });

  it('stops at endDate', () => {
    const r = rule({startDate: at(2026, 1, 15), endDate: at(2026, 3, 20)});
    const found = occurrencesBetween(r, at(2026, 1, 1), at(2026, 12, 1));
    expect(found).toHaveLength(3);
  });

  it('returns nothing for an inactive or deleted rule', () => {
    const window = [at(2026, 1, 1), at(2026, 12, 1)] as const;
    expect(occurrencesBetween(rule({isActive: false}), ...window)).toEqual([]);
    expect(occurrencesBetween(rule({deletedAt: 1}), ...window)).toEqual([]);
  });

  it('yields at most one occurrence for a one-time rule', () => {
    const r = rule({oneTime: true, startDate: at(2026, 2, 10)});
    expect(occurrencesBetween(r, at(2026, 1, 1), at(2027, 1, 1))).toHaveLength(1);
  });
});

describe('nextOccurrence', () => {
  it('returns the upcoming occurrence', () => {
    const r = rule({intervalType: 'MONTH', startDate: at(2026, 1, 15)});
    expect(asDate(nextOccurrence(r, at(2026, 3, 1))!.occurrenceDate)).toBe('2026-03-15');
  });

  it('steps over a skipped occurrence', () => {
    const r = rule({intervalType: 'MONTH', startDate: at(2026, 1, 15)});
    const skipped = [
      exception({plannedId: r.id, occurrenceDate: at(2026, 3, 15), action: 'SKIP'}),
    ];
    expect(asDate(nextOccurrence(r, at(2026, 3, 1), skipped)!.occurrenceDate)).toBe(
      '2026-04-15',
    );
  });

  it('is null past the end of the series', () => {
    const r = rule({startDate: at(2026, 1, 15), endDate: at(2026, 2, 1)});
    expect(nextOccurrence(r, at(2026, 6, 1))).toBeNull();
  });
});

describe('overdueOccurrences', () => {
  it('reports unpaid past occurrences', () => {
    const r = rule({intervalType: 'MONTH', startDate: at(2026, 1, 15)});
    const overdue = overdueOccurrences(r, at(2026, 4, 1), new Set());
    expect(overdue.map((o) => asDate(o.occurrenceDate))).toEqual([
      '2026-01-15',
      '2026-02-15',
      '2026-03-15',
    ]);
  });

  it('excludes occurrences already paid', () => {
    const r = rule({intervalType: 'MONTH', startDate: at(2026, 1, 15)});
    const paid = new Set([at(2026, 1, 15), at(2026, 2, 15)]);
    const overdue = overdueOccurrences(r, at(2026, 4, 1), paid);
    expect(overdue.map((o) => asDate(o.occurrenceDate))).toEqual(['2026-03-15']);
  });

  it('excludes skipped occurrences', () => {
    const r = rule({intervalType: 'MONTH', startDate: at(2026, 1, 15)});
    const skipped = [
      exception({plannedId: r.id, occurrenceDate: at(2026, 2, 15), action: 'SKIP'}),
    ];
    const overdue = overdueOccurrences(r, at(2026, 4, 1), new Set(), skipped);
    expect(overdue.map((o) => asDate(o.occurrenceDate))).toEqual([
      '2026-01-15',
      '2026-03-15',
    ]);
  });
});

describe('splitSeriesAt', () => {
  it('caps the old rule just before the new one begins, leaving no gap or overlap', () => {
    const r = rule({intervalType: 'MONTH', startDate: at(2026, 1, 15)});
    const {endDate, newStartDate} = splitSeriesAt(at(2026, 4, 15));

    expect(newStartDate - endDate).toBe(1);

    // Occurrences up to the split stay with the original rule...
    const capped = {...r, endDate};
    expect(occurrencesBetween(capped, at(2026, 1, 1), at(2027, 1, 1))).toHaveLength(3);

    // ...and the split occurrence itself belongs to the new rule.
    const successor = {...r, startDate: newStartDate, endDate: null};
    expect(asDate(occurrenceAt(successor, 0))).toBe('2026-04-15');
  });
});
