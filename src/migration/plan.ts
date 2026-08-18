/**
 * What an import would do, worked out before anything is written.
 *
 * The plan is a pure function of (parsed export, current database contents),
 * which is what lets the UI show an exact preview and lets every rule here be
 * tested without Dexie. `apply.ts` does nothing but write what this produced.
 *
 * Four decisions shape it.
 *
 * **The importer only ever creates rows. It never edits or deletes one.**
 * Every row it would write is matched first, and a match means "leave it
 * alone", not "overwrite it". So an imported transaction you corrected
 * afterwards survives a re-import, a renamed account keeps its new name, and
 * re-importing an unchanged file is a no-op rather than a reset. There is no
 * mode in which importing loses work.
 *
 * **Matching is by derived id first, then by name.** The derived id (see
 * `ids.ts`) is what makes a re-import idempotent. Falling back to the name is
 * what lets an import land on the categories `seed.ts` already created — that
 * list was deliberately seeded with the old app's category names — instead of
 * creating a second "Food". Checking the id first is what stops a *renamed*
 * account from being recreated under its old name.
 *
 * **Soft-deleted rows count as present.** A row you imported and then deleted
 * must not come back on the next import. Matching therefore looks at deleted
 * rows too, which is the difference between a delete that sticks and one that
 * silently reverses itself.
 *
 * **Opening balances are derived, not copied.** The old app's `Balance` column
 * is a *current* balance — the number it had incrementally mutated on every
 * write. This app stores an opening balance and derives the current one from
 * the ledger (PROGRESS.md section 4). Copying the column into
 * `openingBalance` would therefore double-count the entire history: the real
 * file's Cash account would import as -10,873 and then immediately render as
 * -21,746. The opening balance is instead solved for:
 *
 *     openingBalance = exportedBalance - (what the imported ledger does to it)
 *
 * so that after the import this app computes exactly the balance the old app
 * displayed. That equality is the single best check that the import was
 * faithful, and `balanceChecks` puts it in front of the user before they
 * commit to it.
 */
import {effectOnAccount} from '../domain/balances';
import type {NewRow} from '../db/repo';
import type {
  Account,
  Category,
  CategoryKind,
  Debt,
  DebtPayment,
  PlannedTransaction,
  Transaction,
} from '../db/types';
import {importedId, naturalKey, normalizeName} from './ids';
import type {
  ImportIssue,
  ParsedDebt,
  ParsedExport,
  ParsedPlanned,
  ParsedTransaction,
} from './parse';

/** The rows already in the database, **including soft-deleted ones**. */
export interface ExistingData {
  accounts: readonly Account[];
  categories: readonly Category[];
  transactions: readonly Transaction[];
  debts: readonly Debt[];
  debtPayments: readonly DebtPayment[];
  planned: readonly PlannedTransaction[];
}

/** An empty database, for the first-run case and for tests. */
export const NO_EXISTING_DATA: ExistingData = {
  accounts: [],
  categories: [],
  transactions: [],
  debts: [],
  debtPayments: [],
  planned: [],
};

/**
 * The old app's number against this app's, per account.
 *
 * The whole point of the import in one row: if these two disagree, something
 * was lost or double-counted, and it is visible before the write rather than
 * after.
 */
export interface AccountBalanceCheck {
  name: string;
  currency: string;
  /** What the old app's export says the balance is. Null for an account the export never listed. */
  exportedBalance: number | null;
  /** What this app will compute once the plan is applied. */
  projectedBalance: number;
  /** Opening balance the plan will store. Only ever set on an account the import creates. */
  openingBalance: number;
  isCreated: boolean;
}

export interface ImportCounts {
  accounts: number;
  categories: number;
  transactions: number;
  debts: number;
  debtPayments: number;
  planned: number;
}

export interface ImportPlan {
  create: {
    accounts: NewRow<Account>[];
    categories: NewRow<Category>[];
    transactions: NewRow<Transaction>[];
    debts: NewRow<Debt>[];
    debtPayments: NewRow<DebtPayment>[];
    planned: NewRow<PlannedTransaction>[];
  };
  /** Rows in the file that are already here. On a second import of the same file, this is everything. */
  alreadyPresent: ImportCounts;
  issues: ImportIssue[];
  balanceChecks: AccountBalanceCheck[];
  /**
   * Totals straight from the file, for reconciling against the old app's own
   * `.pdf` report before trusting any of this.
   */
  fileTotals: {
    transactions: number;
    expenses: number;
    income: number;
    debts: number;
    /** Outstanding on debts the export still calls unsettled. */
    activeDebt: number;
    activeReceivable: number;
  };
  /** Nothing to do — every row in the file is already here. */
  isEmpty: boolean;
}

export function countCreates(plan: ImportPlan): number {
  return (
    plan.create.accounts.length +
    plan.create.categories.length +
    plan.create.transactions.length +
    plan.create.debts.length +
    plan.create.debtPayments.length +
    plan.create.planned.length
  );
}

/**
 * Colours for categories the import has to invent (the real file's "Debt
 * Repayment" is one).
 *
 * Taken from `seed.ts`, where they were measured against both the light and
 * the dark card surface — a fresh hex would have to be measured again.
 * Selection is by a hash of the name rather than by position, so two devices
 * importing the same file independently invent the *same* colour: these rows
 * share a derived id, and a differing colour would otherwise have the two
 * devices overwrite each other under last-write-wins on every sync.
 */
const INVENTED_COLORS = [
  '#EA3B35',
  '#2196F3',
  '#A15437',
  '#E0407F',
  '#A537B8',
  '#D47D00',
  '#00A3B8',
  '#007296',
  '#4C61C7',
  '#5C9000',
  '#D42A6D',
  '#009688',
  '#007B17',
  '#2E9E6B',
];

/** Lucide names for the category names the old app is likely to hold. */
const INVENTED_ICONS: Record<string, string> = {
  debtrepayment: 'hand-coins',
  loan: 'hand-coins',
  rent: 'house',
  fuel: 'fuel',
  petrol: 'fuel',
  phone: 'smartphone',
  internet: 'wifi',
  clothing: 'shirt',
  clothes: 'shirt',
  entertainment: 'party-popper',
  savings: 'piggy-bank',
  investment: 'trending-up',
  charity: 'heart-handshake',
  tax: 'landmark',
  insurance: 'shield',
};

/** Deterministic pick from the palette above. */
function inventedColor(key: string): string {
  return INVENTED_COLORS[hashName(key) % INVENTED_COLORS.length] ?? '#767676';
}

/** Small, stable string hash. Only has to spread names across a palette. */
function hashName(name: string): number {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Index rows by name and by id, preferring a live row to a deleted one.
 *
 * The preference matters: a user who deleted "Food" and then made a new one
 * should have the import land on the live row, not resurrect the deleted one
 * by writing transactions that point at it.
 */
function indexByName<T extends {id: string; deletedAt: number | null}>(
  rows: readonly T[],
  nameOf: (row: T) => string,
): Map<string, T> {
  const byName = new Map<string, T>();

  for (const row of rows) {
    const key = normalizeName(nameOf(row));
    const held = byName.get(key);
    if (held === undefined || (held.deletedAt !== null && row.deletedAt === null)) {
      byName.set(key, row);
    }
  }

  return byName;
}

function idSet(rows: readonly {id: string}[]): Set<string> {
  return new Set(rows.map((row) => row.id));
}

/**
 * A category the import needs, and what is known about how it is used.
 *
 * `kind` is inferred from the transactions referencing it rather than
 * defaulting to EXPENSE, because a category set to the wrong kind disappears
 * from half the app's pickers.
 */
interface CategoryDemand {
  name: string;
  hasExpense: boolean;
  hasIncome: boolean;
}

export function buildImportPlan(
  parsed: ParsedExport,
  existing: ExistingData = NO_EXISTING_DATA,
  importedAt: number = Date.now(),
): ImportPlan {
  const issues: ImportIssue[] = [...parsed.issues];

  const existingAccountIds = idSet(existing.accounts);
  const existingCategoryIds = idSet(existing.categories);
  const existingTransactionIds = idSet(existing.transactions);
  const existingDebtIds = idSet(existing.debts);
  const existingPaymentIds = idSet(existing.debtPayments);
  const existingPlannedIds = idSet(existing.planned);

  const accountsByName = indexByName(existing.accounts, (row) => row.name);
  const categoriesByName = indexByName(existing.categories, (row) => row.name);

  const alreadyPresent: ImportCounts = {
    accounts: 0,
    categories: 0,
    transactions: 0,
    debts: 0,
    debtPayments: 0,
    planned: 0,
  };

  // ---- Accounts -------------------------------------------------------
  //
  // Ids are resolved first because everything else references them, but the
  // rows are not finished here: `openingBalance` cannot be worked out until
  // the ledger it has to cancel out is known.

  const accountIdByName = new Map<string, string>();
  const exportedBalanceById = new Map<string, number>();
  const currencyById = new Map<string, string>();
  const nameById = new Map<string, string>();
  const createdAccounts: {row: NewRow<Account>; id: string}[] = [];

  const registerExisting = (row: Account) => {
    accountIdByName.set(normalizeName(row.name), row.id);
    currencyById.set(row.id, row.currency);
    nameById.set(row.id, row.name);
  };

  for (const account of parsed.accounts) {
    const key = normalizeName(account.name);
    const derivedId = importedId('account', naturalKey([key]));

    // By id first: an account this importer created and the user has since
    // renamed is still that account, and must not be created a second time
    // under its old name.
    const matched = existingAccountIds.has(derivedId)
      ? existing.accounts.find((row) => row.id === derivedId)
      : accountsByName.get(key);

    if (matched !== undefined) {
      registerExisting(matched);
      exportedBalanceById.set(matched.id, account.balance);
      alreadyPresent.accounts += 1;
      continue;
    }

    accountIdByName.set(key, derivedId);
    exportedBalanceById.set(derivedId, account.balance);
    currencyById.set(derivedId, account.currency);
    nameById.set(derivedId, account.name);

    createdAccounts.push({
      id: derivedId,
      row: {
        id: derivedId,
        createdAt: importedAt,
        name: account.name,
        // Filled in below, once the imported ledger for this account is known.
        openingBalance: 0,
        colorHex: account.colorHex,
        icon: account.icon,
        currency: account.currency,
        includeInBalance: account.includeInBalance,
        displayOrder: account.displayOrder,
      },
    });
  }

  // Accounts named by a transaction but missing from the Accounts sheet. Left
  // unresolved they would import as transactions with no account, which drop
  // out of every balance and show a dash in the ledger — the export would look
  // like it imported cleanly while the totals quietly disagreed.
  const referencedAccounts = new Set<string>();
  for (const txn of parsed.transactions) {
    if (txn.account !== null) referencedAccounts.add(normalizeName(txn.account));
    if (txn.toAccount !== null) referencedAccounts.add(normalizeName(txn.toAccount));
  }
  for (const planned of parsed.planned) {
    if (planned.account !== null) referencedAccounts.add(normalizeName(planned.account));
  }

  let inventedOrder = parsed.accounts.length;
  for (const key of referencedAccounts) {
    if (accountIdByName.has(key)) continue;

    const derivedId = importedId('account', naturalKey([key]));
    const matched = existingAccountIds.has(derivedId)
      ? existing.accounts.find((row) => row.id === derivedId)
      : accountsByName.get(key);

    if (matched !== undefined) {
      registerExisting(matched);
      continue;
    }

    const displayName = originalCase(parsed, key);
    accountIdByName.set(key, derivedId);
    currencyById.set(derivedId, 'BDT');
    nameById.set(derivedId, displayName);
    issues.push({
      sheet: 'Expenses',
      row: 0,
      message: `"${displayName}" is used by a transaction but is not on the Accounts sheet; it will be created with an opening balance of 0`,
      isSkipped: false,
    });

    createdAccounts.push({
      id: derivedId,
      row: {
        id: derivedId,
        createdAt: importedAt,
        name: displayName,
        openingBalance: 0,
        colorHex: inventedColor(key),
        icon: 'wallet',
        currency: 'BDT',
        includeInBalance: true,
        displayOrder: (inventedOrder += 1),
      },
    });
  }

  // ---- Categories -----------------------------------------------------
  //
  // The export has no category sheet; categories exist only as the names
  // transactions and planned entries refer to.

  const demands = new Map<string, CategoryDemand>();
  const demand = (name: string, type: string) => {
    const key = normalizeName(name);
    const held = demands.get(key) ?? {name, hasExpense: false, hasIncome: false};
    if (type === 'INCOME') held.hasIncome = true;
    else held.hasExpense = true;
    demands.set(key, held);
  };

  for (const txn of parsed.transactions) {
    if (txn.category !== null) demand(txn.category, txn.type);
  }
  for (const planned of parsed.planned) {
    if (planned.category !== null) demand(planned.category, planned.type);
  }

  const categoryIdByName = new Map<string, string>();
  const createdCategories: NewRow<Category>[] = [];
  let categoryOrder =
    existing.categories.reduce((max, row) => Math.max(max, row.displayOrder), -1) + 1;

  for (const [key, held] of demands) {
    const derivedId = importedId('category', naturalKey([key]));
    const matched = existingCategoryIds.has(derivedId)
      ? existing.categories.find((row) => row.id === derivedId)
      : categoriesByName.get(key);

    if (matched !== undefined) {
      categoryIdByName.set(key, matched.id);
      alreadyPresent.categories += 1;
      continue;
    }

    const kind: CategoryKind =
      held.hasExpense && held.hasIncome ? 'BOTH' : held.hasIncome ? 'INCOME' : 'EXPENSE';

    categoryIdByName.set(key, derivedId);
    createdCategories.push({
      id: derivedId,
      createdAt: importedAt,
      name: held.name,
      icon: INVENTED_ICONS[key.replace(/[^a-z0-9]/g, '')] ?? 'circle-ellipsis',
      colorHex: inventedColor(key),
      kind,
      displayOrder: (categoryOrder += 1),
      // Not a default: defaults are the seeded set, and marking an imported
      // category as one would put it back on a "restore defaults" path it was
      // never part of.
      isDefault: false,
    });
  }

  // ---- Transactions ---------------------------------------------------

  const createdTransactions: NewRow<Transaction>[] = [];
  const transactionIdsInPlan = new Map<number, string>();
  const occurrences = new Map<string, number>();

  parsed.transactions.forEach((txn, index) => {
    const base = transactionKey(txn);
    const seen = occurrences.get(base) ?? 0;
    occurrences.set(base, seen + 1);

    // Two rows identical in every column are two real spends, so the
    // occurrence index keeps them apart. Without it the second would take the
    // first's id and silently vanish.
    const id = importedId('transaction', naturalKey([base, seen]));
    transactionIdsInPlan.set(index, id);

    if (existingTransactionIds.has(id)) {
      alreadyPresent.transactions += 1;
      return;
    }

    createdTransactions.push({
      id,
      // The row really was created on the day it happened; `updatedAt` is
      // stamped with the import by the repository, which is what sync needs.
      createdAt: txn.date,
      amount: txn.amount,
      description: txn.description,
      categoryId: txn.category === null ? null : (categoryIdByName.get(normalizeName(txn.category)) ?? null),
      date: txn.date,
      type: txn.type,
      accountId: txn.account === null ? null : (accountIdByName.get(normalizeName(txn.account)) ?? null),
      toAccountId:
        txn.toAccount === null
          ? null
          : (accountIdByName.get(normalizeName(txn.toAccount)) ?? null),
      tags: txn.tags,
      plannedId: null,
      occurrenceDate: null,
    });
  });

  // ---- Debts, and the ledger entries that settled them -----------------

  const createdDebts: NewRow<Debt>[] = [];
  const createdPayments: NewRow<DebtPayment>[] = [];
  const debtOccurrences = new Map<string, number>();
  const claimedTransactions = new Set<number>();

  for (const debt of parsed.debts) {
    const base = debtKey(debt);
    const seen = debtOccurrences.get(base) ?? 0;
    debtOccurrences.set(base, seen + 1);

    const id = importedId('debt', naturalKey([base, seen]));

    if (existingDebtIds.has(id)) {
      alreadyPresent.debts += 1;
    } else {
      createdDebts.push({
        id,
        createdAt: debt.date,
        personName: debt.personName,
        amount: debt.amount,
        description: debt.description,
        date: debt.date,
        dueDate: debt.dueDate,
        type: debt.type,
        isCleared: debt.isCleared,
        // The export does not say which account a debt is against, and
        // guessing would attach money to the wrong wallet.
        accountId: null,
      });
    }

    if (!debt.isCleared) continue;

    // A settled debt with no payment row would render as fully outstanding,
    // because this app derives the outstanding balance from `debtPayments`
    // rather than trusting a flag (see `computeDebtOutstanding`). So a
    // settlement is recorded for it.
    const paymentId = importedId('debtPayment', naturalKey([id]));
    if (existingPaymentIds.has(paymentId)) {
      alreadyPresent.debtPayments += 1;
      continue;
    }

    // The old app also posts the settlement to the ledger, as an expense
    // described `Repaid: {person} ({description})`. That row is already being
    // imported as an ordinary transaction — the money did leave the account —
    // so the payment links to it rather than creating a second one. Linking is
    // what makes deleting either side able to find the other.
    const settlementIndex = findSettlement(parsed.transactions, debt, claimedTransactions);
    const settlement =
      settlementIndex === null ? null : (parsed.transactions[settlementIndex] ?? null);
    if (settlementIndex !== null) claimedTransactions.add(settlementIndex);

    createdPayments.push({
      id: paymentId,
      createdAt: debt.date,
      debtId: id,
      amount: debt.amount,
      date: settlement === null ? (debt.dueDate ?? debt.date) : settlement.date,
      transactionId:
        settlementIndex === null ? null : (transactionIdsInPlan.get(settlementIndex) ?? null),
    });
  }

  // ---- Planned transactions -------------------------------------------

  const createdPlanned: NewRow<PlannedTransaction>[] = [];
  const plannedOccurrences = new Map<string, number>();

  for (const planned of parsed.planned) {
    const base = plannedKey(planned);
    const seen = plannedOccurrences.get(base) ?? 0;
    plannedOccurrences.set(base, seen + 1);

    const id = importedId('planned', naturalKey([base, seen]));
    if (existingPlannedIds.has(id)) {
      alreadyPresent.planned += 1;
      continue;
    }

    createdPlanned.push({
      id,
      createdAt: planned.startDate,
      title: planned.title,
      amount: planned.amount,
      categoryId:
        planned.category === null
          ? null
          : (categoryIdByName.get(normalizeName(planned.category)) ?? null),
      type: planned.type,
      accountId:
        planned.account === null
          ? null
          : (accountIdByName.get(normalizeName(planned.account)) ?? null),
      startDate: planned.startDate,
      intervalType: planned.intervalType,
      intervalN: planned.intervalN,
      oneTime: planned.oneTime,
      nextDueDate: planned.nextDueDate ?? planned.startDate,
      endDate: null,
      isActive: planned.isActive,
      description: planned.description,
    });
  }

  // ---- Opening balances, and the check that they are right -------------

  const balanceChecks = solveOpeningBalances({
    existing,
    createdAccounts,
    createdTransactions,
    exportedBalanceById,
    currencyById,
    nameById,
  });

  const plan: ImportPlan = {
    create: {
      accounts: createdAccounts.map((entry) => entry.row),
      categories: createdCategories,
      transactions: createdTransactions,
      debts: createdDebts,
      debtPayments: createdPayments,
      planned: createdPlanned,
    },
    alreadyPresent,
    issues,
    balanceChecks,
    fileTotals: fileTotals(parsed),
    isEmpty: false,
  };

  return {...plan, isEmpty: countCreates(plan) === 0};
}

/**
 * Solve each created account's opening balance, then state what this app will
 * show against what the old app said.
 *
 * For an account the import creates, the opening balance is chosen so the two
 * agree exactly. For one that already exists the opening balance is left
 * alone — silently rewriting the opening balance of an account already in use
 * would restate every balance the user has seen — so the two can differ, and
 * the check is where that becomes visible instead of surprising.
 */
function solveOpeningBalances(input: {
  existing: ExistingData;
  createdAccounts: {row: NewRow<Account>; id: string}[];
  createdTransactions: NewRow<Transaction>[];
  exportedBalanceById: Map<string, number>;
  currencyById: Map<string, string>;
  nameById: Map<string, string>;
}): AccountBalanceCheck[] {
  const {existing, createdAccounts, createdTransactions, exportedBalanceById} = input;

  // What the whole ledger — what is here already, plus what is about to be
  // written — does to each account. `effectOnAccount` is the same function the
  // app's own balances go through, so this cannot drift from what the user
  // will see.
  const ledger = new Map<string, number>();
  const applyLedger = (txn: {
    deletedAt: number | null;
    type: Transaction['type'];
    amount: number;
    accountId: string | null;
    toAccountId: string | null;
  }) => {
    for (const accountId of [txn.accountId, txn.toAccountId]) {
      if (accountId === null) continue;
      const effect = effectOnAccount(txn as Transaction, accountId);
      if (effect !== 0) ledger.set(accountId, (ledger.get(accountId) ?? 0) + effect);
    }
  };

  for (const txn of existing.transactions) {
    if (txn.deletedAt !== null) continue;
    applyLedger(txn);
  }
  for (const txn of createdTransactions) {
    applyLedger({...txn, deletedAt: null} as Transaction);
  }

  const checks: AccountBalanceCheck[] = [];

  for (const {row, id} of createdAccounts) {
    const exported = exportedBalanceById.get(id) ?? null;
    const fromLedger = ledger.get(id) ?? 0;

    // The whole derivation, in one line.
    row.openingBalance = exported === null ? 0 : exported - fromLedger;

    checks.push({
      name: row.name,
      currency: row.currency,
      exportedBalance: exported,
      projectedBalance: row.openingBalance + fromLedger,
      openingBalance: row.openingBalance,
      isCreated: true,
    });
  }

  for (const account of existing.accounts) {
    if (account.deletedAt !== null) continue;
    const exported = exportedBalanceById.get(account.id);
    // Only accounts the file mentions are worth checking; the rest are this
    // device's own and have nothing to be compared against.
    if (exported === undefined) continue;

    checks.push({
      name: account.name,
      currency: account.currency,
      exportedBalance: exported,
      projectedBalance: account.openingBalance + (ledger.get(account.id) ?? 0),
      openingBalance: account.openingBalance,
      isCreated: false,
    });
  }

  return checks;
}

/**
 * The ledger row that settled a debt, if the export holds one.
 *
 * The old app writes `Repaid: {person} ({description})` for a debt it settles,
 * so the exact string is tried first. The fallback — an unclaimed expense of
 * exactly the same amount that mentions the person — catches a wording change
 * without matching anything a person would not recognise as the settlement.
 */
function findSettlement(
  transactions: readonly ParsedTransaction[],
  debt: ParsedDebt,
  claimed: ReadonlySet<number>,
): number | null {
  const exact = [
    `repaid: ${debt.personName} (${debt.description})`,
    `received: ${debt.personName} (${debt.description})`,
    `repaid ${debt.personName} (${debt.description})`,
  ].map((candidate) => candidate.toLowerCase());

  let fallback: number | null = null;

  for (const [index, txn] of transactions.entries()) {
    if (claimed.has(index)) continue;
    if (txn.amount !== debt.amount) continue;
    if (txn.date < debt.date) continue;

    const description = txn.description.trim().toLowerCase();
    if (exact.includes(description)) return index;

    if (
      fallback === null &&
      /^(repaid|received|settled)\b/.test(description) &&
      description.includes(debt.personName.trim().toLowerCase())
    ) {
      fallback = index;
    }
  }

  return fallback;
}

function transactionKey(txn: ParsedTransaction): string {
  return naturalKey([
    txn.date,
    txn.amount,
    txn.type,
    txn.account === null ? null : normalizeName(txn.account),
    txn.toAccount === null ? null : normalizeName(txn.toAccount),
    txn.category === null ? null : normalizeName(txn.category),
    txn.description.trim(),
    txn.tags.join(','),
  ]);
}

function debtKey(debt: ParsedDebt): string {
  return naturalKey([
    debt.date,
    debt.amount,
    debt.type,
    normalizeName(debt.personName),
    debt.description.trim(),
  ]);
}

function plannedKey(planned: ParsedPlanned): string {
  return naturalKey([
    planned.startDate,
    planned.amount,
    planned.type,
    normalizeName(planned.title),
    planned.account === null ? null : normalizeName(planned.account),
    planned.intervalType,
    planned.intervalN,
  ]);
}

/** The name as the file spells it, for an account only a transaction mentioned. */
function originalCase(parsed: ParsedExport, key: string): string {
  for (const txn of parsed.transactions) {
    if (txn.account !== null && normalizeName(txn.account) === key) return txn.account.trim();
    if (txn.toAccount !== null && normalizeName(txn.toAccount) === key) {
      return txn.toAccount.trim();
    }
  }
  for (const planned of parsed.planned) {
    if (planned.account !== null && normalizeName(planned.account) === key) {
      return planned.account.trim();
    }
  }
  return key;
}

function fileTotals(parsed: ParsedExport): ImportPlan['fileTotals'] {
  let expenses = 0;
  let income = 0;

  for (const txn of parsed.transactions) {
    if (txn.type === 'EXPENSE') expenses += txn.amount;
    else if (txn.type === 'INCOME') income += txn.amount;
  }

  let activeDebt = 0;
  let activeReceivable = 0;

  for (const debt of parsed.debts) {
    if (debt.isCleared) continue;
    if (debt.type === 'DEBT') activeDebt += debt.amount;
    else activeReceivable += debt.amount;
  }

  return {
    transactions: parsed.transactions.length,
    expenses,
    income,
    debts: parsed.debts.length,
    activeDebt,
    activeReceivable,
  };
}
