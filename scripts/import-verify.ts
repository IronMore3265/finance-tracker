/**
 * Reconcile the migration importer against the real export, and against the
 * old app's own report of the same data.
 *
 *   npm run test:import
 *
 * Deliberately not part of `npm test`: it needs the two files in
 * `migration-data/`, which is gitignored because it holds real financial data
 * and this repo is public. Without them the script says so and exits 0 —
 * a fork with no export to migrate has nothing to check here.
 *
 * The unit tests prove the importer's rules against workbooks written to
 * exercise them. What they cannot prove is that those rules match the file
 * this app exists to migrate: a real BIFF8 workbook, with the real column
 * order, the real spellings, and ninety-one real rows. That is what this does,
 * and it does it against an authority the importer had no part in producing —
 * the `.pdf` report the old app exported alongside the `.xls`. If a row were
 * dropped, a type misread, or an amount parsed out of the wrong column, the
 * two files would stop agreeing.
 *
 * Nothing here touches the app's real database. The plan is applied to a
 * throwaway `fake-indexeddb` instance so the last and most important check —
 * that this app's derived balances come out equal to the balances the old app
 * displayed — runs against the same `computeBalances` the UI uses.
 *
 * **On reading the PDF.** It is a POI-written document with subsetted fonts,
 * so its text is glyph ids rather than characters, offset from ASCII by a
 * constant. That offset is a property of this particular exporter's font
 * subsetting, not a standard, so `decodeReport` verifies it recovered a
 * sentence it recognises before any number read out of it is trusted. If it
 * cannot, the script says the PDF was unreadable and checks only what the
 * `.xls` can check on its own — an unreadable report must not read as a pass.
 */
import 'fake-indexeddb/auto';
import {existsSync, readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import {createTestDatabase} from '../src/db/db';
import {computeBalances} from '../src/domain/balances';
import {computeDebtOutstanding} from '../src/db/commands';
import {applyImportPlan, readExistingData} from '../src/migration/apply';
import {parseExport} from '../src/migration/parse';
import {buildImportPlan} from '../src/migration/plan';
import {readWorkbook} from '../src/migration/xls';

const XLS_PATH = 'migration-data/expenses_and_debts_export.xls';
const PDF_PATH = 'migration-data/expenses_and_debts_export.pdf';

let failures = 0;

function check(label: string, passed: boolean, detail = ''): void {
  if (!passed) failures += 1;
  const mark = passed ? 'ok  ' : 'FAIL';
  console.log(`${mark} ${label}${detail === '' ? '' : `  — ${detail}`}`);
}

/** Money, the way both files print it. */
const money = (value: number) =>
  value.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});

// ---------------------------------------------------------------- the PDF

interface Report {
  /**
   * The old app's headline figure. It sums *every* transaction regardless of
   * type — expenses and income together — which is a quirk of the old app's
   * report rather than a total anyone would call "spent". Reproduced here as
   * it is, because the point is to agree with the file, not to correct it.
   */
  spent: number;
  activeDebt: number;
  activeReceivable: number;
  /** One per row of the transaction log. */
  loggedTransactions: number;
  loggedDebts: number;
}

function decodeReport(path: string): Report | null {
  const bytes = readFileSync(path);

  // Content streams, inflated. Anything that is not Flate (an embedded font
  // program, say) is skipped rather than treated as text.
  let content = '';
  let cursor = 0;
  for (;;) {
    const start = bytes.indexOf('stream', cursor);
    if (start === -1) break;

    let from = start + 'stream'.length;
    if (bytes[from] === 0x0d) from += 1;
    if (bytes[from] === 0x0a) from += 1;

    const end = bytes.indexOf('endstream', from);
    if (end === -1) break;

    try {
      content += `${inflateSync(bytes.subarray(from, end)).toString('latin1')}\n`;
    } catch {
      // Not a Flate stream. Nothing to read here.
    }
    cursor = end + 'endstream'.length;
  }

  // Each glyph is drawn by its own `<hex> Tj`, positioned by the `Td` before
  // it. A non-zero vertical move means a new line.
  const GLYPH_OFFSET = 0x1c;
  let text = '';
  for (const line of content.split('\n')) {
    const drawn = /^([\d.-]+)\s+([\d.-]+)\s+Td\s+<([0-9A-Fa-f]+)>\s+Tj/.exec(line);
    if (!drawn) continue;

    if (drawn[2] !== '0') text += '\n';

    const hex = drawn[3]!;
    // Two-byte codes for the CID-keyed fonts, one byte for the simple ones.
    const codes = hex.length % 4 === 0 && hex.length > 2 ? hex.match(/.{4}/g) : hex.match(/.{2}/g);
    for (const code of codes ?? []) {
      text += String.fromCharCode(parseInt(code, 16) + GLYPH_OFFSET);
    }
  }

  // The offset is this exporter's, not a standard. If it were wrong every
  // number below would still parse and every one of them would be wrong, so
  // nothing is read out of the document until it has said something
  // recognisable.
  if (!text.includes('Expense Tracker')) return null;

  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line !== '');

  const after = (label: string): number | null => {
    const at = lines.findIndex((line) => line.startsWith(label));
    if (at === -1) return null;
    // The figure follows the label, separated by the currency symbol, which is
    // set in its own font and so lands on its own line.
    for (const line of lines.slice(at + 1, at + 4)) {
      if (/^[\d,]+\.\d{2}$/.test(line)) return Number(line.replace(/,/g, ''));
    }
    return null;
  };

  const spent = after('Transactions Spent');
  const activeDebt = after('Total Active Debts');
  const activeReceivable = after('Total Active Receivables');
  if (spent === null || activeDebt === null || activeReceivable === null) return null;

  return {
    spent,
    activeDebt,
    activeReceivable,
    // A transaction row is stamped to the second; a debt row is a bare date.
    loggedTransactions: lines.filter((line) =>
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(line),
    ).length,
    loggedDebts: lines.filter((line) => /^\d{4}-\d{2}-\d{2}$/.test(line)).length,
  };
}

// ------------------------------------------------------------------- main

async function main(): Promise<void> {
  if (!existsSync(XLS_PATH)) {
    console.log(
      `No export at ${XLS_PATH}. This check needs the old app's own files, which are\n` +
        'gitignored because they hold real financial data. Nothing to verify.',
    );
    process.exit(0);
  }

  const file = readFileSync(XLS_PATH);
  const sheets = await readWorkbook(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer,
  );

  console.log(`Sheets: ${Object.keys(sheets).join(', ')}\n`);

  const parsed = parseExport(sheets);

  console.log('--- parsing the workbook ---');
  check(
    'every sheet the old app writes is present',
    ['Accounts', 'Expenses', 'Debts & Receivables', 'Planned Transactions'].every((name) =>
      Object.keys(sheets).includes(name),
    ),
  );
  check(
    'no row was skipped',
    parsed.issues.every((issue) => !issue.isSkipped),
    parsed.issues
      .filter((issue) => issue.isSkipped)
      .map((issue) => `${issue.sheet} row ${issue.row}: ${issue.message}`)
      .join('; '),
  );

  for (const issue of parsed.issues.filter((issue) => !issue.isSkipped)) {
    console.log(`     note: ${issue.sheet} row ${issue.row}: ${issue.message}`);
  }

  // A fresh database with no seed, so every row in the file has to be created
  // and the counts are the file's own.
  const db = createTestDatabase(`import-verify-${Date.now()}`);
  await db.open();

  const plan = buildImportPlan(parsed, await readExistingData(db));
  const result = await applyImportPlan(plan, db);

  console.log(
    `\nParsed ${parsed.accounts.length} accounts, ${parsed.transactions.length} transactions, ` +
      `${parsed.debts.length} debts, ${parsed.planned.length} planned entries.`,
  );
  console.log(
    `Wrote ${result.total} rows: ${JSON.stringify(result.created)}\n`,
  );

  console.log('--- against the old app report ---');
  const report = existsSync(PDF_PATH) ? decodeReport(PDF_PATH) : null;

  if (report === null) {
    failures += 1;
    console.log(
      existsSync(PDF_PATH)
        ? 'FAIL could not read the .pdf report, so none of its figures were checked.'
        : `FAIL no report at ${PDF_PATH}; the .xls cannot be reconciled against anything.`,
    );
  } else {
    const {expenses, income, activeDebt, activeReceivable} = plan.fileTotals;

    check(
      'the transaction log holds as many rows as the spreadsheet',
      report.loggedTransactions === parsed.transactions.length,
      `${report.loggedTransactions} logged, ${parsed.transactions.length} parsed`,
    );
    check(
      'the debt log holds as many rows as the spreadsheet',
      report.loggedDebts === parsed.debts.length,
      `${report.loggedDebts} logged, ${parsed.debts.length} parsed`,
    );
    check(
      'every amount adds up to the report total',
      Math.abs(expenses + income - report.spent) < 0.005,
      `report ${money(report.spent)}, parsed ${money(expenses + income)} ` +
        `(${money(expenses)} out, ${money(income)} in)`,
    );
    check(
      'outstanding debt matches',
      Math.abs(activeDebt - report.activeDebt) < 0.005,
      `report ${money(report.activeDebt)}, parsed ${money(activeDebt)}`,
    );
    check(
      'outstanding receivables match',
      Math.abs(activeReceivable - report.activeReceivable) < 0.005,
      `report ${money(report.activeReceivable)}, parsed ${money(activeReceivable)}`,
    );
  }

  console.log('\n--- balances, after importing ---');
  const accounts = await db.accounts.toArray();
  const balances = computeBalances(accounts, await db.transactions.toArray());

  for (const check_ of plan.balanceChecks) {
    const account = accounts.find((row) => row.name === check_.name);
    const derived = account === undefined ? Number.NaN : (balances.get(account.id) ?? 0);

    // The property the whole design rests on: this app stores an opening
    // balance and derives the rest, and the derivation has to land exactly on
    // the number the old app displayed.
    check(
      `${check_.name}: derived balance equals the exported one`,
      check_.exportedBalance !== null && Math.abs(derived - check_.exportedBalance) < 0.005,
      `exported ${money(check_.exportedBalance ?? Number.NaN)}, derived ${money(derived)} ` +
        `(opening ${money(check_.openingBalance)})`,
    );
  }

  console.log('\n--- debts, after importing ---');
  const outstanding = computeDebtOutstanding(
    await db.debts.toArray(),
    await db.debtPayments.toArray(),
  );
  const settledWithBalance = (await db.debts.toArray()).filter(
    (debt) => debt.isCleared && (outstanding.get(debt.id) ?? 0) > 0,
  );
  check(
    'no settled debt is still showing an outstanding balance',
    settledWithBalance.length === 0,
    settledWithBalance.map((debt) => debt.description).join(', '),
  );

  const payments = await db.debtPayments.toArray();
  const linked = payments.filter((payment) => payment.transactionId !== null);
  console.log(
    `     ${payments.length} settlement(s), ${linked.length} linked to a ledger row.`,
  );

  console.log('\n--- re-importing the same file ---');
  const second = buildImportPlan(parsed, await readExistingData(db));
  const secondResult = await applyImportPlan(second, db);

  check('a second import writes nothing', secondResult.total === 0, `${secondResult.total} rows`);
  check(
    'and the transaction count is unchanged',
    (await db.transactions.count()) === parsed.transactions.length,
  );

  db.close();

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} CHECK(S) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error('\nThrew:', error);
  process.exit(1);
});
