/**
 * Writing a plan.
 *
 * Everything interesting already happened in `plan.ts`; this only has to put
 * the rows in, and put them in *together*. One Dexie transaction covers every
 * table the plan touches, so the failure mode that would be hardest to unpick
 * — ninety transactions written, the accounts they point at not — cannot
 * happen. Either the import is there or it never started.
 *
 * The writes go through the repositories rather than a raw `bulkPut`, which is
 * the opposite of the choice `backup.ts` made, and for the opposite reason. A
 * restore is putting rows *back* and has to preserve their original
 * `updatedAt`, or a restored copy would beat a newer one on the server. An
 * import is creating rows that have never existed anywhere, so they want the
 * ordinary treatment: stamped with now, and queued in the outbox so they
 * reach the cloud. `createMany` is exactly that, and Dexie joins its
 * transaction to the one opened here rather than committing on its own.
 *
 * Order matters only for readability — the whole thing commits atomically —
 * but rows are written parents-first anyway, so anyone reading a partial log
 * sees accounts before the transactions that reference them.
 */
import type {FinanceDatabase} from '../db/db';
import {db as defaultDb} from '../db/db';
import {createRepository} from '../db/repo';
import type {
  Account,
  Category,
  Debt,
  DebtPayment,
  PlannedTransaction,
  Transaction,
} from '../db/types';
import {countCreates, type ImportCounts, type ImportPlan} from './plan';

export interface ImportResult {
  created: ImportCounts;
  /** Rows the file held that were already here, and so were left alone. */
  alreadyPresent: ImportCounts;
  total: number;
}

export async function applyImportPlan(
  plan: ImportPlan,
  database: FinanceDatabase = defaultDb,
): Promise<ImportResult> {
  const accounts = createRepository<Account>('accounts', database);
  const categories = createRepository<Category>('categories', database);
  const transactions = createRepository<Transaction>('transactions', database);
  const debts = createRepository<Debt>('debts', database);
  const payments = createRepository<DebtPayment>('debtPayments', database);
  const planned = createRepository<PlannedTransaction>('plannedTransactions', database);

  await database.transaction(
    'rw',
    [
      database.accounts,
      database.categories,
      database.transactions,
      database.debts,
      database.debtPayments,
      database.plannedTransactions,
      database.outbox,
    ],
    async () => {
      // `createMany` on an empty list still opens a sub-transaction and stamps
      // a clock, so the guards keep an import of one sheet from touching five
      // tables it has nothing to say about.
      if (plan.create.accounts.length > 0) await accounts.createMany(plan.create.accounts);
      if (plan.create.categories.length > 0) {
        await categories.createMany(plan.create.categories);
      }
      if (plan.create.transactions.length > 0) {
        await transactions.createMany(plan.create.transactions);
      }
      if (plan.create.debts.length > 0) await debts.createMany(plan.create.debts);
      if (plan.create.debtPayments.length > 0) {
        await payments.createMany(plan.create.debtPayments);
      }
      if (plan.create.planned.length > 0) await planned.createMany(plan.create.planned);
    },
  );

  return {
    created: {
      accounts: plan.create.accounts.length,
      categories: plan.create.categories.length,
      transactions: plan.create.transactions.length,
      debts: plan.create.debts.length,
      debtPayments: plan.create.debtPayments.length,
      planned: plan.create.planned.length,
    },
    alreadyPresent: plan.alreadyPresent,
    total: countCreates(plan),
  };
}

/**
 * Everything the planner needs to know about what is already here.
 *
 * Reads every table in full, **including soft-deleted rows**, because the
 * planner treats a deleted row as present — see the header of `plan.ts`. Using
 * `repo.all()` here would filter them out and quietly resurrect anything the
 * user had thrown away.
 */
export async function readExistingData(database: FinanceDatabase = defaultDb) {
  const [accounts, categories, transactions, debts, debtPayments, planned] =
    await Promise.all([
      database.accounts.toArray(),
      database.categories.toArray(),
      database.transactions.toArray(),
      database.debts.toArray(),
      database.debtPayments.toArray(),
      database.plannedTransactions.toArray(),
    ]);

  return {accounts, categories, transactions, debts, debtPayments, planned};
}
