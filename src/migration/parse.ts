/**
 * The old app's `.xls` export, turned into typed rows.
 *
 * Deliberately pure and free of any SheetJS import: it takes plain objects
 * (`{Date: '2026-08-17 22:44:23', Amount: 20, ...}`), so every rule in here is
 * testable without loading an 800kb parser or reading a file from disk. Turning
 * a file into those objects is all `xls.ts` does.
 *
 * Three properties of the source drive most of the code:
 *
 *   1. **Columns are addressed by header name, never by position.** The real
 *      file disagrees with the schema PROGRESS.md section 5 recorded — the
 *      Expenses sheet is `Date, Category, Description, Amount`, not
 *      `Date, Description, Category, Amount`, and the Accounts sheet's order
 *      differs too. Positional parsing would have swapped every description
 *      with its category and produced a plausible-looking, entirely wrong
 *      import.
 *   2. **Cells are loosely typed.** Booleans arrive as the strings `True` and
 *      `False`, a missing due date as the string `N/A`, and the currency as a
 *      bare symbol rather than an ISO code. Every reader here accepts the real
 *      type and the stringly-typed one.
 *   3. **A bad row must be visible, not silently dropped.** Anything that
 *      cannot be parsed becomes an `ImportIssue` naming its sheet and row
 *      number, which the preview shows before anything is written. An importer
 *      that quietly skips four transactions is worse than one that refuses.
 */
import type {
  AccountIcon,
  DebtType,
  IntervalType,
  TransactionType,
} from '../db/types';

/** One sheet row, keyed by its header text. */
export type RawRow = Record<string, unknown>;

/** Every sheet in the workbook, keyed by sheet name. */
export type RawSheets = Record<string, RawRow[]>;

/**
 * Something the importer could not do faithfully.
 *
 * Carries the sheet and 1-based row so a person can open the file and look at
 * it. `isSkipped` separates "this row is not being imported" from "this row is
 * being imported, with a correction you should know about".
 */
export interface ImportIssue {
  sheet: string;
  /** 1-based data row, matching what a spreadsheet shows once the header is counted. */
  row: number;
  message: string;
  isSkipped: boolean;
}

export interface ParsedAccount {
  name: string;
  /**
   * The old app's stored balance. This is a *current* balance, not an opening
   * one — the two differ by the whole ledger, and `plan.ts` is where that gets
   * turned back into an opening balance.
   */
  balance: number;
  colorHex: string;
  icon: AccountIcon;
  currency: string;
  includeInBalance: boolean;
  displayOrder: number;
}

export interface ParsedTransaction {
  date: number;
  category: string | null;
  description: string;
  amount: number;
  type: TransactionType;
  account: string | null;
  toAccount: string | null;
  tags: string[];
}

export interface ParsedDebt {
  date: number;
  personName: string;
  type: DebtType;
  description: string;
  amount: number;
  dueDate: number | null;
  isCleared: boolean;
}

export interface ParsedPlanned {
  title: string;
  amount: number;
  category: string | null;
  type: Exclude<TransactionType, 'TRANSFER'>;
  account: string | null;
  startDate: number;
  intervalType: IntervalType;
  intervalN: number;
  oneTime: boolean;
  nextDueDate: number | null;
  isActive: boolean;
  description: string;
}

export interface ParsedExport {
  accounts: ParsedAccount[];
  transactions: ParsedTransaction[];
  debts: ParsedDebt[];
  planned: ParsedPlanned[];
  issues: ImportIssue[];
  /** Sheet names present in the file, in file order. Shown when nothing matched. */
  sheetNames: string[];
}

/** Thrown when the file is readable but is plainly not this export. */
export class NotAnExportError extends Error {}

const SHEET_ACCOUNTS = 'Accounts';
const SHEET_EXPENSES = 'Expenses';
const SHEET_DEBTS = 'Debts & Receivables';
const SHEET_PLANNED = 'Planned Transactions';

/**
 * Match column names loosely: case, spacing and punctuation all fall away, so
 * `Due Date`, `duedate` and `DUE_DATE` are one column.
 */
function normalizeKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * The same, plus the connector words, for sheet names.
 *
 * `Debts & Receivables`, `Debts and Receivables` and `debts_receivables` all
 * reduce to `debtsreceivables`, so a later version of the old app that tidies
 * its sheet names does not break the import. `and` is removed only as a whole
 * word, which is what keeps a sheet called `Standing orders` intact — and
 * punctuation becomes a space *before* that, because `_` is a word character
 * and `debts_and_receivables` would otherwise have no word boundary to find.
 */
function sheetKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\band\b/g, ' ')
    .replace(/[^a-z0-9]/g, '');
}

/** Index a row's cells by normalized header, so lookup is order-independent. */
function indexRow(row: RawRow): Map<string, unknown> {
  const byKey = new Map<string, unknown>();
  for (const [header, value] of Object.entries(row)) {
    byKey.set(normalizeKey(header), value);
  }
  return byKey;
}

function findSheet(sheets: RawSheets, name: string): RawRow[] | undefined {
  const wanted = sheetKey(name);
  for (const [sheetName, rows] of Object.entries(sheets)) {
    if (sheetKey(sheetName) === wanted) return rows;
  }
  return undefined;
}

/** A cell as trimmed text. Absent, null and blank all read as ''. */
function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

/**
 * A cell as text, with the export's several spellings of "nothing" folded to
 * null. `N/A` is what the old app writes for a debt with no due date.
 */
function optionalText(value: unknown): string | null {
  const raw = text(value);
  if (raw === '') return null;
  const lowered = raw.toLowerCase();
  if (lowered === 'n/a' || lowered === 'na' || lowered === 'none' || lowered === '-') {
    return null;
  }
  return raw;
}

/**
 * A cell as a number.
 *
 * Falls back to stripping grouping separators and a currency symbol, because a
 * numeric column is only numeric until someone's export writes `1,234.00`.
 */
function numberAt(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const raw = text(value);
  if (raw === '') return null;

  const cleaned = raw.replace(/[^0-9.eE+-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '+') return null;

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/** `True` / `False` as the old app writes them, plus the real thing. */
function booleanAt(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  const raw = text(value).toLowerCase();
  if (raw === '') return fallback;
  if (raw === 'true' || raw === 'yes' || raw === 'y' || raw === '1') return true;
  if (raw === 'false' || raw === 'no' || raw === 'n' || raw === '0') return false;
  return fallback;
}

/**
 * `YYYY-MM-DD HH:MM:SS` (and the date-only form) as **local** wall-clock time.
 *
 * The same reasoning as `format/dates.ts`: the export carries no zone, and
 * `new Date('2026-08-17')` is parsed as UTC midnight by the spec, which lands
 * on the 16th for anyone west of Greenwich. Every transaction would shift a
 * day, and the first and last day of every month would land in the wrong one —
 * a bug that only shows up later, in the analytics.
 */
function dateAt(value: unknown): number | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime();
  }

  // A date-formatted cell read without `cellDates` arrives as an Excel serial:
  // days since 1899-12-30, in wall-clock terms with no zone.
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    return fromExcelSerial(value);
  }

  const raw = text(value);
  if (raw === '') return null;

  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(raw);
  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match;
  const parsed = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour ?? 0),
    Number(minute ?? 0),
    Number(second ?? 0),
  );

  // Rejects impossible dates, which the constructor would otherwise roll
  // forward (2026-02-30 becoming the 2nd of March).
  if (
    parsed.getFullYear() !== Number(year) ||
    parsed.getMonth() !== Number(month) - 1 ||
    parsed.getDate() !== Number(day)
  ) {
    return null;
  }

  return parsed.getTime();
}

/** Excel's day count to local epoch ms, via the UTC parts so no zone is applied twice. */
function fromExcelSerial(serial: number): number {
  const utcMs = Math.round((serial - 25569) * 86_400_000);
  const asUtc = new Date(utcMs);
  return new Date(
    asUtc.getUTCFullYear(),
    asUtc.getUTCMonth(),
    asUtc.getUTCDate(),
    asUtc.getUTCHours(),
    asUtc.getUTCMinutes(),
    asUtc.getUTCSeconds(),
  ).getTime();
}

/**
 * The old app stores a bare symbol; this app stores an ISO 4217 code, because
 * `Intl.NumberFormat` needs one and a symbol is ambiguous across a dozen
 * countries. An unrecognised value falls back rather than being guessed at,
 * and `format/money.ts` already degrades to a plain number for a code it
 * cannot use.
 */
const CURRENCY_BY_SYMBOL: Record<string, string> = {
  '৳': 'BDT',
  $: 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '₹': 'INR',
  '¥': 'JPY',
  '₨': 'PKR',
  '₺': 'TRY',
};

function currencyAt(value: unknown, fallback: string): string {
  const raw = text(value);
  if (raw === '') return fallback;
  if (/^[A-Za-z]{3}$/.test(raw)) return raw.toUpperCase();
  return CURRENCY_BY_SYMBOL[raw] ?? fallback;
}

/**
 * The old app's Material icon names onto this app's four.
 *
 * A miss is cosmetic — one wallet glyph instead of another — so it falls back
 * silently rather than raising an issue a person would have to read and then
 * ignore.
 */
const ICON_ALIASES: Record<string, AccountIcon> = {
  wallet: 'wallet',
  cash: 'wallet',
  money: 'wallet',
  accountbalancewallet: 'wallet',
  card: 'card',
  cardvisa: 'card',
  creditcard: 'card',
  visa: 'card',
  mastercard: 'card',
  bank: 'bank',
  accountbalance: 'bank',
  savings: 'savings',
  piggybank: 'savings',
};

function iconAt(value: unknown): AccountIcon {
  return ICON_ALIASES[normalizeKey(text(value))] ?? 'wallet';
}

/** `#RRGGBB`, or a fallback for anything that is not one. */
function colorAt(value: unknown, fallback: string): string {
  const raw = text(value);
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toUpperCase();
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toUpperCase()}`;
  return fallback;
}

/** Comma- or semicolon-separated, which is the only way a cell can hold a list. */
function tagsAt(value: unknown): string[] {
  const raw = text(value);
  if (raw === '') return [];
  return raw
    .split(/[,;|]/)
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');
}

const DEFAULT_ACCOUNT_COLOR = '#2196F3';

export function parseExport(sheets: RawSheets, fallbackCurrency = 'BDT'): ParsedExport {
  const sheetNames = Object.keys(sheets);
  const issues: ImportIssue[] = [];

  const accountRows = findSheet(sheets, SHEET_ACCOUNTS);
  const expenseRows = findSheet(sheets, SHEET_EXPENSES);
  const debtRows = findSheet(sheets, SHEET_DEBTS);
  const plannedRows = findSheet(sheets, SHEET_PLANNED);

  // Each sheet is optional on its own — the Planned Transactions sheet in the
  // real export is a header with no rows under it — but a file with none of
  // them is some other spreadsheet, and importing zero rows from it would look
  // like success.
  if (!accountRows && !expenseRows && !debtRows && !plannedRows) {
    throw new NotAnExportError(
      sheetNames.length === 0
        ? 'That file has no sheets in it.'
        : `That does not look like an Expense Tracker export. Its sheets are ${sheetNames
            .map((name) => `"${name}"`)
            .join(', ')}, where Accounts, Expenses, Debts & Receivables or Planned Transactions were expected.`,
    );
  }

  return {
    accounts: parseAccounts(accountRows ?? [], fallbackCurrency, issues),
    transactions: parseTransactions(expenseRows ?? [], issues),
    debts: parseDebts(debtRows ?? [], issues),
    planned: parsePlanned(plannedRows ?? [], issues),
    issues,
    sheetNames,
  };
}

function parseAccounts(
  rows: RawRow[],
  fallbackCurrency: string,
  issues: ImportIssue[],
): ParsedAccount[] {
  const accounts: ParsedAccount[] = [];

  rows.forEach((raw, index) => {
    const row = indexRow(raw);
    const rowNumber = index + 1;
    const name = text(row.get('name'));

    if (name === '') {
      issues.push(skip(SHEET_ACCOUNTS, rowNumber, 'the account has no name'));
      return;
    }

    // A missing balance reads as zero rather than skipping the row: an account
    // with no transactions and no balance is still an account worth having.
    accounts.push({
      name,
      balance: numberAt(row.get('balance')) ?? 0,
      colorHex: colorAt(row.get('colorhex'), DEFAULT_ACCOUNT_COLOR),
      icon: iconAt(row.get('icon')),
      currency: currencyAt(row.get('currency'), fallbackCurrency),
      includeInBalance: booleanAt(row.get('includeinbalance'), true),
      displayOrder: numberAt(row.get('displayorder')) ?? index,
    });
  });

  return accounts;
}

/**
 * The Type column, onto this app's three.
 *
 * `DEBT` is the interesting one. It is in the old app's vocabulary, and the
 * money genuinely left an account, so it becomes an EXPENSE rather than being
 * dropped — dropping it would leave the account balance short by the amount.
 * The correction is reported, because a debt repayment appearing as an
 * ordinary expense is a thing to be told about rather than to discover later
 * in the analytics.
 */
function transactionTypeAt(
  value: unknown,
  sheet: string,
  rowNumber: number,
  issues: ImportIssue[],
): TransactionType | null {
  const raw = normalizeKey(text(value));

  switch (raw) {
    case 'expense':
      return 'EXPENSE';
    case 'income':
      return 'INCOME';
    case 'transfer':
      return 'TRANSFER';
    case 'debt':
      issues.push(
        note(sheet, rowNumber, 'recorded as a debt repayment; imported as an expense'),
      );
      return 'EXPENSE';
    case '':
      issues.push(skip(sheet, rowNumber, 'the row has no type'));
      return null;
    default:
      issues.push(
        skip(sheet, rowNumber, `"${text(value)}" is not a transaction type this app has`),
      );
      return null;
  }
}

function parseTransactions(rows: RawRow[], issues: ImportIssue[]): ParsedTransaction[] {
  const transactions: ParsedTransaction[] = [];

  rows.forEach((raw, index) => {
    const row = indexRow(raw);
    const rowNumber = index + 1;

    const date = dateAt(row.get('date'));
    if (date === null) {
      issues.push(
        skip(SHEET_EXPENSES, rowNumber, `"${text(row.get('date'))}" is not a date`),
      );
      return;
    }

    const rawAmount = numberAt(row.get('amount'));
    if (rawAmount === null) {
      issues.push(
        skip(SHEET_EXPENSES, rowNumber, `"${text(row.get('amount'))}" is not an amount`),
      );
      return;
    }

    const type = transactionTypeAt(row.get('type'), SHEET_EXPENSES, rowNumber, issues);
    if (type === null) return;

    // Amounts are magnitudes here and the type carries direction, so a negative
    // expense would *add* money to the account. Normalising the sign is the
    // only reading that keeps the balance right, and it is reported because it
    // is a real change to the row.
    let amount = rawAmount;
    if (amount < 0) {
      amount = Math.abs(amount);
      issues.push(
        note(
          SHEET_EXPENSES,
          rowNumber,
          `the amount was negative (${rawAmount}); imported as ${amount} ${type.toLowerCase()}`,
        ),
      );
    }

    const toAccount = optionalText(row.get('toaccount'));
    if (type === 'TRANSFER' && toAccount === null) {
      // Kept as a transfer with no destination rather than rewritten as an
      // expense: `computeBalances` applies each leg independently, so the
      // source account is still right, and the row keeps saying what it is.
      issues.push(
        note(SHEET_EXPENSES, rowNumber, 'a transfer with no destination account'),
      );
    }

    transactions.push({
      date,
      category: optionalText(row.get('category')),
      description: text(row.get('description')),
      amount,
      type,
      account: optionalText(row.get('account')),
      toAccount,
      tags: tagsAt(row.get('tags')),
    });
  });

  return transactions;
}

function parseDebts(rows: RawRow[], issues: ImportIssue[]): ParsedDebt[] {
  const debts: ParsedDebt[] = [];

  rows.forEach((raw, index) => {
    const row = indexRow(raw);
    const rowNumber = index + 1;

    const date = dateAt(row.get('date'));
    if (date === null) {
      issues.push(
        skip(SHEET_DEBTS, rowNumber, `"${text(row.get('date'))}" is not a date`),
      );
      return;
    }

    const amount = numberAt(row.get('amount'));
    if (amount === null) {
      issues.push(
        skip(SHEET_DEBTS, rowNumber, `"${text(row.get('amount'))}" is not an amount`),
      );
      return;
    }

    const rawType = normalizeKey(text(row.get('type')));
    let type: DebtType;
    if (rawType === 'debt' || rawType === 'owe' || rawType === 'payable') {
      type = 'DEBT';
    } else if (rawType === 'due' || rawType === 'receivable' || rawType === 'owed') {
      type = 'DUE';
    } else {
      issues.push(
        skip(
          SHEET_DEBTS,
          rowNumber,
          `"${text(row.get('type'))}" is neither a debt nor a receivable`,
        ),
      );
      return;
    }

    const status = normalizeKey(text(row.get('status')));

    debts.push({
      date,
      personName: text(row.get('person')) || 'Unknown',
      type,
      // The `.xls` calls it Description and the `.pdf` calls it Note; both are
      // accepted so neither spelling of the same column is lost.
      description: text(row.get('description')) || text(row.get('note')),
      amount: Math.abs(amount),
      dueDate: dateAt(optionalText(row.get('duedate'))),
      isCleared: status === 'settled' || status === 'cleared' || status === 'paid',
    });
  });

  return debts;
}

const INTERVAL_ALIASES: Record<string, IntervalType> = {
  day: 'DAY',
  daily: 'DAY',
  days: 'DAY',
  week: 'WEEK',
  weekly: 'WEEK',
  weeks: 'WEEK',
  month: 'MONTH',
  monthly: 'MONTH',
  months: 'MONTH',
  year: 'YEAR',
  yearly: 'YEAR',
  annually: 'YEAR',
  years: 'YEAR',
};

function parsePlanned(rows: RawRow[], issues: ImportIssue[]): ParsedPlanned[] {
  const planned: ParsedPlanned[] = [];

  rows.forEach((raw, index) => {
    const row = indexRow(raw);
    const rowNumber = index + 1;

    const title = text(row.get('title'));
    if (title === '') {
      issues.push(skip(SHEET_PLANNED, rowNumber, 'the planned entry has no title'));
      return;
    }

    const amount = numberAt(row.get('amount'));
    if (amount === null) {
      issues.push(
        skip(SHEET_PLANNED, rowNumber, `"${text(row.get('amount'))}" is not an amount`),
      );
      return;
    }

    const startDate = dateAt(row.get('startdate'));
    if (startDate === null) {
      issues.push(
        skip(
          SHEET_PLANNED,
          rowNumber,
          `"${text(row.get('startdate'))}" is not a start date`,
        ),
      );
      return;
    }

    const type = transactionTypeAt(row.get('type'), SHEET_PLANNED, rowNumber, issues);
    if (type === null) return;
    if (type === 'TRANSFER') {
      // The recurrence engine has no transfer case, and inventing one from a
      // single source column would be guessing at a destination.
      issues.push(
        skip(
          SHEET_PLANNED,
          rowNumber,
          'a recurring transfer, which this app cannot express',
        ),
      );
      return;
    }

    const intervalRaw = normalizeKey(text(row.get('intervaltype')));
    const intervalType = INTERVAL_ALIASES[intervalRaw];
    if (intervalType === undefined && intervalRaw !== '') {
      issues.push(
        note(
          SHEET_PLANNED,
          rowNumber,
          `"${text(row.get('intervaltype'))}" is not an interval this app has; imported as monthly`,
        ),
      );
    }

    const intervalN = numberAt(row.get('intervaln')) ?? 1;

    planned.push({
      title,
      amount: Math.abs(amount),
      category: optionalText(row.get('category')),
      type,
      account: optionalText(row.get('account')),
      startDate,
      intervalType: intervalType ?? 'MONTH',
      intervalN: intervalN >= 1 ? Math.round(intervalN) : 1,
      oneTime: booleanAt(row.get('onetime'), false),
      nextDueDate: dateAt(optionalText(row.get('nextduedate'))),
      isActive: booleanAt(row.get('isactive'), true),
      description: text(row.get('description')),
    });
  });

  return planned;
}

function skip(sheet: string, row: number, message: string): ImportIssue {
  return {sheet, row, message, isSkipped: true};
}

function note(sheet: string, row: number, message: string): ImportIssue {
  return {sheet, row, message, isSkipped: false};
}
