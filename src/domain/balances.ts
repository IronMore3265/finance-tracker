/**
 * Derived account balances.
 *
 * The old app stored a mutable `balance` on each account and adjusted it on
 * every write. That is only correct if every write succeeds exactly once,
 * forever — any crash, partial write, or future sync merge leaves the stored
 * balance permanently out of step with the ledger, with no way to notice.
 *
 * Here the balance is a pure function of (openingBalance, transactions). It
 * cannot drift, an undone delete needs no compensating adjustment, and a bad
 * sync merge is repaired simply by recomputing.
 *
 * These functions take plain arrays rather than touching Dexie, so they are
 * trivially testable and can be driven from a live query at the UI layer.
 */
import type {Account, Transaction} from '../db/types';
import {roundToMinorUnit} from './mathEval';

/** A row counts toward balances only while it is live. */
function isLive(row: {deletedAt: number | null}): boolean {
  return row.deletedAt === null;
}

/**
 * Signed effect of a transaction on one account.
 *
 * A transfer touches two accounts with opposite signs; every other type
 * touches only `accountId`.
 */
export function effectOnAccount(txn: Transaction, accountId: string): number {
  if (!isLive(txn)) return 0;

  switch (txn.type) {
    case 'EXPENSE':
      return txn.accountId === accountId ? -txn.amount : 0;
    case 'INCOME':
      return txn.accountId === accountId ? txn.amount : 0;
    case 'TRANSFER': {
      // Guard the self-transfer case, which would otherwise net to zero only
      // by accident of ordering.
      if (txn.accountId === accountId && txn.toAccountId === accountId) return 0;
      if (txn.accountId === accountId) return -txn.amount;
      if (txn.toAccountId === accountId) return txn.amount;
      return 0;
    }
  }
}

/**
 * Current balance of every account, keyed by account id.
 *
 * Single pass over transactions rather than one pass per account, so this
 * stays O(accounts + transactions).
 */
export function computeBalances(
  accounts: readonly Account[],
  transactions: readonly Transaction[],
): Map<string, number> {
  const balances = new Map<string, number>();

  for (const account of accounts) {
    if (!isLive(account)) continue;
    balances.set(account.id, account.openingBalance);
  }

  for (const txn of transactions) {
    if (!isLive(txn)) continue;

    switch (txn.type) {
      case 'EXPENSE':
        addTo(balances, txn.accountId, -txn.amount);
        break;
      case 'INCOME':
        addTo(balances, txn.accountId, txn.amount);
        break;
      case 'TRANSFER':
        // Each leg is applied independently, so a transfer with one side
        // missing still adjusts the side that exists.
        addTo(balances, txn.accountId, -txn.amount);
        addTo(balances, txn.toAccountId, txn.amount);
        break;
    }
  }

  // Round once at the end: rounding each step would accumulate its own error.
  for (const [id, value] of balances) {
    balances.set(id, roundToMinorUnit(value));
  }

  return balances;
}

function addTo(
  balances: Map<string, number>,
  accountId: string | null,
  delta: number,
): void {
  if (accountId === null) return;
  const current = balances.get(accountId);
  // Ignore transactions pointing at a deleted or unknown account rather than
  // conjuring a balance for an account that is not there.
  if (current === undefined) return;
  balances.set(accountId, current + delta);
}

/**
 * Net worth as shown on the dashboard.
 *
 * Honours each account's `includeInBalance` flag, so a long-term savings
 * account can be tracked without inflating day-to-day spending headroom.
 */
export function computeTotalBalance(
  accounts: readonly Account[],
  transactions: readonly Transaction[],
): number {
  const balances = computeBalances(accounts, transactions);
  let total = 0;

  for (const account of accounts) {
    if (!isLive(account) || !account.includeInBalance) continue;
    total += balances.get(account.id) ?? 0;
  }

  return roundToMinorUnit(total);
}

export type PeriodTotals = {
  income: number;
  expense: number;
  /** income − expense. Transfers are excluded: moving your own money is not spending. */
  net: number;
};

/**
 * Income and expense totals over a half-open interval [from, to).
 *
 * Transfers are deliberately excluded. Counting an ATM withdrawal as an
 * expense would double-count it against the eventual purchase.
 */
export function computeTotals(
  transactions: readonly Transaction[],
  from: number,
  to: number,
): PeriodTotals {
  let income = 0;
  let expense = 0;

  for (const txn of transactions) {
    if (!isLive(txn)) continue;
    if (txn.date < from || txn.date >= to) continue;

    if (txn.type === 'INCOME') income += txn.amount;
    else if (txn.type === 'EXPENSE') expense += txn.amount;
  }

  income = roundToMinorUnit(income);
  expense = roundToMinorUnit(expense);
  return {income, expense, net: roundToMinorUnit(income - expense)};
}

/** Spend per category over [from, to), for budgets and the analytics donut. */
export function computeSpendByCategory(
  transactions: readonly Transaction[],
  from: number,
  to: number,
): Map<string | null, number> {
  const spend = new Map<string | null, number>();

  for (const txn of transactions) {
    if (!isLive(txn) || txn.type !== 'EXPENSE') continue;
    if (txn.date < from || txn.date >= to) continue;

    const key = txn.categoryId;
    spend.set(key, (spend.get(key) ?? 0) + txn.amount);
  }

  for (const [key, value] of spend) {
    spend.set(key, roundToMinorUnit(value));
  }

  return spend;
}
