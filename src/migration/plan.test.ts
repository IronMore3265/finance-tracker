import {describe, expect, it} from 'vitest';
import {computeBalances} from '../domain/balances';
import type {Account, Category, Transaction} from '../db/types';
import {buildImportPlan, countCreates, NO_EXISTING_DATA, type ExistingData} from './plan';
import {parseExport, type RawSheets} from './parse';

const AT = Date.parse('2026-08-18T00:00:00Z');

/**
 * A miniature of the real export: one account whose balance is the net of its
 * ledger, so the derived opening balance should come out as zero.
 */
const workbook = (overrides: Partial<RawSheets> = {}): RawSheets => ({
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
  ],
  ...overrides,
});

const planFor = (sheets: RawSheets = workbook(), existing: ExistingData = NO_EXISTING_DATA) =>
  buildImportPlan(parseExport(sheets), existing, AT);

/** Turn a plan's created rows into the real rows a database would hold. */
const asRows = <T,>(rows: readonly T[]): T[] =>
  rows.map((row) => ({...row, updatedAt: AT, deletedAt: null, userId: null}) as T);

describe('buildImportPlan', () => {
  describe('opening balances', () => {
    /**
     * The single most important property of the import: the old app's balance
     * and this app's derived balance must agree afterwards. The old app's
     * `Balance` column is a *current* balance, so copying it into
     * `openingBalance` would double-count the entire ledger.
     */
    it('solves the opening balance so the derived balance matches the export', () => {
      const plan = planFor();
      const [check] = plan.balanceChecks;

      expect(check).toMatchObject({
        name: 'Cash',
        exportedBalance: -30,
        projectedBalance: -30,
        isCreated: true,
      });
      // -30 exported, and the ledger takes it down by 30, so it started at 0.
      expect(check?.openingBalance).toBe(0);
    });

    it('and the app computes that same balance from the rows it writes', () => {
      const plan = planFor();

      // Not a restatement of the line above: this runs the app's own
      // `computeBalances` over the rows the plan would actually write.
      const balances = computeBalances(
        asRows<Account>(plan.create.accounts as unknown as Account[]),
        asRows<Transaction>(plan.create.transactions as unknown as Transaction[]),
      );

      expect([...balances.values()]).toEqual([-30]);
    });

    it('derives a non-zero opening balance when the ledger does not explain the whole balance', () => {
      const sheets = workbook();
      (sheets.Accounts as Record<string, unknown>[])[0]!.Balance = 9_000 - 30;

      const [check] = planFor(sheets).balanceChecks;
      expect(check?.openingBalance).toBe(9_000);
      expect(check?.projectedBalance).toBe(8_970);
    });

    it('leaves an existing account opening balance alone, and reports the gap', () => {
      const existing: ExistingData = {
        ...NO_EXISTING_DATA,
        accounts: [
          {
            id: 'existing-cash',
            createdAt: 1,
            updatedAt: 1,
            deletedAt: null,
            userId: null,
            name: 'Cash',
            openingBalance: 500,
            colorHex: '#000000',
            icon: 'wallet',
            currency: 'BDT',
            includeInBalance: true,
            displayOrder: 0,
          },
        ],
      };

      const plan = planFor(workbook(), existing);
      const [check] = plan.balanceChecks;

      // Silently restating the opening balance of an account already in use
      // would change every balance the user has seen, so it is left alone and
      // the disagreement is shown instead.
      expect(plan.create.accounts).toEqual([]);
      expect(check).toMatchObject({
        isCreated: false,
        openingBalance: 500,
        exportedBalance: -30,
        projectedBalance: 470,
      });
    });
  });

  describe('re-importing', () => {
    it('is a no-op when the same file is imported twice', () => {
      const first = planFor();

      const existing: ExistingData = {
        ...NO_EXISTING_DATA,
        accounts: asRows(first.create.accounts as unknown as Account[]),
        categories: asRows(first.create.categories as unknown as Category[]),
        transactions: asRows(first.create.transactions as unknown as Transaction[]),
      };

      const second = planFor(workbook(), existing);

      expect(countCreates(second)).toBe(0);
      expect(second.isEmpty).toBe(true);
      expect(second.alreadyPresent.transactions).toBe(2);
    });

    it('adds only what is new when the export has grown', () => {
      const first = planFor();
      const existing: ExistingData = {
        ...NO_EXISTING_DATA,
        accounts: asRows(first.create.accounts as unknown as Account[]),
        categories: asRows(first.create.categories as unknown as Category[]),
        transactions: asRows(first.create.transactions as unknown as Transaction[]),
      };

      const grown = workbook();
      (grown.Expenses as Record<string, unknown>[]).push({
        Date: '2026-08-18 09:00:00',
        Category: 'Food',
        Description: '',
        Amount: 25,
        Type: 'EXPENSE',
        Account: 'Cash',
        ToAccount: '',
        Tags: '',
      });

      const second = planFor(grown, existing);

      expect(second.create.transactions).toHaveLength(1);
      expect(second.alreadyPresent.transactions).toBe(2);
      // Food is not among the two categories the first import created.
      expect(second.create.categories).toHaveLength(1);
    });

    /**
     * A row the user threw away must stay thrown away. Matching only live rows
     * would resurrect it on the next import — a delete that silently undoes
     * itself is worse than one that fails.
     */
    it('does not resurrect a row that was imported and then deleted', () => {
      const first = planFor();
      const deleted = asRows<Transaction>(
        first.create.transactions as unknown as Transaction[],
      ).map((row, index) => (index === 0 ? {...row, deletedAt: AT} : row));

      const second = planFor(workbook(), {
        ...NO_EXISTING_DATA,
        accounts: asRows(first.create.accounts as unknown as Account[]),
        categories: asRows(first.create.categories as unknown as Category[]),
        transactions: deleted,
      });

      expect(second.create.transactions).toEqual([]);
    });

    it('does not recreate an account the user has since renamed', () => {
      const first = planFor();
      const renamed = asRows<Account>(first.create.accounts as unknown as Account[]).map(
        (row) => ({...row, name: 'Pocket money'}),
      );

      const second = planFor(workbook(), {...NO_EXISTING_DATA, accounts: renamed});

      // Matched by its derived id rather than its name, so the rename sticks
      // and no second Cash account appears.
      expect(second.create.accounts).toEqual([]);
      expect(second.balanceChecks[0]?.name).toBe('Pocket money');
    });

    it('keeps two identical source rows as two rows', () => {
      const sheets = workbook();
      const rows = sheets.Expenses as Record<string, unknown>[];
      rows.push({...rows[0]});

      const plan = planFor(sheets);
      const ids = plan.create.transactions.map((row) => row.id);

      expect(plan.create.transactions).toHaveLength(3);
      expect(new Set(ids).size).toBe(3);
    });
  });

  describe('resolving names', () => {
    it('lands on a seeded category rather than creating a second one', () => {
      const existing: ExistingData = {
        ...NO_EXISTING_DATA,
        categories: [
          {
            id: 'seeded-transportation',
            createdAt: 1,
            updatedAt: 1,
            deletedAt: null,
            userId: null,
            name: 'Transportation',
            icon: 'car',
            colorHex: '#2196F3',
            kind: 'EXPENSE',
            displayOrder: 1,
            isDefault: true,
          },
        ],
      };

      const plan = planFor(workbook(), existing);

      expect(plan.create.categories.map((row) => row.name)).toEqual(['Other']);
      expect(plan.create.transactions[0]?.categoryId).toBe('seeded-transportation');
    });

    it('matches names case- and whitespace-insensitively', () => {
      const sheets = workbook();
      (sheets.Expenses as Record<string, unknown>[])[0]!.Account = '  cash ';

      const plan = planFor(sheets);

      expect(plan.create.accounts).toHaveLength(1);
      expect(plan.create.transactions[0]?.accountId).toBe(plan.create.accounts[0]?.id);
    });

    it('infers a category kind from how the transactions use it', () => {
      const byName = new Map(planFor().create.categories.map((row) => [row.name, row]));

      expect(byName.get('Transportation')?.kind).toBe('EXPENSE');
      expect(byName.get('Other')?.kind).toBe('INCOME');
    });

    /**
     * Left unresolved these import as transactions with no account, which drop
     * out of every balance and show a dash in the ledger — the import would
     * look clean while the totals quietly disagreed.
     */
    it('creates an account a transaction names but the Accounts sheet omits', () => {
      const sheets = workbook();
      (sheets.Expenses as Record<string, unknown>[])[0]!.Account = 'Brac Bank';

      const plan = planFor(sheets);
      const invented = plan.create.accounts.find((row) => row.name === 'Brac Bank');

      expect(invented).toBeDefined();
      expect(invented?.openingBalance).toBe(0);
      expect(plan.issues.some((issue) => issue.message.includes('Brac Bank'))).toBe(true);
    });
  });

  describe('debts', () => {
    const withDebts = (rows: Record<string, unknown>[]) =>
      workbook({'Debts & Receivables': rows});

    const settled = {
      Date: '2026-07-19 23:02:37',
      Person: 'Alex',
      Type: 'DEBT',
      Description: 'lunch',
      Amount: 1000,
      'Due Date': 'N/A',
      Status: 'Settled',
    };

    it('records a settlement for a settled debt, so it is not shown as outstanding', () => {
      const plan = planFor(withDebts([settled]));

      // The outstanding balance is derived from `debtPayments`, not read off
      // `isCleared`, so a settled debt with no payment would render as fully
      // outstanding.
      expect(plan.create.debts).toHaveLength(1);
      expect(plan.create.debtPayments).toHaveLength(1);
      expect(plan.create.debtPayments[0]?.amount).toBe(1000);
      expect(plan.create.debtPayments[0]?.debtId).toBe(plan.create.debts[0]?.id);
    });

    it('links the settlement to the ledger row the old app wrote for it', () => {
      const sheets = withDebts([settled]);
      (sheets.Expenses as Record<string, unknown>[]).push({
        Date: '2026-08-17 17:30:07',
        Category: 'Debt Repayment',
        Description: 'Repaid: Alex (lunch)',
        Amount: 1000,
        Type: 'EXPENSE',
        Account: 'Cash',
        ToAccount: '',
        Tags: '',
      });

      const plan = planFor(sheets);
      const repayment = plan.create.transactions.find(
        (row) => row.description === 'Repaid: Alex (lunch)',
      );

      // Linked, not duplicated: the money really did leave the account, so the
      // ledger row stays and the payment points at it.
      expect(plan.create.debtPayments[0]?.transactionId).toBe(repayment?.id);
      expect(plan.create.debtPayments[0]?.date).toBe(repayment?.date);
    });

    it('records no settlement for a debt that is still pending', () => {
      const plan = planFor(withDebts([{...settled, Status: 'Pending'}]));

      expect(plan.create.debts[0]?.isCleared).toBe(false);
      expect(plan.create.debtPayments).toEqual([]);
    });

    it('does not let two settled debts claim the same ledger row', () => {
      const sheets = withDebts([settled, {...settled, Date: '2026-07-20 10:00:00'}]);
      (sheets.Expenses as Record<string, unknown>[]).push({
        Date: '2026-08-17 17:30:07',
        Category: 'Debt Repayment',
        Description: 'Repaid: Alex (lunch)',
        Amount: 1000,
        Type: 'EXPENSE',
        Account: 'Cash',
        ToAccount: '',
        Tags: '',
      });

      const linked = planFor(sheets)
        .create.debtPayments.map((row) => row.transactionId)
        .filter((id) => id !== null);

      expect(linked).toHaveLength(1);
    });
  });

  describe('file totals', () => {
    it('reports what the file holds, for reconciling against the old app report', () => {
      const plan = planFor(
        workbook({
          'Debts & Receivables': [
            {
              Date: '2026-07-19 12:11:24',
              Person: 'your',
              Type: 'DUE',
              Description: 'Debt/Receivable log',
              Amount: 1500,
              'Due Date': '2026-07-21 23:59:59',
              Status: 'Pending',
            },
          ],
        }),
      );

      expect(plan.fileTotals).toEqual({
        transactions: 2,
        expenses: 50,
        income: 20,
        debts: 1,
        activeDebt: 0,
        activeReceivable: 1500,
      });
    });
  });
});
