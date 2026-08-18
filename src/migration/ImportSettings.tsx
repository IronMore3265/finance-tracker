/**
 * The migration section of the Settings screen.
 *
 * One section rather than a destination of its own, for the same reason sync
 * is: this is a thing you do once, on the day you switch, and a permanent nav
 * entry for it would be a permanent reminder of a job already finished.
 *
 * What it insists on showing before it writes anything:
 *
 *   - **What the old app said each balance was, next to what this app will
 *     compute.** The two numbers come from different places — one is read out
 *     of the file, the other is derived from the ledger by the same function
 *     the rest of the app uses — so their agreeing is real evidence that
 *     nothing was dropped or double-counted. It is the check a person can
 *     actually make against the phone in their other hand.
 *   - **Every row the importer could not take faithfully**, by sheet and row
 *     number, before the write rather than after. An importer that silently
 *     skips four transactions is worse than one that refuses.
 *   - **That importing twice is safe.** People re-export and re-import; being
 *     told the second run added nothing is what makes it obvious that it is
 *     allowed.
 *
 * SheetJS is reached only through `xls.ts`, and only when a file is actually
 * picked, so a person who never opens this section never downloads it.
 */
import {useState} from 'react';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Collapsible} from '@astryxdesign/core/Collapsible';
import {FileInput} from '@astryxdesign/core/FileInput';
import {Heading} from '@astryxdesign/core/Heading';
import {List, ListItem} from '@astryxdesign/core/List';
import {Section} from '@astryxdesign/core/Section';
import {Stack} from '@astryxdesign/core/Stack';
import {Table, proportional} from '@astryxdesign/core/Table';
import {Text} from '@astryxdesign/core/Text';
import {MoneyText} from '../components/MoneyText';
import {applyImportPlan, readExistingData, type ImportResult} from './apply';
import {NotAnExportError, parseExport, type ParsedExport} from './parse';
import {
  buildImportPlan,
  countCreates,
  type AccountBalanceCheck,
  type ImportCounts,
  type ImportPlan,
} from './plan';
import {readWorkbookFile} from './xls';

interface Staged {
  fileName: string;
  /** Kept so the plan can be rebuilt against the database as it is at the moment of writing. */
  parsed: ParsedExport;
  plan: ImportPlan;
}

export function ImportSettings() {
  const [staged, setStaged] = useState<Staged | null>(null);
  const [isReading, setIsReading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function stageFile(picked: File | File[] | null) {
    setError(null);
    setResult(null);

    const file = Array.isArray(picked) ? picked[0] : picked;
    if (!file) {
      setStaged(null);
      return;
    }

    setIsReading(true);
    try {
      const parsed = parseExport(await readWorkbookFile(file));
      const plan = buildImportPlan(parsed, await readExistingData());
      setStaged({fileName: file.name, parsed, plan});
    } catch (caught) {
      setStaged(null);
      setError(describe(caught));
    } finally {
      setIsReading(false);
    }
  }

  async function runImport() {
    if (!staged) return;

    setIsImporting(true);
    setError(null);
    try {
      // Re-planned against the database as it is now, not as it was when the
      // file was picked. A sync cycle may have pulled some of these very rows
      // in between, and a plan built before that arrived would write them a
      // second time.
      const fresh = buildImportPlan(staged.parsed, await readExistingData());
      setResult(await applyImportPlan(fresh));
      setStaged(null);
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <Section>
      <Stack gap={3}>
        <Stack gap={1}>
          <Heading level={2}>Import from the old app</Heading>
          <Text type="supporting" as="p">
            Reads the <Text type="code">.xls</Text> the old Expense Tracker
            exports — accounts, transactions, debts and planned entries. It only
            ever adds; nothing here is overwritten or deleted, and importing the
            same file twice adds it once. You will see exactly what it would do
            before anything is written.
          </Text>
        </Stack>

        <FileInput
          label="Export file"
          value={null}
          onChange={(picked) => void stageFile(picked)}
          accept=".xls,application/vnd.ms-excel"
          mode="dropzone"
          isLoading={isReading}
          description="The .xls the old app saves. Its .pdf is a report, not data, and cannot be read."
          width="100%"
        />

        {error === null ? null : (
          <Banner status="error" title="That file could not be read" description={error} />
        )}

        {result === null ? null : <ImportedBanner result={result} />}

        {staged === null ? null : (
          <Preview
            staged={staged}
            isImporting={isImporting}
            onImport={() => void runImport()}
            onCancel={() => setStaged(null)}
          />
        )}
      </Stack>
    </Section>
  );
}

function Preview({
  staged,
  isImporting,
  onImport,
  onCancel,
}: {
  staged: Staged;
  isImporting: boolean;
  onImport: () => void;
  onCancel: () => void;
}) {
  const {plan, fileName} = staged;
  const total = countCreates(plan);
  const skipped = plan.issues.filter((issue) => issue.isSkipped);

  return (
    <Stack gap={3}>
      {plan.isEmpty ? (
        <Banner
          status="success"
          title="Everything in this file is already here"
          // The reassurance is the content: someone who re-exports and
          // re-imports needs to know that nothing was duplicated, and that
          // nothing needs doing.
          description={`${fileName} holds ${describeCounts(plan.alreadyPresent)}, all of which this device already has. Importing it again would change nothing.`}
        />
      ) : (
        <Banner
          status="info"
          title={`${fileName} would add ${describeCounts(planCounts(plan))}`}
          description={
            countTotal(plan.alreadyPresent) === 0
              ? undefined
              : `${describeCounts(plan.alreadyPresent)} in the file are already here and will be left alone.`
          }
        />
      )}

      {plan.balanceChecks.length === 0 ? null : (
        <BalanceChecks checks={plan.balanceChecks} />
      )}

      {plan.issues.length === 0 ? null : (
        <Collapsible
          defaultIsOpen={skipped.length > 0}
          trigger={
            <Text type="label">
              {skipped.length === 0
                ? `${plan.issues.length} ${plural(plan.issues.length, 'note')}`
                : `${skipped.length} ${plural(skipped.length, 'row')} will not be imported`}
            </Text>
          }
        >
          <List density="compact" hasDividers>
            {plan.issues.map((issue, index) => (
              <ListItem
                key={`${issue.sheet}-${issue.row}-${index}`}
                label={
                  issue.row === 0 ? issue.sheet : `${issue.sheet}, row ${issue.row}`
                }
                description={issue.message}
              />
            ))}
          </List>
        </Collapsible>
      )}

      <Stack direction="horizontal" gap={2} hAlign="start">
        {plan.isEmpty ? null : (
          <Button
            label={`Import ${total} ${plural(total, 'row')}`}
            variant="primary"
            onClick={onImport}
            isLoading={isImporting}
          />
        )}
        <Button label="Cancel" variant="ghost" onClick={onCancel} />
      </Stack>
    </Stack>
  );
}

interface BalanceRow extends Record<string, unknown> {
  name: string;
  currency: string;
  exportedBalance: number | null;
  projectedBalance: number;
  isCreated: boolean;
  agrees: boolean;
}

/**
 * The old app's balance beside the one this app will derive.
 *
 * A mismatch is not an error and is not blocked — an account that already
 * exists here keeps its own opening balance on purpose, so a difference is the
 * expected outcome of importing onto a device that was already in use. It is
 * shown because it is the difference a person needs to be able to explain, not
 * discover.
 */
function BalanceChecks({checks}: {checks: readonly AccountBalanceCheck[]}) {
  const rows: BalanceRow[] = checks.map((check) => ({
    ...check,
    agrees:
      check.exportedBalance !== null &&
      Math.abs(check.projectedBalance - check.exportedBalance) < 0.005,
  }));

  const disagreeing = rows.filter((row) => !row.agrees);

  return (
    <Stack gap={2}>
      <Text type="label">Balances</Text>
      <Table
        data={rows}
        idKey="name"
        density="compact"
        columns={[
          {key: 'name', header: 'Account', width: proportional(2)},
          {
            key: 'exportedBalance',
            header: 'In the old app',
            width: proportional(1),
            align: 'end',
            renderCell: (row: BalanceRow) =>
              row.exportedBalance === null ? (
                <Text type="supporting">not in the file</Text>
              ) : (
                <MoneyText amount={row.exportedBalance} currency={row.currency} />
              ),
          },
          {
            key: 'projectedBalance',
            header: 'After importing',
            width: proportional(1),
            align: 'end',
            renderCell: (row: BalanceRow) => (
              <MoneyText amount={row.projectedBalance} currency={row.currency} />
            ),
          },
        ]}
      />
      <Text type="supporting" as="p">
        {disagreeing.length === 0
          ? 'Both figures are worked out independently — one read from the file, the other derived from the transactions being imported — so their agreeing is the check that nothing was lost.'
          : `${listNames(disagreeing.map((row) => row.name))} already ${disagreeing.length === 1 ? 'exists' : 'exist'} on this device and keep${disagreeing.length === 1 ? 's' : ''} the opening balance you set. Importing will not change that, so the two figures stay apart by whatever this device recorded that the old app did not.`}
      </Text>
    </Stack>
  );
}

function ImportedBanner({result}: {result: ImportResult}) {
  if (result.total === 0) {
    return (
      <Banner
        status="success"
        title="Nothing to import"
        description="Every row in that file was already here."
      />
    );
  }

  return (
    <Banner
      status="success"
      title={`Imported ${describeCounts(result.created)}`}
      description={
        countTotal(result.alreadyPresent) === 0
          ? 'You can import the same file again later; anything already here is left alone.'
          : `${describeCounts(result.alreadyPresent)} were already here and were left alone.`
      }
    />
  );
}

function planCounts(plan: ImportPlan): ImportCounts {
  return {
    accounts: plan.create.accounts.length,
    categories: plan.create.categories.length,
    transactions: plan.create.transactions.length,
    debts: plan.create.debts.length,
    debtPayments: plan.create.debtPayments.length,
    planned: plan.create.planned.length,
  };
}

function countTotal(counts: ImportCounts): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

const NOUNS: Record<keyof ImportCounts, [string, string]> = {
  accounts: ['account', 'accounts'],
  categories: ['category', 'categories'],
  transactions: ['transaction', 'transactions'],
  debts: ['debt', 'debts'],
  debtPayments: ['settlement', 'settlements'],
  planned: ['planned entry', 'planned entries'],
};

function describeCounts(counts: ImportCounts): string {
  const parts = (Object.keys(NOUNS) as (keyof ImportCounts)[])
    .filter((key) => counts[key] > 0)
    .map((key) => {
      const [singular, plural_] = NOUNS[key];
      return `${counts[key]} ${counts[key] === 1 ? singular : plural_}`;
    });

  return parts.length === 0 ? 'nothing' : listNames(parts);
}

/** `a, b and c` — an Oxford-comma-free list, which is how a sentence reads it. */
function listNames(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}

function describe(error: unknown): string {
  if (error instanceof NotAnExportError) return error.message;
  if (error instanceof Error) {
    // SheetJS throws on anything it cannot open, and its message is about file
    // signatures rather than about the file you picked.
    return `${error.message} (the old app exports .xls; a .pdf or .xlsx cannot be read)`;
  }
  return String(error);
}
