/**
 * Typed repository instances, one per table.
 *
 * Features import from here rather than constructing repositories themselves,
 * so every write in the app shares the same sync and soft-delete guarantees.
 */
import {createRepository} from './repo';
import type {
  Account,
  Budget,
  Category,
  Debt,
  DebtPayment,
  PlannedException,
  PlannedTransaction,
  Transaction,
} from './types';

export const accountsRepo = createRepository<Account>('accounts');
export const categoriesRepo = createRepository<Category>('categories');
export const transactionsRepo = createRepository<Transaction>('transactions');
export const plannedRepo = createRepository<PlannedTransaction>('plannedTransactions');
export const plannedExceptionsRepo =
  createRepository<PlannedException>('plannedExceptions');
export const debtsRepo = createRepository<Debt>('debts');
export const debtPaymentsRepo = createRepository<DebtPayment>('debtPayments');
export const budgetsRepo = createRepository<Budget>('budgets');
