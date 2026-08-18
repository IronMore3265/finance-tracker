import {describe, expect, it} from 'vitest';
import {NotAnExportError, parseExport} from './parse';

/** The real file's headers, in the real file's order. */
const expenses = (rows: Record<string, unknown>[]) => ({Expenses: rows});

const expenseRow = (overrides: Record<string, unknown> = {}) => ({
  Date: '2026-08-17 22:44:23',
  Category: 'Transportation',
  Description: '',
  Amount: 20,
  Type: 'EXPENSE',
  Account: 'Cash',
  ToAccount: '',
  Tags: '',
  ...overrides,
});

describe('parseExport', () => {
  it('refuses a workbook with none of the expected sheets', () => {
    expect(() => parseExport({Sheet1: [{a: 1}]})).toThrow(NotAnExportError);
  });

  it('names the sheets it did find, so a wrong file is diagnosable', () => {
    expect(() => parseExport({Budget: [], Notes: []})).toThrow(/"Budget", "Notes"/);
  });

  it('accepts a workbook holding only some of the sheets', () => {
    // The real export's Planned Transactions sheet is a header with no rows.
    const parsed = parseExport(expenses([expenseRow()]));
    expect(parsed.transactions).toHaveLength(1);
    expect(parsed.planned).toEqual([]);
  });

  /**
   * The bug this would have been: PROGRESS.md section 5 recorded the Expenses
   * columns as Date, Description, Category — the real file has Date, Category,
   * Description. Positional parsing would have put every category in the
   * description and every description in the category.
   */
  it('reads columns by header name, not position', () => {
    const [txn] = parseExport(
      expenses([
        {
          Amount: 20,
          Account: 'Cash',
          Type: 'EXPENSE',
          Description: 'a note',
          Date: '2026-08-17 22:44:23',
          Category: 'Food',
        },
      ]),
    ).transactions;

    expect(txn?.category).toBe('Food');
    expect(txn?.description).toBe('a note');
  });

  it('matches headers and sheet names loosely', () => {
    const parsed = parseExport({
      'debts_and_receivables': [
        {
          date: '2026-07-30',
          'Person ': 'Alex',
          TYPE: 'DEBT',
          Description: 'season ticket',
          amount: 223,
          'Due Date': 'N/A',
          Status: 'Settled',
        },
      ],
    });

    expect(parsed.debts).toHaveLength(1);
    expect(parsed.debts[0]?.personName).toBe('Alex');
    expect(parsed.debts[0]?.dueDate).toBeNull();
  });

  it('parses timestamps as local wall-clock time, not UTC', () => {
    const [txn] = parseExport(
      expenses([expenseRow({Date: '2026-08-17 22:44:23'})]),
    ).transactions;

    const parsed = new Date(txn!.date);
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(7);
    expect(parsed.getDate()).toBe(17);
    expect(parsed.getHours()).toBe(22);
    expect(parsed.getSeconds()).toBe(23);
  });

  it('accepts a date-only cell, a Date object and an Excel serial', () => {
    const fromText = parseExport(expenses([expenseRow({Date: '2026-08-17'})]))
      .transactions[0]?.date;
    const fromDate = parseExport(
      expenses([expenseRow({Date: new Date(2026, 7, 17, 22, 44, 23)})]),
    ).transactions[0]?.date;
    // 2026-08-17 as days since 1899-12-30.
    const fromSerial = parseExport(expenses([expenseRow({Date: 46251})]))
      .transactions[0]?.date;

    expect(new Date(fromText!).getDate()).toBe(17);
    expect(new Date(fromDate!).getHours()).toBe(22);
    expect(new Date(fromSerial!).getDate()).toBe(17);
  });

  it('skips a row with an unparseable date, and says which row', () => {
    const parsed = parseExport(
      expenses([expenseRow(), expenseRow({Date: 'sometime last week'})]),
    );

    expect(parsed.transactions).toHaveLength(1);
    expect(parsed.issues).toHaveLength(1);
    expect(parsed.issues[0]).toMatchObject({sheet: 'Expenses', row: 2, isSkipped: true});
  });

  it('rejects an impossible date rather than rolling it into the next month', () => {
    const parsed = parseExport(expenses([expenseRow({Date: '2026-02-30'})]));
    expect(parsed.transactions).toEqual([]);
    expect(parsed.issues[0]?.isSkipped).toBe(true);
  });

  it('normalises a negative amount to a magnitude, and reports it', () => {
    const parsed = parseExport(expenses([expenseRow({Amount: -20})]));

    // Left negative it would *add* 20 to the account, because the type carries
    // the direction here.
    expect(parsed.transactions[0]?.amount).toBe(20);
    expect(parsed.issues[0]).toMatchObject({isSkipped: false});
    expect(parsed.issues[0]?.message).toContain('negative');
  });

  it('reads an amount that arrives formatted', () => {
    const parsed = parseExport(expenses([expenseRow({Amount: '1,234.50'})]));
    expect(parsed.transactions[0]?.amount).toBe(1234.5);
  });

  it('imports the old app DEBT type as an expense, and says so', () => {
    const parsed = parseExport(expenses([expenseRow({Type: 'DEBT'})]));

    expect(parsed.transactions[0]?.type).toBe('EXPENSE');
    expect(parsed.issues[0]).toMatchObject({isSkipped: false});
  });

  it('skips a type it does not recognise', () => {
    const parsed = parseExport(expenses([expenseRow({Type: 'REFUND'})]));
    expect(parsed.transactions).toEqual([]);
    expect(parsed.issues[0]?.message).toContain('REFUND');
  });

  it('keeps a transfer with no destination as a transfer, and flags it', () => {
    const parsed = parseExport(
      expenses([expenseRow({Type: 'TRANSFER', ToAccount: ''})]),
    );

    // Rewriting it as an expense would be the same arithmetic and a different
    // claim about what happened.
    expect(parsed.transactions[0]?.type).toBe('TRANSFER');
    expect(parsed.transactions[0]?.toAccount).toBeNull();
    expect(parsed.issues[0]?.isSkipped).toBe(false);
  });

  it('splits tags and drops the blanks', () => {
    expect(
      parseExport(expenses([expenseRow({Tags: 'work, travel ,'})])).transactions[0]?.tags,
    ).toEqual(['work', 'travel']);
  });

  describe('accounts', () => {
    const accounts = (rows: Record<string, unknown>[]) => ({Accounts: rows});

    it('reads True/False and the taka symbol the old app writes', () => {
      const [account] = parseExport(
        accounts([
          {
            Name: 'Cash',
            Balance: -1234,
            ColorHex: '#EA3B35',
            Icon: 'wallet',
            Currency: '৳',
            IncludeInBalance: 'True',
            DisplayOrder: 0,
          },
        ]),
      ).accounts;

      expect(account?.includeInBalance).toBe(true);
      // An ISO code, because Intl.NumberFormat cannot take a symbol and a
      // symbol is ambiguous across a dozen countries.
      expect(account?.currency).toBe('BDT');
      expect(account?.balance).toBe(-1234);
    });

    it('maps the old app icon names onto this app four', () => {
      const parsed = parseExport(
        accounts([
          {Name: 'Brac Bank', Icon: 'card_visa', Balance: 1},
          {Name: 'Piggy', Icon: 'something_else', Balance: 1},
        ]),
      );

      expect(parsed.accounts[0]?.icon).toBe('card');
      // A cosmetic miss, so it falls back rather than raising an issue nobody
      // can act on.
      expect(parsed.accounts[1]?.icon).toBe('wallet');
      expect(parsed.issues).toEqual([]);
    });

    it('skips an account with no name', () => {
      const parsed = parseExport(accounts([{Name: '', Balance: 10}]));
      expect(parsed.accounts).toEqual([]);
      expect(parsed.issues[0]?.isSkipped).toBe(true);
    });
  });

  describe('debts', () => {
    const debts = (rows: Record<string, unknown>[]) => ({'Debts & Receivables': rows});

    const debtRow = (overrides: Record<string, unknown> = {}) => ({
      Date: '2026-07-30 14:17:23',
      Person: 'Alex',
      Type: 'DEBT',
      Description: 'season ticket',
      Amount: 223,
      'Due Date': '2026-08-01 23:59:59',
      Status: 'Settled',
      ...overrides,
    });

    it('reads a settled debt', () => {
      const [debt] = parseExport(debts([debtRow()])).debts;
      expect(debt).toMatchObject({personName: 'Alex', type: 'DEBT', isCleared: true});
      expect(debt?.dueDate).not.toBeNull();
    });

    it('treats a pending receivable as outstanding', () => {
      const [debt] = parseExport(
        debts([debtRow({Type: 'DUE', Status: 'Pending', 'Due Date': 'N/A'})]),
      ).debts;

      expect(debt).toMatchObject({type: 'DUE', isCleared: false});
      expect(debt?.dueDate).toBeNull();
    });

    it('skips a row that is neither a debt nor a receivable', () => {
      const parsed = parseExport(debts([debtRow({Type: 'LOAN?'})]));
      expect(parsed.debts).toEqual([]);
      expect(parsed.issues[0]?.isSkipped).toBe(true);
    });
  });

  describe('planned transactions', () => {
    const planned = (rows: Record<string, unknown>[]) => ({'Planned Transactions': rows});

    const plannedRow = (overrides: Record<string, unknown> = {}) => ({
      Title: 'Rent',
      Amount: 12000,
      Category: 'Bills',
      Type: 'EXPENSE',
      Account: 'Brac Bank',
      'Start Date': '2026-07-01 00:00:00',
      'Interval Type': 'MONTH',
      'Interval N': 1,
      'One Time': 'False',
      'Next Due Date': '2026-09-01 00:00:00',
      'Is Active': 'True',
      Description: '',
      ...overrides,
    });

    it('reads a monthly rule', () => {
      const [rule] = parseExport(planned([plannedRow()])).planned;
      expect(rule).toMatchObject({
        title: 'Rent',
        intervalType: 'MONTH',
        intervalN: 1,
        oneTime: false,
        isActive: true,
      });
    });

    it('accepts the spelled-out interval names', () => {
      expect(
        parseExport(planned([plannedRow({'Interval Type': 'Weekly'})])).planned[0]
          ?.intervalType,
      ).toBe('WEEK');
    });

    it('falls back to monthly for an interval it does not have, and says so', () => {
      const parsed = parseExport(planned([plannedRow({'Interval Type': 'FORTNIGHT'})]));
      expect(parsed.planned[0]?.intervalType).toBe('MONTH');
      expect(parsed.issues[0]?.message).toContain('FORTNIGHT');
    });

    it('skips a recurring transfer, which the rule engine cannot express', () => {
      const parsed = parseExport(planned([plannedRow({Type: 'TRANSFER'})]));
      expect(parsed.planned).toEqual([]);
      expect(parsed.issues[0]?.isSkipped).toBe(true);
    });
  });
});
