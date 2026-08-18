// Patches indexedDB onto globalThis so Dexie runs under Node.
import 'fake-indexeddb/auto';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {createTestDatabase, type FinanceDatabase} from '../db/db';
import {computeDebtOutstanding} from '../db/commands';
import {seedDefaultCategories} from '../db/seed';
import {computeBalances} from '../domain/balances';
import {applyImportPlan, readExistingData} from './apply';
import {parseExport, type RawSheets} from './parse';
import {buildImportPlan} from './plan';

let db: FinanceDatabase;
let dbCount = 0;

beforeEach(async () => {
  db = createTestDatabase(`import-${(dbCount += 1)}-${Date.now()}`);
  await db.open();
});

afterEach(() => {
  db.close();
});

const workbook = (): RawSheets => ({
  Accounts: [
    {
      Name: 'Cash',
      Balance: -30,
      ColorHex: '#EA3B35',
      Icon: 'wallet',
      Currency: '৳',
      IncludeInBalance: 'True',
      DisplayOrder: 0,
    },
    {
      Name: 'Brac Bank',
      Balance: 5000,
      ColorHex: '#2196F3',
      Icon: 'card_visa',
      Currency: '৳',
      IncludeInBalance: 'True',
      DisplayOrder: 1,
    },
  ],
  Expenses: [
    {
      Date: '2026-08-17 22:44:23',
      Category: 'Transportation',
      Description: '',
      Amount: 50,
      Type: 'EXPENSE',
      Account: 'Cash',
      ToAccount: '',
      Tags: '',
    },
    {
      Date: '2026-08-16 10:00:00',
      Category: 'Other',
      Description: '',
      Amount: 20,
      Type: 'INCOME',
      Account: 'Cash',
      ToAccount: '',
      Tags: '',
    },
    {
      Date: '2026-08-17 17:30:07',
      Category: 'Debt Repayment',
      Description: 'Repaid: Alex (lunch)',
      Amount: 1000,
      Type: 'EXPENSE',
      Account: 'Brac Bank',
      ToAccount: '',
      Tags: '',
    },
  ],
  'Debts & Receivables': [
    {
      Date: '2026-07-19 23:02:37',
      Person: 'Alex',
      Type: 'DEBT',
      Description: 'lunch',
      Amount: 1000,
      'Due Date': 'N/A',
      Status: 'Settled',
    },
  ],
});

/** Read the database, plan an import of `sheets`, apply it. */
async function importInto(database: FinanceDatabase, sheets: RawSheets = workbook()) {
  const plan = buildImportPlan(parseExport(sheets), await readExistingData(database));
  return {plan, result: await applyImportPlan(plan, database)};
}

describe('applyImportPlan', () => {
  it('writes every table the file touches', async () => {
    const {result} = await importInto(db);

    expect(result.created).toEqual({
      accounts: 2,
      categories: 3,
      transactions: 3,
      debts: 1,
      debtPayments: 1,
      planned: 0,
    });
    expect(await db.transactions.count()).toBe(3);
    expect(await db.accounts.count()).toBe(2);
  });

  /**
   * The reason the whole import is one transaction: ninety transactions
   * written and the accounts they point at missing is the state that would be
   * hardest to notice and impossible to unpick by hand.
   */
  it('writes nothing at all when part of the plan fails', async () => {
    const {plan} = {plan: buildImportPlan(parseExport(workbook()), await readExistingData(db))};

    // A function cannot be structured-cloned, so writing the debt payments
    // throws — after the accounts, categories, transactions and debts have all
    // been written. (A bad `id` would not do it: `createMany` replaces a
    // missing one with a fresh uuid.)
    plan.create.debtPayments[0]!.amount = (() => 0) as unknown as number;

    await expect(applyImportPlan(plan, db)).rejects.toThrow();

    expect(await db.accounts.count()).toBe(0);
    expect(await db.transactions.count()).toBe(0);
    expect(await db.debts.count()).toBe(0);
  });

  it('queues every imported row for sync', async () => {
    const {result} = await importInto(db);

    // A write that skips the outbox looks fine locally and is missing
    // everywhere else — the worst failure mode this app has.
    expect(await db.outbox.count()).toBe(result.total);
  });

  it('stamps the row created date from the file, and updatedAt from the import', async () => {
    const before = Date.now();
    await importInto(db);

    const [oldest] = await db.transactions.orderBy('date').toArray();

    expect(oldest?.createdAt).toBe(oldest?.date);
    expect(oldest?.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it('produces balances matching what the old app exported', async () => {
    await importInto(db);

    const balances = computeBalances(
      await db.accounts.toArray(),
      await db.transactions.toArray(),
    );
    const byName = new Map(
      (await db.accounts.toArray()).map((row) => [row.name, balances.get(row.id)]),
    );

    expect(byName.get('Cash')).toBe(-30);
    expect(byName.get('Brac Bank')).toBe(5000);
  });

  it('leaves a settled debt with nothing outstanding', async () => {
    await importInto(db);

    const outstanding = computeDebtOutstanding(
      await db.debts.toArray(),
      await db.debtPayments.toArray(),
    );

    expect([...outstanding.values()]).toEqual([0]);
  });

  it('links the settlement to the ledger row, without duplicating it', async () => {
    await importInto(db);

    const [payment] = await db.debtPayments.toArray();
    const linked = await db.transactions.get(payment!.transactionId!);

    expect(linked?.description).toBe('Repaid: Alex (lunch)');
    // Three transactions, not four: the repayment was already in the file.
    expect(await db.transactions.count()).toBe(3);
  });

  it('adds nothing on a second import of the same file', async () => {
    await importInto(db);
    const before = await db.transactions.count();

    const {result} = await importInto(db);

    expect(result.total).toBe(0);
    expect(result.alreadyPresent.transactions).toBe(3);
    expect(await db.transactions.count()).toBe(before);
  });

  it('keeps an edit made to an imported row', async () => {
    await importInto(db);
    const [first] = await db.transactions.toArray();
    await db.transactions.update(first!.id, {description: 'corrected by hand'});

    await importInto(db);

    // Matching means "leave it alone", never "overwrite it".
    expect((await db.transactions.get(first!.id))?.description).toBe('corrected by hand');
  });

  it('lands on the seeded categories instead of creating duplicates', async () => {
    // seed.ts deliberately carries the old app's category names for this.
    await seedDefaultCategories(db);
    const seeded = await db.categories.count();

    const {result} = await importInto(db);

    // Only "Debt Repayment", which the seed list does not have.
    expect(result.created.categories).toBe(1);
    expect(await db.categories.count()).toBe(seeded + 1);
  });
});
