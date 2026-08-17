/**
 * One account's register, with a running balance.
 *
 * The distinction against Transactions, flagged as an open question in
 * PROGRESS.md §7 and settled here: Transactions answers "what have I spent on
 * X?" across every account; the Ledger answers "how did this account get to
 * this number?". The running balance is the whole point — it is how a balance
 * that looks wrong gets checked, line by line, against the real statement.
 *
 * That check is only meaningful because balances are derived. In the old app
 * the stored balance and the ledger could disagree with no way to tell which
 * was right. Here the column *is* the sum of the rows above it, so a
 * disagreement with the bank is a missing or duplicated transaction, and the
 * row where the two diverge is the one that is wrong.
 */
import {useMemo, useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Icon} from '@astryxdesign/core/Icon';
import {MoreMenu} from '@astryxdesign/core/MoreMenu';
import {Section} from '@astryxdesign/core/Section';
import {Selector} from '@astryxdesign/core/Selector';
import {Stack} from '@astryxdesign/core/Stack';
import {Table, proportional, type TableColumn} from '@astryxdesign/core/Table';
import {Text} from '@astryxdesign/core/Text';
import {Plus, ScrollText, Wallet} from 'lucide-react';
import {useNavigate, useParams} from 'react-router';
import {useAccounts, useAllTags, useById, useCategories, useTransactions} from '../db/queries';
import {transactionsRepo} from '../db/repositories';
import type {Account, Category, Transaction} from '../db/types';
import {effectOnAccount} from '../domain/balances';
import {roundToMinorUnit} from '../domain/mathEval';
import {formatDate} from '../format/dates';
import {EntityIcon} from '../components/EntityIcon';
import {MoneyText} from '../components/MoneyText';
import {Page} from '../components/Page';
import {TransactionDialog} from '../components/TransactionDialog';
import {useUndoableDelete} from '../components/useUndoableDelete';

interface Row extends Record<string, unknown> {
  id: string;
  transaction: Transaction;
  category: Category | undefined;
  /** Signed effect on *this* account: a transfer in is positive, out negative. */
  delta: number;
  /** Balance after this row, reading down from the opening balance. */
  balance: number;
  counterparty: string;
}

export function LedgerPage() {
  const {accountId} = useParams<{accountId?: string}>();
  const navigate = useNavigate();

  const accounts = useAccounts();
  const categories = useCategories();
  const transactions = useTransactions();
  const knownTags = useAllTags(transactions);
  const categoriesById = useById(categories);
  const accountsById = useById(accounts);
  const deleteWithUndo = useUndoableDelete();

  const [editing, setEditing] = useState<Transaction | 'new' | null>(null);

  // Falls back to the first account so the route works without a parameter,
  // which is what the nav link points at.
  const account =
    (accountId !== undefined ? accountsById.get(accountId) : undefined) ??
    accounts?.[0];

  const rows = useMemo<Row[]>(() => {
    if (!account || !transactions) return [];

    const relevant = transactions.filter(
      (txn) => txn.accountId === account.id || txn.toAccountId === account.id,
    );

    // Ascending to accumulate, so each row's balance is the sum of everything
    // at or before it. Reversed afterwards for display — a register reads
    // newest-first, but a running balance only means anything oldest-first.
    const ascending = [...relevant].sort((a, b) =>
      a.date !== b.date ? a.date - b.date : a.createdAt - b.createdAt,
    );

    let running = account.openingBalance;
    const built = ascending.map((transaction) => {
      const delta = effectOnAccount(transaction, account.id);
      running = roundToMinorUnit(running + delta);

      return {
        id: transaction.id,
        transaction,
        category:
          transaction.categoryId === null
            ? undefined
            : categoriesById.get(transaction.categoryId),
        delta,
        balance: running,
        counterparty: describeCounterparty(transaction, account, accountsById),
      };
    });

    return built.reverse();
  }, [account, transactions, categoriesById, accountsById]);

  const columns = useMemo<TableColumn<Row>[]>(
    () => [
      {
        key: 'date',
        header: 'Date',
        width: proportional(1),
        renderCell: (row) => (
          <Text type="supporting">{formatDate(row.transaction.date)}</Text>
        ),
      },
      {
        key: 'description',
        header: 'Description',
        width: proportional(3),
        renderCell: (row) => (
          <Stack gap={0.5}>
            <Text>{row.transaction.description || row.counterparty}</Text>
            <Text type="supporting">{row.counterparty}</Text>
          </Stack>
        ),
      },
      {
        key: 'category',
        header: 'Category',
        width: proportional(1.5),
        renderCell: (row) =>
          row.category ? (
            <Stack direction="horizontal" gap={2} vAlign="center">
              <EntityIcon
                name={row.category.icon}
                color={row.category.colorHex}
                size="sm"
              />
              <Text>{row.category.name}</Text>
            </Stack>
          ) : (
            <Text type="supporting" color="placeholder">
              —
            </Text>
          ),
      },
      {
        key: 'delta',
        header: 'Change',
        width: proportional(1.5),
        align: 'end',
        renderCell: (row) => (
          <MoneyText
            amount={row.delta}
            currency={account?.currency ?? 'BDT'}
            tone="signed"
            weight="medium"
          />
        ),
      },
      {
        key: 'balance',
        header: 'Balance',
        width: proportional(1.5),
        align: 'end',
        renderCell: (row) => (
          <MoneyText amount={row.balance} currency={account?.currency ?? 'BDT'} />
        ),
      },
      {
        key: 'actions',
        header: '',
        width: proportional(0.5),
        align: 'end',
        renderCell: (row) => (
          <MoreMenu
            label={`Actions for ${row.transaction.description || 'transaction'}`}
            alignment="end"
            items={[
              {label: 'Edit', onClick: () => setEditing(row.transaction)},
              {type: 'divider'},
              {
                label: 'Delete',
                variant: 'destructive',
                onClick: () =>
                  void deleteWithUndo(transactionsRepo, row.transaction.id, {
                    label: row.transaction.description || 'Transaction',
                  }),
              },
            ]}
          />
        ),
      },
    ],
    [account, deleteWithUndo],
  );

  if (accounts !== undefined && accounts.length === 0) {
    return (
      <Page title="Ledger" description="One account's register, line by line.">
        <Section variant="muted" padding={8}>
          <EmptyState
            headingLevel={2}
            icon={<Icon icon={Wallet} size="lg" />}
            title="No accounts to show"
            description="A ledger belongs to an account. Add one first and its register appears here."
            actions={
              <Button
                label="Go to accounts"
                variant="primary"
                onClick={() => void navigate('/accounts')}
              />
            }
          />
        </Section>
      </Page>
    );
  }

  return (
    <Page
      title="Ledger"
      description="One account's register, with the running balance each entry produced."
      actions={
        <Button
          label="New transaction"
          variant="primary"
          icon={<Icon icon={Plus} />}
          isDisabled={account === undefined}
          onClick={() => setEditing('new')}
        />
      }
    >
      <Section>
        <Stack direction="horizontal" gap={4} vAlign="end" wrap="wrap">
          <Selector
            label="Account"
            value={account?.id ?? ''}
            onChange={(next) => {
              // Navigating rather than holding local state keeps the ledger
              // linkable and puts it in the back-button history.
              if (next !== null) void navigate(`/ledger/${next}`);
            }}
            options={(accounts ?? []).map((candidate) => ({
              value: candidate.id,
              label: candidate.name,
            }))}
            width={260}
          />
          {account ? (
            <Stack gap={0.5}>
              <Text type="supporting" as="p">
                Current balance
              </Text>
              <MoneyText
                amount={rows[0]?.balance ?? account.openingBalance}
                currency={account.currency}
                type="large"
                weight="semibold"
              />
            </Stack>
          ) : null}
        </Stack>
      </Section>

      {account === undefined || transactions === undefined ? null : rows.length === 0 ? (
        <Section variant="muted" padding={8}>
          <EmptyState
            headingLevel={2}
            icon={<Icon icon={ScrollText} size="lg" />}
            title={`Nothing recorded against ${account.name} yet`}
            description={`The register starts from its opening balance. Every entry from here shows the balance it produced.`}
            actions={
              <Button
                label="New transaction"
                variant="primary"
                onClick={() => setEditing('new')}
              />
            }
          />
        </Section>
      ) : (
        <Section padding={0}>
          <Table
            data={rows}
            columns={columns}
            idKey="id"
            density="balanced"
            hasHover
            textOverflow="truncate"
          />
        </Section>
      )}

      {editing !== null && accounts !== undefined && categories !== undefined ? (
        <TransactionDialog
          transaction={editing === 'new' ? null : editing}
          accounts={accounts}
          categories={categories}
          knownTags={knownTags}
          defaultAccountId={account?.id ?? null}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Page>
  );
}

/**
 * What the money moved to or from, phrased from this account's point of view.
 *
 * A transfer is one row in two ledgers with opposite signs, so the same
 * transaction has to read "To Brac Bank" in one and "From Cash" in the other.
 */
function describeCounterparty(
  transaction: Transaction,
  account: Account,
  accountsById: Map<string, Account>,
): string {
  if (transaction.type !== 'TRANSFER') {
    return transaction.type === 'INCOME' ? 'Income' : 'Expense';
  }

  const isOutgoing = transaction.accountId === account.id;
  const otherId = isOutgoing ? transaction.toAccountId : transaction.accountId;
  const other = otherId === null ? undefined : accountsById.get(otherId);

  return isOutgoing
    ? `To ${other?.name ?? 'another account'}`
    : `From ${other?.name ?? 'another account'}`;
}
