import {describe, expect, it} from 'vitest';
import type {Account, Category, Transaction, TransactionType} from '../db/types';
import {
  categoryChanges,
  monthStarts,
  monthlyFlow,
  netWorthSeries,
  resolveRange,
  spendByCategory,
  summarise,
} from './analytics';

const at = (y: number, m: number, d: number, h = 12): number =>
  new Date(y, m - 1, d, h, 0, 0, 0).getTime();

let seq = 0;

function txn(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: `txn-${(seq += 1)}`,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    userId: null,
    amount: 100,
    description: '',
    categoryId: null,
    date: at(2026, 6, 15),
    type: 'EXPENSE' as TransactionType,
    accountId: 'acc-1',
    toAccountId: null,
    tags: [],
    plannedId: null,
    occurrenceDate: null,
    ...overrides,
  };
}

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: `acc-${(seq += 1)}`,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    userId: null,
    name: 'Cash',
    openingBalance: 0,
    colorHex: '#2196F3',
    icon: 'wallet',
    currency: 'BDT',
    includeInBalance: true,
    displayOrder: 0,
    ...overrides,
  };
}

function category(id: string, name: string, colorHex = '#EA3B35'): Category {
  return {
    id,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    userId: null,
    name,
    icon: 'utensils',
    colorHex,
    kind: 'EXPENSE',
    displayOrder: 0,
    isDefault: false,
  };
}

describe('resolveRange', () => {
  const now = at(2026, 8, 18);

  it('aligns to whole calendar months and ends at the start of next month', () => {
    const {current} = resolveRange('3M', [], now);
    expect(current.from).toBe(at(2026, 6, 1, 0));
    expect(current.to).toBe(at(2026, 9, 1, 0));
  });

  it('gives the previous span the same length, ending where the current one starts', () => {
    const {current, previous} = resolveRange('6M', [], now);
    expect(previous).not.toBeNull();
    expect(previous!.to).toBe(current.from);
    expect(previous!.from).toBe(at(2025, 9, 1, 0));
  });

  it('starts ALL at the earliest live transaction and offers no previous span', () => {
    const rows = [
      txn({date: at(2025, 3, 17)}),
      txn({date: at(2026, 1, 2)}),
      // Deleted rows must not drag the start of the range backwards.
      txn({date: at(2019, 1, 1), deletedAt: 5}),
    ];
    const {current, previous} = resolveRange('ALL', rows, now);
    expect(current.from).toBe(at(2025, 3, 1, 0));
    expect(previous).toBeNull();
  });

  it('falls back to the current month when there are no transactions at all', () => {
    const {current} = resolveRange('ALL', [], now);
    expect(current.from).toBe(at(2026, 8, 1, 0));
    expect(current.to).toBe(at(2026, 9, 1, 0));
  });
});

describe('monthStarts', () => {
  it('lists every month start inside a half-open range', () => {
    const starts = monthStarts({from: at(2026, 6, 1, 0), to: at(2026, 9, 1, 0)});
    expect(starts).toEqual([at(2026, 6, 1, 0), at(2026, 7, 1, 0), at(2026, 8, 1, 0)]);
  });

  it('returns nothing for an empty or backwards range', () => {
    expect(monthStarts({from: at(2026, 9, 1, 0), to: at(2026, 9, 1, 0)})).toEqual([]);
    expect(monthStarts({from: at(2026, 9, 1, 0), to: at(2026, 6, 1, 0)})).toEqual([]);
  });
});

describe('spendByCategory', () => {
  const range = {from: at(2026, 8, 1, 0), to: at(2026, 9, 1, 0)};
  const categories = [category('food', 'Food'), category('bus', 'Transport', '#2196F3')];

  it('totals expenses per category, largest first, with shares summing to one', () => {
    const rows = [
      txn({categoryId: 'food', amount: 300, date: at(2026, 8, 2)}),
      txn({categoryId: 'food', amount: 200, date: at(2026, 8, 9)}),
      txn({categoryId: 'bus', amount: 500, date: at(2026, 8, 4)}),
    ];
    const slices = spendByCategory(rows, categories, range);

    // Equal amounts fall back to the name, so the order is stable between
    // renders rather than following Map insertion order.
    expect(slices.map((s) => [s.label, s.amount])).toEqual([
      ['Food', 500],
      ['Transport', 500],
    ]);
    expect(slices.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1);
    expect(slices[1]!.colorHex).toBe('#2196F3');
  });

  it('ignores income, transfers, deleted rows and anything outside the range', () => {
    const rows = [
      txn({categoryId: 'food', amount: 100, date: at(2026, 8, 2)}),
      txn({categoryId: 'food', amount: 999, type: 'INCOME', date: at(2026, 8, 2)}),
      txn({categoryId: 'food', amount: 999, type: 'TRANSFER', date: at(2026, 8, 2)}),
      txn({categoryId: 'food', amount: 999, date: at(2026, 8, 2), deletedAt: 1}),
      // Exactly `to` belongs to the next period, not this one.
      txn({categoryId: 'food', amount: 999, date: at(2026, 9, 1, 0)}),
      txn({categoryId: 'food', amount: 999, date: at(2026, 7, 31)}),
    ];
    expect(spendByCategory(rows, categories, range)).toEqual([
      expect.objectContaining({label: 'Food', amount: 100, share: 1}),
    ]);
  });

  it('names the two kinds of missing category differently', () => {
    const rows = [
      txn({categoryId: null, amount: 100, date: at(2026, 8, 2)}),
      txn({categoryId: 'gone', amount: 50, date: at(2026, 8, 3)}),
    ];
    const slices = spendByCategory(rows, categories, range);
    expect(slices.map((s) => s.label)).toEqual(['Uncategorised', 'Deleted category']);
  });

  it('folds everything past the limit into one Other bucket', () => {
    const many = Array.from({length: 10}, (_, i) => category(`c${i}`, `Cat ${i}`));
    const rows = many.map((cat, i) =>
      txn({categoryId: cat.id, amount: (10 - i) * 100, date: at(2026, 8, 5)}),
    );

    const slices = spendByCategory(rows, many, range, 4);
    expect(slices).toHaveLength(4);
    expect(slices[3]!.isOther).toBe(true);
    expect(slices[3]!.label).toBe('Other (7 categories)');
    // Nothing is lost to the fold.
    expect(slices.reduce((sum, s) => sum + s.amount, 0)).toBe(5500);
    expect(slices.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1);
  });

  it('returns nothing rather than dividing by a zero total', () => {
    expect(spendByCategory([], categories, range)).toEqual([]);
  });
});

describe('monthlyFlow', () => {
  const range = {from: at(2026, 6, 1, 0), to: at(2026, 9, 1, 0)};

  it('emits every month in the range, including empty ones', () => {
    const flow = monthlyFlow([txn({amount: 100, date: at(2026, 7, 4)})], range);
    expect(flow.map((m) => m.monthStart)).toEqual([
      at(2026, 6, 1, 0),
      at(2026, 7, 1, 0),
      at(2026, 8, 1, 0),
    ]);
    expect(flow[0]).toEqual({monthStart: at(2026, 6, 1, 0), income: 0, expense: 0, net: 0});
  });

  it('separates income from expense and excludes transfers', () => {
    const rows = [
      txn({type: 'INCOME', amount: 5000, date: at(2026, 7, 1)}),
      txn({type: 'EXPENSE', amount: 1200, date: at(2026, 7, 10)}),
      txn({type: 'TRANSFER', amount: 9999, date: at(2026, 7, 11)}),
    ];
    const july = monthlyFlow(rows, range)[1]!;
    expect(july).toEqual({
      monthStart: at(2026, 7, 1, 0),
      income: 5000,
      expense: 1200,
      net: 3800,
    });
  });
});

describe('netWorthSeries', () => {
  const accounts = [
    account({id: 'a', openingBalance: 1000}),
    account({id: 'b', openingBalance: 500}),
  ];

  it('carries opening balances and pre-range history into the first point', () => {
    const range = {from: at(2026, 8, 1, 0), to: at(2026, 8, 4, 0)};
    const rows = [txn({accountId: 'a', amount: 200, date: at(2026, 7, 20)})];

    const points = netWorthSeries(accounts, rows, range);
    // 1500 opening, less the 200 spent before the range began.
    expect(points[0]).toEqual({date: at(2026, 8, 1, 0), value: 1300});
  });

  it('steps on the day a transaction lands and holds flat after', () => {
    const range = {from: at(2026, 8, 1, 0), to: at(2026, 8, 5, 0)};
    const rows = [
      txn({accountId: 'a', amount: 300, date: at(2026, 8, 2)}),
      txn({accountId: 'b', type: 'INCOME', amount: 100, date: at(2026, 8, 3)}),
    ];

    expect(netWorthSeries(accounts, rows, range).map((p) => p.value)).toEqual([
      1500, 1200, 1300, 1300,
    ]);
  });

  it('leaves net worth unchanged for a transfer between two included accounts', () => {
    const range = {from: at(2026, 8, 1, 0), to: at(2026, 8, 3, 0)};
    const rows = [
      txn({type: 'TRANSFER', accountId: 'a', toAccountId: 'b', amount: 400, date: at(2026, 8, 2)}),
    ];
    expect(netWorthSeries(accounts, rows, range).map((p) => p.value)).toEqual([1500, 1500]);
  });

  it('moves net worth when a transfer leaves the included set', () => {
    const withExcluded = [...accounts, account({id: 'c', includeInBalance: false})];
    const range = {from: at(2026, 8, 1, 0), to: at(2026, 8, 3, 0)};
    const rows = [
      txn({type: 'TRANSFER', accountId: 'a', toAccountId: 'c', amount: 400, date: at(2026, 8, 2)}),
    ];
    expect(netWorthSeries(withExcluded, rows, range).map((p) => p.value)).toEqual([1500, 1100]);
  });

  it('ignores transactions on accounts it does not track', () => {
    const range = {from: at(2026, 8, 1, 0), to: at(2026, 8, 3, 0)};
    const rows = [txn({accountId: 'deleted-account', amount: 500, date: at(2026, 8, 2)})];
    expect(netWorthSeries(accounts, rows, range).map((p) => p.value)).toEqual([1500, 1500]);
  });

  it('downsamples long ranges but always closes on the final day', () => {
    const range = {from: at(2025, 1, 1, 0), to: at(2026, 1, 1, 0)};
    const points = netWorthSeries(accounts, [], range, 30);

    expect(points.length).toBeLessThanOrEqual(31);
    expect(points[0]!.date).toBe(at(2025, 1, 1, 0));
    expect(points[points.length - 1]!.date).toBe(at(2025, 12, 31, 0));
  });

  it('returns nothing when no account counts toward the balance', () => {
    const excluded = [account({id: 'x', includeInBalance: false})];
    const range = {from: at(2026, 8, 1, 0), to: at(2026, 8, 3, 0)};
    expect(netWorthSeries(excluded, [], range)).toEqual([]);
  });
});

describe('categoryChanges', () => {
  const current = {from: at(2026, 8, 1, 0), to: at(2026, 9, 1, 0)};
  const previous = {from: at(2026, 7, 1, 0), to: at(2026, 8, 1, 0)};
  const categories = [category('food', 'Food'), category('bus', 'Transport')];

  it('ranks by the size of the movement, in either direction', () => {
    const rows = [
      txn({categoryId: 'food', amount: 1000, date: at(2026, 8, 5)}),
      txn({categoryId: 'food', amount: 400, date: at(2026, 7, 5)}),
      txn({categoryId: 'bus', amount: 100, date: at(2026, 8, 5)}),
      txn({categoryId: 'bus', amount: 900, date: at(2026, 7, 5)}),
    ];

    expect(categoryChanges(rows, categories, current, previous)).toEqual([
      expect.objectContaining({label: 'Transport', current: 100, previous: 900, delta: -800}),
      expect.objectContaining({label: 'Food', current: 1000, previous: 400, delta: 600}),
    ]);
  });

  it('keeps a category that appears in only one of the two spans', () => {
    const rows = [txn({categoryId: 'food', amount: 700, date: at(2026, 7, 5)})];
    expect(categoryChanges(rows, categories, current, previous)).toEqual([
      expect.objectContaining({label: 'Food', current: 0, previous: 700, delta: -700}),
    ]);
  });

  it('drops categories that did not move', () => {
    const rows = [
      txn({categoryId: 'food', amount: 500, date: at(2026, 8, 5)}),
      txn({categoryId: 'food', amount: 500, date: at(2026, 7, 5)}),
    ];
    expect(categoryChanges(rows, categories, current, previous)).toEqual([]);
  });
});

describe('summarise', () => {
  it('averages spending over the months shown, not the months with activity', () => {
    const flow = monthlyFlow(
      [
        txn({type: 'INCOME', amount: 9000, date: at(2026, 7, 1)}),
        txn({type: 'EXPENSE', amount: 3000, date: at(2026, 7, 2)}),
      ],
      {from: at(2026, 6, 1, 0), to: at(2026, 9, 1, 0)},
    );

    expect(summarise(flow)).toEqual({
      income: 9000,
      expense: 3000,
      net: 6000,
      averageMonthlyExpense: 1000,
      savingsRate: 6000 / 9000,
    });
  });

  it('reports no savings rate rather than zero when nothing came in', () => {
    const flow = monthlyFlow([txn({amount: 100, date: at(2026, 7, 2)})], {
      from: at(2026, 7, 1, 0),
      to: at(2026, 8, 1, 0),
    });
    expect(summarise(flow).savingsRate).toBeNull();
  });
});
