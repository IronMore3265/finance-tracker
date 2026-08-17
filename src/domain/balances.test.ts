import {describe, expect, it} from 'vitest';
import type {Account, Transaction, TransactionType} from '../db/types';
import {
  computeBalances,
  computeSpendByCategory,
  computeTotalBalance,
  computeTotals,
  effectOnAccount,
} from './balances';

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${(seq += 1)}`;

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: nextId('acc'),
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

function txn(
  type: TransactionType,
  amount: number,
  overrides: Partial<Transaction> = {},
): Transaction {
  return {
    id: nextId('txn'),
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    userId: null,
    amount,
    description: '',
    categoryId: null,
    date: 0,
    type,
    accountId: null,
    toAccountId: null,
    tags: [],
    plannedId: null,
    occurrenceDate: null,
    ...overrides,
  };
}

describe('computeBalances', () => {
  it('starts from openingBalance when there are no transactions', () => {
    const cash = account({openingBalance: 500});
    expect(computeBalances([cash], []).get(cash.id)).toBe(500);
  });

  it('applies expenses and income', () => {
    const cash = account({openingBalance: 1000});
    const balances = computeBalances(
      [cash],
      [
        txn('EXPENSE', 250, {accountId: cash.id}),
        txn('INCOME', 4000, {accountId: cash.id}),
        txn('EXPENSE', 120.5, {accountId: cash.id}),
      ],
    );
    expect(balances.get(cash.id)).toBe(4629.5);
  });

  it('moves money across both legs of a transfer', () => {
    const cash = account({openingBalance: 1000});
    const bank = account({openingBalance: 5000});
    const balances = computeBalances(
      [cash, bank],
      [txn('TRANSFER', 2000, {accountId: bank.id, toAccountId: cash.id})],
    );
    expect(balances.get(bank.id)).toBe(3000);
    expect(balances.get(cash.id)).toBe(3000);
  });

  it('treats a transfer to the same account as a no-op', () => {
    const cash = account({openingBalance: 1000});
    const balances = computeBalances(
      [cash],
      [txn('TRANSFER', 250, {accountId: cash.id, toAccountId: cash.id})],
    );
    expect(balances.get(cash.id)).toBe(1000);
  });

  it('ignores soft-deleted transactions', () => {
    const cash = account({openingBalance: 1000});
    const balances = computeBalances(
      [cash],
      [
        txn('EXPENSE', 250, {accountId: cash.id}),
        txn('EXPENSE', 999, {accountId: cash.id, deletedAt: 12345}),
      ],
    );
    expect(balances.get(cash.id)).toBe(750);
  });

  it('omits soft-deleted accounts entirely', () => {
    const cash = account({openingBalance: 1000, deletedAt: 1});
    expect(computeBalances([cash], []).has(cash.id)).toBe(false);
  });

  it('ignores transactions pointing at an unknown account', () => {
    const cash = account({openingBalance: 1000});
    const balances = computeBalances(
      [cash],
      [txn('EXPENSE', 250, {accountId: 'ghost-account'})],
    );
    expect(balances.get(cash.id)).toBe(1000);
    expect(balances.has('ghost-account')).toBe(false);
  });

  it('applies the surviving leg when a transfer references a missing account', () => {
    const cash = account({openingBalance: 1000});
    const balances = computeBalances(
      [cash],
      [txn('TRANSFER', 300, {accountId: cash.id, toAccountId: 'ghost'})],
    );
    expect(balances.get(cash.id)).toBe(700);
  });

  it('does not accumulate floating point drift', () => {
    const cash = account({openingBalance: 0});
    const transactions = Array.from({length: 10}, () =>
      txn('EXPENSE', 0.1, {accountId: cash.id}),
    );
    expect(computeBalances([cash], transactions).get(cash.id)).toBe(-1);
  });

  /**
   * The scenario that motivated deriving balances instead of storing them.
   * The old app mutated a stored balance per write, so removing a transaction
   * from the middle of history left every later balance wrong forever.
   */
  it('stays correct when a transaction is deleted mid-history', () => {
    const cash = account({openingBalance: 1000});
    const history = [
      txn('EXPENSE', 100, {accountId: cash.id, date: 1}),
      txn('EXPENSE', 200, {accountId: cash.id, date: 2}),
      txn('INCOME', 500, {accountId: cash.id, date: 3}),
      txn('EXPENSE', 50, {accountId: cash.id, date: 4}),
    ];
    expect(computeBalances([cash], history).get(cash.id)).toBe(1150);

    // Soft-delete the middle row; nothing else is touched.
    const middle = history[1]!;
    const afterDelete = history.map((t) =>
      t.id === middle.id ? {...t, deletedAt: 999} : t,
    );
    expect(computeBalances([cash], afterDelete).get(cash.id)).toBe(1350);

    // ...and restoring it returns the balance exactly, with no compensation.
    expect(computeBalances([cash], history).get(cash.id)).toBe(1150);
  });
});

describe('effectOnAccount', () => {
  it('signs each transaction type from one account’s perspective', () => {
    expect(effectOnAccount(txn('EXPENSE', 100, {accountId: 'a'}), 'a')).toBe(-100);
    expect(effectOnAccount(txn('INCOME', 100, {accountId: 'a'}), 'a')).toBe(100);

    const transfer = txn('TRANSFER', 100, {accountId: 'a', toAccountId: 'b'});
    expect(effectOnAccount(transfer, 'a')).toBe(-100);
    expect(effectOnAccount(transfer, 'b')).toBe(100);
    expect(effectOnAccount(transfer, 'c')).toBe(0);
  });

  it('is zero for soft-deleted rows', () => {
    const deleted = txn('EXPENSE', 100, {accountId: 'a', deletedAt: 1});
    expect(effectOnAccount(deleted, 'a')).toBe(0);
  });
});

describe('computeTotalBalance', () => {
  it('excludes accounts flagged out of the total', () => {
    const cash = account({openingBalance: 1000});
    const savings = account({openingBalance: 50000, includeInBalance: false});
    expect(computeTotalBalance([cash, savings], [])).toBe(1000);
  });

  it('sums included accounts after applying transactions', () => {
    const cash = account({openingBalance: 1000});
    const bank = account({openingBalance: 5000});
    const total = computeTotalBalance(
      [cash, bank],
      [
        txn('EXPENSE', 250, {accountId: cash.id}),
        // A transfer nets to zero across the two accounts.
        txn('TRANSFER', 2000, {accountId: bank.id, toAccountId: cash.id}),
      ],
    );
    expect(total).toBe(5750);
  });
});

describe('computeTotals', () => {
  it('sums income and expense within a half-open interval', () => {
    const transactions = [
      txn('EXPENSE', 100, {date: 10}),
      txn('INCOME', 500, {date: 20}),
      txn('EXPENSE', 50, {date: 29}),
      txn('EXPENSE', 999, {date: 30}), // `to` is exclusive
      txn('EXPENSE', 999, {date: 9}), // before `from`
    ];
    expect(computeTotals(transactions, 10, 30)).toEqual({
      income: 500,
      expense: 150,
      net: 350,
    });
  });

  it('excludes transfers, which are not spending', () => {
    const transactions = [txn('TRANSFER', 5000, {date: 10})];
    expect(computeTotals(transactions, 0, 100)).toEqual({
      income: 0,
      expense: 0,
      net: 0,
    });
  });

  it('excludes soft-deleted rows', () => {
    const transactions = [txn('EXPENSE', 100, {date: 10, deletedAt: 1})];
    expect(computeTotals(transactions, 0, 100).expense).toBe(0);
  });
});

describe('computeSpendByCategory', () => {
  it('groups expenses by category, keeping uncategorised under null', () => {
    const spend = computeSpendByCategory(
      [
        txn('EXPENSE', 100, {date: 5, categoryId: 'food'}),
        txn('EXPENSE', 250, {date: 6, categoryId: 'food'}),
        txn('EXPENSE', 80, {date: 7, categoryId: 'travel'}),
        txn('EXPENSE', 40, {date: 8}),
        txn('INCOME', 9999, {date: 9, categoryId: 'food'}),
      ],
      0,
      100,
    );
    expect(spend.get('food')).toBe(350);
    expect(spend.get('travel')).toBe(80);
    expect(spend.get(null)).toBe(40);
  });
});
