/**
 * Every transaction, filterable, editable, and selectable in bulk.
 *
 * Covers three of the friction fixes in PROGRESS.md §6 at once: full edit
 * (fix 1 — the old app had no `updateExpense` at all), undo on delete (fix 4),
 * and bulk actions (fix 6). The scope split against Ledger is the one flagged
 * as a Phase 2 judgement call: **this** screen is every entry across every
 * account, filtered; **Ledger** is one account's register with a running
 * balance. They answer different questions and are kept separate.
 *
 * Selection comes from Astryx's own table plugin rather than a hand-rolled
 * checkbox column, so select-all, indeterminate state, and per-row accessible
 * names ("Select Coffee") behave the way the rest of the design system does.
 * It is fed the *filtered* rows, which is what makes "select all" mean "all
 * seven results" rather than silently including hidden ones.
 */
import {useMemo, useState} from 'react';
import {Badge} from '@astryxdesign/core/Badge';
import {Button} from '@astryxdesign/core/Button';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Icon} from '@astryxdesign/core/Icon';
import {MoreMenu} from '@astryxdesign/core/MoreMenu';
import {Section} from '@astryxdesign/core/Section';
import {Selector} from '@astryxdesign/core/Selector';
import {Stack} from '@astryxdesign/core/Stack';
import {
  Table,
  proportional,
  useTableSelection,
  useTableSelectionState,
  type TableColumn,
} from '@astryxdesign/core/Table';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {ArrowLeftRight, Plus, Search} from 'lucide-react';
import {
  useAccounts,
  useAllTags,
  useById,
  useCategories,
  useTransactions,
} from '../db/queries';
import {transactionsRepo} from '../db/repositories';
import type {Account, Category, Transaction, TransactionType} from '../db/types';
import {formatDate} from '../format/dates';
import {EntityIcon} from '../components/EntityIcon';
import {FormDialog} from '../components/FormDialog';
import {MoneyText} from '../components/MoneyText';
import {Page} from '../components/Page';
import {TagInput} from '../components/TagInput';
import {TransactionDialog} from '../components/TransactionDialog';
import {useUndoableDeleteMany, useUndoableDelete} from '../components/useUndoableDelete';

/**
 * The table's row type.
 *
 * A view model rather than the raw `Transaction`, because the table needs the
 * resolved category and account — a cell renderer that looked them up per row
 * would do it on every render of every row.
 */
interface Row extends Record<string, unknown> {
  id: string;
  transaction: Transaction;
  category: Category | undefined;
  account: Account | undefined;
  toAccount: Account | undefined;
  /** Everything text-searchable about the row, lowercased once. */
  haystack: string;
}

const ALL = '__all__';

export function TransactionsPage() {
  const transactions = useTransactions();
  const accounts = useAccounts();
  const categories = useCategories();
  const knownTags = useAllTags(transactions);

  const accountsById = useById(accounts);
  const categoriesById = useById(categories);

  const deleteWithUndo = useUndoableDelete();
  const deleteManyWithUndo = useUndoableDeleteMany();

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TransactionType | typeof ALL>(ALL);
  const [accountFilter, setAccountFilter] = useState<string>(ALL);
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL);
  const [tagFilter, setTagFilter] = useState<string>(ALL);

  const [editing, setEditing] = useState<Transaction | 'new' | null>(null);
  const [bulkAction, setBulkAction] = useState<'recategorize' | 'retag' | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const rows = useMemo<Row[]>(() => {
    if (!transactions) return [];
    return transactions.map((transaction) => {
      const category =
        transaction.categoryId === null
          ? undefined
          : categoriesById.get(transaction.categoryId);
      const account =
        transaction.accountId === null
          ? undefined
          : accountsById.get(transaction.accountId);
      const toAccount =
        transaction.toAccountId === null
          ? undefined
          : accountsById.get(transaction.toAccountId);

      return {
        id: transaction.id,
        transaction,
        category,
        account,
        toAccount,
        haystack: [
          transaction.description,
          category?.name ?? '',
          account?.name ?? '',
          toAccount?.name ?? '',
          transaction.tags.join(' '),
        ]
          .join(' ')
          .toLowerCase(),
      };
    });
  }, [transactions, accountsById, categoriesById]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return rows.filter((row) => {
      const {transaction} = row;
      if (needle.length > 0 && !row.haystack.includes(needle)) return false;
      if (typeFilter !== ALL && transaction.type !== typeFilter) return false;
      if (
        accountFilter !== ALL &&
        transaction.accountId !== accountFilter &&
        transaction.toAccountId !== accountFilter
      ) {
        return false;
      }
      if (categoryFilter !== ALL && transaction.categoryId !== categoryFilter) {
        return false;
      }
      if (tagFilter !== ALL && !transaction.tags.includes(tagFilter)) return false;
      return true;
    });
  }, [rows, search, typeFilter, accountFilter, categoryFilter, tagFilter]);

  // Fed the filtered rows on purpose: select-all must mean "everything I can
  // see", never "everything including what the filter is hiding".
  const {selectionConfig} = useTableSelectionState<Row>({
    data: filtered,
    idKey: 'id',
    selectedKeys,
    setSelectedKeys,
    getIsItemSelectable: () => true,
  });
  const selectionPlugin = useTableSelection<Row>({
    ...selectionConfig,
    getRowLabel: (row) => row.transaction.description || 'transaction',
  });

  const selectedIds = useMemo(
    // Intersected with what is visible, so a selection left over from a wider
    // filter cannot be acted on invisibly.
    () => filtered.filter((row) => selectedKeys.has(row.id)).map((row) => row.id),
    [filtered, selectedKeys],
  );

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
            <Text>{row.transaction.description || describeFallback(row)}</Text>
            {row.transaction.tags.length > 0 ? (
              <Stack direction="horizontal" gap={1} wrap="wrap">
                {row.transaction.tags.map((tag) => (
                  <Badge key={tag} variant="neutral" label={tag} />
                ))}
              </Stack>
            ) : null}
          </Stack>
        ),
      },
      {
        key: 'category',
        header: 'Category',
        width: proportional(2),
        renderCell: (row) =>
          row.transaction.type === 'TRANSFER' ? (
            <Text type="supporting">Transfer</Text>
          ) : row.category ? (
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
              Uncategorised
            </Text>
          ),
      },
      {
        key: 'account',
        header: 'Account',
        width: proportional(2),
        renderCell: (row) => (
          <Text type="supporting">
            {row.transaction.type === 'TRANSFER'
              ? `${row.account?.name ?? '—'} → ${row.toAccount?.name ?? '—'}`
              : (row.account?.name ?? '—')}
          </Text>
        ),
      },
      {
        key: 'amount',
        header: 'Amount',
        width: proportional(1.5),
        align: 'end',
        renderCell: (row) => (
          <MoneyText
            amount={row.transaction.amount}
            {...(row.account?.currency !== undefined && {
              currency: row.account.currency,
            })}
            // A transfer moves money the user already has, so colouring it
            // red would read as spending. Only real flows get a direction.
            tone={row.transaction.type === 'TRANSFER' ? 'neutral' : 'flow'}
            direction={row.transaction.type === 'INCOME' ? 'in' : 'out'}
            weight="medium"
          />
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
              {
                label: 'Duplicate',
                onClick: () => void duplicate(row.transaction),
              },
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
    [deleteWithUndo],
  );

  const isFiltered =
    search.trim().length > 0 ||
    typeFilter !== ALL ||
    accountFilter !== ALL ||
    categoryFilter !== ALL ||
    tagFilter !== ALL;

  function clearFilters() {
    setSearch('');
    setTypeFilter(ALL);
    setAccountFilter(ALL);
    setCategoryFilter(ALL);
    setTagFilter(ALL);
  }

  return (
    <Page
      title="Transactions"
      description="Everything you have recorded, across every account."
      actions={
        <Button
          label="New transaction"
          variant="primary"
          icon={<Icon icon={Plus} />}
          isDisabled={accounts !== undefined && accounts.length === 0}
          onClick={() => setEditing('new')}
        />
      }
    >
      <Section>
        <Stack direction="horizontal" gap={3} wrap="wrap" vAlign="end">
          <TextInput
            label="Search"
            value={search}
            onChange={setSearch}
            placeholder="Description, category, account or tag"
            startIcon={Search}
            hasClear
            width={280}
          />
          <Selector
            label="Type"
            value={typeFilter}
            onChange={(next) => setTypeFilter((next ?? ALL) as TransactionType)}
            options={[
              {value: ALL, label: 'All types'},
              {value: 'EXPENSE', label: 'Expense'},
              {value: 'INCOME', label: 'Income'},
              {value: 'TRANSFER', label: 'Transfer'},
            ]}
            width={160}
          />
          <Selector
            label="Account"
            value={accountFilter}
            onChange={(next) => setAccountFilter(next ?? ALL)}
            options={[
              {value: ALL, label: 'All accounts'},
              ...(accounts ?? []).map((account) => ({
                value: account.id,
                label: account.name,
              })),
            ]}
            width={180}
          />
          <Selector
            label="Category"
            value={categoryFilter}
            onChange={(next) => setCategoryFilter(next ?? ALL)}
            options={[
              {value: ALL, label: 'All categories'},
              ...(categories ?? []).map((category) => ({
                value: category.id,
                label: category.name,
              })),
            ]}
            hasSearch
            width={180}
          />
          {knownTags.length > 0 ? (
            <Selector
              label="Tag"
              value={tagFilter}
              onChange={(next) => setTagFilter(next ?? ALL)}
              options={[
                {value: ALL, label: 'All tags'},
                ...knownTags.map((tag) => ({value: tag, label: tag})),
              ]}
              hasSearch
              width={160}
            />
          ) : null}
          {isFiltered ? (
            <Button label="Clear filters" variant="ghost" onClick={clearFilters} />
          ) : null}
        </Stack>
      </Section>

      {selectedIds.length > 0 ? (
        <Section variant="muted">
          <Stack direction="horizontal" gap={3} vAlign="center" wrap="wrap">
            <Text weight="medium">
              {selectedIds.length} selected
            </Text>
            <Button
              label="Recategorise"
              onClick={() => setBulkAction('recategorize')}
            />
            <Button label="Add tags" onClick={() => setBulkAction('retag')} />
            <Button
              label="Delete"
              variant="destructive"
              clickAction={async () => {
                await deleteManyWithUndo(transactionsRepo, selectedIds, {
                  singular: 'transaction',
                  plural: 'transactions',
                });
                setSelectedKeys(new Set());
              }}
            />
            <Button
              label="Clear selection"
              variant="ghost"
              onClick={() => setSelectedKeys(new Set())}
            />
          </Stack>
        </Section>
      ) : null}

      {transactions === undefined ? null : filtered.length === 0 ? (
        <Section variant="muted" padding={8}>
          <EmptyState
            headingLevel={2}
            icon={<Icon icon={ArrowLeftRight} size="lg" />}
            title={isFiltered ? 'Nothing matches those filters' : 'No transactions yet'}
            description={
              isFiltered
                ? 'Try widening the search, or clear the filters to see everything.'
                : 'Record what you spend and earn. Balances, budgets and analytics all build on this.'
            }
            actions={
              isFiltered ? (
                <Button label="Clear filters" onClick={clearFilters} />
              ) : (
                <Button
                  label="New transaction"
                  variant="primary"
                  isDisabled={accounts !== undefined && accounts.length === 0}
                  onClick={() => setEditing('new')}
                />
              )
            }
          />
        </Section>
      ) : (
        <Section padding={0}>
          <Table
            data={filtered}
            columns={columns}
            idKey="id"
            density="balanced"
            hasHover
            textOverflow="truncate"
            plugins={{selection: selectionPlugin}}
          />
        </Section>
      )}

      {editing !== null && accounts !== undefined && categories !== undefined ? (
        <TransactionDialog
          transaction={editing === 'new' ? null : editing}
          accounts={accounts}
          categories={categories}
          knownTags={knownTags}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {bulkAction === 'recategorize' && categories !== undefined ? (
        <BulkRecategorize
          ids={selectedIds}
          categories={categories}
          onClose={() => setBulkAction(null)}
          onDone={() => setSelectedKeys(new Set())}
        />
      ) : null}

      {bulkAction === 'retag' ? (
        <BulkRetag
          ids={selectedIds}
          knownTags={knownTags}
          onClose={() => setBulkAction(null)}
          onDone={() => setSelectedKeys(new Set())}
        />
      ) : null}
    </Page>
  );
}

/** A row with no description still needs something to read in the list. */
function describeFallback(row: Row): string {
  if (row.transaction.type === 'TRANSFER') return 'Transfer';
  return row.category?.name ?? 'Untitled';
}

/** Copy a transaction to today, which is how most recurring-ish entries start. */
async function duplicate(transaction: Transaction): Promise<void> {
  await transactionsRepo.create({
    amount: transaction.amount,
    description: transaction.description,
    categoryId: transaction.categoryId,
    date: Date.now(),
    type: transaction.type,
    accountId: transaction.accountId,
    toAccountId: transaction.toAccountId,
    tags: [...transaction.tags],
    // The copy is a fresh entry, not another occurrence of the original's
    // planned rule — carrying `plannedId` over would make it look paid.
    plannedId: null,
    occurrenceDate: null,
  });
}

function BulkRecategorize({
  ids,
  categories,
  onClose,
  onDone,
}: {
  ids: readonly string[];
  categories: readonly Category[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [categoryId, setCategoryId] = useState<string>(categories[0]?.id ?? '');

  async function submit() {
    for (const id of ids) {
      await transactionsRepo.update(id, {categoryId});
    }
    onDone();
    return true;
  }

  return (
    <FormDialog
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Recategorise"
      subtitle={`${ids.length} ${ids.length === 1 ? 'transaction' : 'transactions'} will move to the category you pick.`}
      submitLabel="Recategorise"
      isSubmitDisabled={categoryId === ''}
      onSubmit={submit}
    >
      <Selector
        label="Category"
        value={categoryId}
        onChange={(next) => {
          if (next !== null) setCategoryId(next);
        }}
        options={categories.map((category) => ({
          value: category.id,
          label: category.name,
        }))}
        hasSearch
        isRequired
        width="100%"
      />
    </FormDialog>
  );
}

function BulkRetag({
  ids,
  knownTags,
  onClose,
  onDone,
}: {
  ids: readonly string[];
  knownTags: readonly string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [tags, setTags] = useState<string[]>([]);

  /**
   * Tags are added, not replaced. Bulk-replacing would silently destroy tags
   * the user had set one at a time, and there is no way to see what was lost
   * before confirming.
   */
  async function submit() {
    for (const id of ids) {
      const existing = await transactionsRepo.get(id);
      if (!existing) continue;
      await transactionsRepo.update(id, {
        tags: [...new Set([...existing.tags, ...tags])],
      });
    }
    onDone();
    return true;
  }

  return (
    <FormDialog
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Add tags"
      subtitle={`Added to ${ids.length} ${ids.length === 1 ? 'transaction' : 'transactions'}. Existing tags are kept.`}
      submitLabel="Add tags"
      isSubmitDisabled={tags.length === 0}
      onSubmit={submit}
    >
      <TagInput label="Tags" value={tags} onChange={setTags} suggestions={knownTags} />
    </FormDialog>
  );
}
