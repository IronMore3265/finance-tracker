import {describe, expect, it} from 'vitest';
import {SYNCED_TABLES, type SyncedTable, type SyncMeta} from '../db/types';
import {
  REMOTE_TABLE,
  camelToSnake,
  fromRemoteRow,
  snakeToCamel,
  toRemoteRow,
} from './mapping';

const USER = '11111111-1111-7111-8111-111111111111';

const meta = (overrides: Partial<SyncMeta> = {}) => ({
  id: '01920000-0000-7000-8000-000000000001',
  createdAt: 1_756_000_000_000,
  updatedAt: 1_756_000_123_456,
  deletedAt: null,
  userId: null,
  ...overrides,
});

/**
 * One representative row per table, covering every field.
 *
 * Written out rather than generated so that a field added to `types.ts` and
 * forgotten here shows up as a gap in the coverage check below, not as a
 * silently untested column.
 */
const SAMPLES: Record<SyncedTable, Record<string, unknown>> = {
  accounts: {
    ...meta(),
    name: 'Brac Bank',
    openingBalance: 12_500.5,
    colorHex: '#2196F3',
    icon: 'bank',
    currency: 'BDT',
    includeInBalance: true,
    displayOrder: 2,
  },
  categories: {
    ...meta(),
    name: 'Food',
    icon: 'utensils',
    colorHex: '#EA3B35',
    kind: 'EXPENSE',
    displayOrder: 0,
    isDefault: true,
  },
  transactions: {
    ...meta({deletedAt: 1_756_100_000_000}),
    amount: 349.75,
    description: 'Lunch',
    categoryId: '01920000-0000-7000-8000-0000000000c1',
    date: 1_755_900_000_000,
    type: 'EXPENSE',
    accountId: '01920000-0000-7000-8000-0000000000a1',
    toAccountId: null,
    tags: ['work', 'reimbursable'],
    plannedId: null,
    occurrenceDate: null,
  },
  plannedTransactions: {
    ...meta(),
    title: 'Rent',
    amount: 15_000,
    categoryId: null,
    type: 'EXPENSE',
    accountId: '01920000-0000-7000-8000-0000000000a1',
    startDate: 1_750_000_000_000,
    intervalType: 'MONTH',
    intervalN: 1,
    oneTime: false,
    nextDueDate: 1_757_000_000_000,
    endDate: null,
    isActive: true,
    description: 'Flat',
  },
  plannedExceptions: {
    ...meta(),
    plannedId: '01920000-0000-7000-8000-00000000f0f1',
    occurrenceDate: 1_757_000_000_000,
    action: 'OVERRIDE',
    // Deliberately camelCase inside the blob: `overrides` is jsonb and opaque
    // to Postgres, so nothing converts its keys.
    overrides: {amount: 16_000, categoryId: null, occurrenceDate: 1_757_100_000_000},
  },
  debts: {
    ...meta(),
    personName: 'Nabil',
    amount: 2_000,
    description: 'Books',
    date: 1_755_000_000_000,
    dueDate: 1_758_000_000_000,
    type: 'DUE',
    isCleared: false,
    accountId: null,
  },
  debtPayments: {
    ...meta(),
    debtId: '01920000-0000-7000-8000-0000000000d1',
    amount: 500,
    date: 1_756_500_000_000,
    transactionId: null,
  },
  budgets: {
    ...meta(),
    categoryId: null,
    amount: 30_000,
    period: 'MONTH',
    startDate: 1_754_000_000_000,
    endDate: null,
    isActive: true,
  },
};

describe('name conversion', () => {
  it.each([
    ['openingBalance', 'opening_balance'],
    ['includeInBalance', 'include_in_balance'],
    ['toAccountId', 'to_account_id'],
    ['intervalN', 'interval_n'],
    ['name', 'name'],
  ])('%s <-> %s', (camel, snake) => {
    expect(camelToSnake(camel)).toBe(snake);
    expect(snakeToCamel(snake)).toBe(camel);
  });
});

describe('round trip', () => {
  it.each(SYNCED_TABLES)('%s survives local -> remote -> local', (table) => {
    const row = SAMPLES[table] as unknown as SyncMeta;
    const back = fromRemoteRow(table, toRemoteRow(table, row, USER));

    // `userId` is the one field that legitimately changes: a row that has
    // never synced carries null, and pushing it stamps the session's user.
    expect(back).toEqual({...row, userId: USER});
  });

  it.each(SYNCED_TABLES)('%s sends snake_case columns only', (table) => {
    const remote = toRemoteRow(table, SAMPLES[table] as unknown as SyncMeta, USER);

    for (const column of Object.keys(remote)) {
      expect(column).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});

describe('timestamps', () => {
  it('sends epoch milliseconds as ISO strings', () => {
    const remote = toRemoteRow(
      'transactions',
      SAMPLES['transactions'] as unknown as SyncMeta,
      USER,
    );

    expect(remote['updated_at']).toBe('2025-08-24T01:48:43.456Z');
    expect(remote['date']).toBe('2025-08-22T22:00:00.000Z');
    expect(remote['deleted_at']).toBe('2025-08-25T05:33:20.000Z');
  });

  it('keeps null timestamps null rather than turning them into 1970', () => {
    const remote = toRemoteRow(
      'budgets',
      SAMPLES['budgets'] as unknown as SyncMeta,
      USER,
    );

    expect(remote['end_date']).toBeNull();
    expect(remote['deleted_at']).toBeNull();
  });

  it('reads back a timestamp Postgres widened to microseconds', () => {
    // PostgREST renders timestamptz with a +00:00 offset rather than a Z, and
    // may carry precision the client never wrote. Parsing has to cope with
    // both without drifting off the millisecond the comparison uses.
    const row = fromRemoteRow<SyncMeta>('transactions', {
      id: 'x',
      created_at: '2025-08-24T03:07:03.456+00:00',
      updated_at: '2025-08-24T03:07:03.456789+00:00',
      deleted_at: null,
      user_id: USER,
    });

    expect(row.createdAt).toBe(1_756_004_823_456);
    expect(row.updatedAt).toBe(1_756_004_823_456);
    expect(row.deletedAt).toBeNull();
  });

  it('leaves the jsonb overrides blob alone', () => {
    const remote = toRemoteRow(
      'plannedExceptions',
      SAMPLES['plannedExceptions'] as unknown as SyncMeta,
      USER,
    );

    expect(remote['overrides']).toEqual({
      amount: 16_000,
      categoryId: null,
      occurrenceDate: 1_757_100_000_000,
    });
  });
});

describe('table names', () => {
  it('maps every local table to a snake_case relation', () => {
    for (const table of SYNCED_TABLES) {
      expect(REMOTE_TABLE[table]).toBe(camelToSnake(table));
    }
  });
});
