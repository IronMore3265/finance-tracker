/**
 * The create/edit form for a transaction.
 *
 * This is the fix Phase 3 exists for. The old app's `MainViewModel.kt` exposed
 * `addExpense` and `deleteExpense` and **no `updateExpense`** — so correcting a
 * typo in the most-used entity in the app meant deleting the row and typing it
 * again. The same component handles both here, because "edit" is not a
 * separate feature, it is the same form with a row already in it.
 *
 * Shared rather than page-local: the transactions list, the ledger, and the
 * dashboard's quick-add all open it, and three copies of a money form is three
 * chances for them to disagree about what a transfer means.
 */
import {useMemo, useState} from 'react';
import {DateInput} from '@astryxdesign/core/DateInput';
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@astryxdesign/core/SegmentedControl';
import {Selector} from '@astryxdesign/core/Selector';
import {Stack} from '@astryxdesign/core/Stack';
import {TextInput} from '@astryxdesign/core/TextInput';
import type {Account, Category, Transaction, TransactionType} from '../db/types';
import {transactionsRepo} from '../db/repositories';
import {toISODate, fromISODate, withDateFrom, type ISODate} from '../format/dates';
import {AmountInput, parseAmount} from './AmountInput';
import {EntityIcon} from './EntityIcon';
import {FormDialog} from './FormDialog';
import {TagInput} from './TagInput';

export interface TransactionDialogProps {
  /** null creates a new row. */
  transaction: Transaction | null;
  accounts: readonly Account[];
  categories: readonly Category[];
  /** Every tag in use, for the tag field's suggestions. */
  knownTags: readonly string[];
  /** Preselected account, for "add a transaction" from inside one ledger. */
  defaultAccountId?: string | null;
  onClose: () => void;
}

export function TransactionDialog({
  transaction,
  accounts,
  categories,
  knownTags,
  defaultAccountId,
  onClose,
}: TransactionDialogProps) {
  const [type, setType] = useState<TransactionType>(transaction?.type ?? 'EXPENSE');
  const [amount, setAmount] = useState(
    transaction ? String(transaction.amount) : '',
  );
  const [description, setDescription] = useState(transaction?.description ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(
    transaction?.categoryId ?? null,
  );
  const [accountId, setAccountId] = useState<string | null>(
    transaction?.accountId ?? defaultAccountId ?? accounts[0]?.id ?? null,
  );
  const [toAccountId, setToAccountId] = useState<string | null>(
    transaction?.toAccountId ?? null,
  );
  const [date, setDate] = useState<ISODate>(
    toISODate(transaction?.date ?? Date.now()),
  );
  const [tags, setTags] = useState<string[]>(transaction?.tags ?? []);
  const [hasTriedSubmit, setHasTriedSubmit] = useState(false);

  const isTransfer = type === 'TRANSFER';

  /**
   * Only categories that apply to the direction being recorded. A category
   * marked income-only has no business appearing while entering an expense,
   * and a transfer is not spending at all — it moves money between accounts
   * the user already owns, so categorising it would double-count it in the
   * analytics that already exclude transfers.
   */
  const categoryOptions = useMemo(() => {
    if (isTransfer) return [];
    const wanted = type === 'INCOME' ? 'INCOME' : 'EXPENSE';
    return categories
      .filter((category) => category.kind === wanted || category.kind === 'BOTH')
      .map((category) => ({value: category.id, label: category.name}));
  }, [categories, isTransfer, type]);

  const accountOptions = accounts.map((account) => ({
    value: account.id,
    label: account.name,
  }));

  const currency =
    accounts.find((account) => account.id === accountId)?.currency ??
    accounts[0]?.currency;

  const parsedAmount = parseAmount(amount);
  const isValid =
    parsedAmount !== null &&
    accountId !== null &&
    fromISODate(date) !== null &&
    (!isTransfer || (toAccountId !== null && toAccountId !== accountId));

  async function submit() {
    setHasTriedSubmit(true);
    if (parsedAmount === null || accountId === null) return false;

    const when = fromISODate(date);
    if (when === null) return false;

    const fields = {
      amount: parsedAmount,
      description: description.trim(),
      // A transfer is not spending, so it never carries a category.
      categoryId: isTransfer ? null : categoryId,
      type,
      accountId,
      toAccountId: isTransfer ? toAccountId : null,
      tags,
    };

    if (transaction) {
      await transactionsRepo.update(transaction.id, {
        ...fields,
        // Re-dating keeps the original clock time, so editing the date of a
        // 14:30 coffee does not silently move it to midnight.
        date: withDateFrom(transaction.date, date) ?? when,
      });
    } else {
      await transactionsRepo.create({
        ...fields,
        date: when,
        plannedId: null,
        occurrenceDate: null,
      });
    }
    return true;
  }

  return (
    <FormDialog
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={transaction ? 'Edit transaction' : 'New transaction'}
      submitLabel={transaction ? 'Save changes' : 'Add transaction'}
      isSubmitDisabled={!isValid}
      onSubmit={submit}
    >
      <SegmentedControl
        label="Type"
        value={type}
        onChange={(next) => setType(next as TransactionType)}
        layout="fill"
      >
        <SegmentedControlItem value="EXPENSE" label="Expense" />
        <SegmentedControlItem value="INCOME" label="Income" />
        <SegmentedControlItem value="TRANSFER" label="Transfer" />
      </SegmentedControl>

      <AmountInput
        label="Amount"
        value={amount}
        onChange={setAmount}
        {...(currency !== undefined && {currency})}
        isRequired
        hasAutoFocus={transaction === null}
        hasValidation={hasTriedSubmit}
      />

      <TextInput
        label="Description"
        value={description}
        onChange={setDescription}
        placeholder={isTransfer ? 'Moving money' : 'What was it for?'}
        isOptional
        width="100%"
      />

      <Stack direction="horizontal" gap={3} wrap="wrap">
        <Selector
          label={isTransfer ? 'From account' : 'Account'}
          value={accountId ?? ''}
          onChange={(next) => setAccountId(next)}
          options={accountOptions}
          isRequired
          width="100%"
          renderOption={(option) => renderAccountOption(accounts, option)}
        />
        {isTransfer ? (
          <Selector
            label="To account"
            value={toAccountId ?? ''}
            onChange={(next) => setToAccountId(next)}
            options={accountOptions.filter((option) => option.value !== accountId)}
            isRequired
            width="100%"
            {...(hasTriedSubmit && toAccountId === null
              ? {status: {type: 'error', message: 'Pick where the money is going'} as const}
              : {})}
            renderOption={(option) => renderAccountOption(accounts, option)}
          />
        ) : (
          <Selector
            label="Category"
            value={categoryId ?? ''}
            onChange={(next) => setCategoryId(next)}
            options={categoryOptions}
            hasClear
            hasSearch={categoryOptions.length > 8}
            isOptional
            width="100%"
            renderOption={(option) => renderCategoryOption(categories, option)}
          />
        )}
      </Stack>

      <DateInput
        label="Date"
        value={date}
        onChange={(next) => {
          if (next !== undefined) setDate(next);
        }}
        isRequired
        width="100%"
      />

      <TagInput
        label="Tags"
        value={tags}
        onChange={setTags}
        suggestions={knownTags}
        description="Cut across categories — 'reimbursable', 'trip-2026'."
      />
    </FormDialog>
  );
}

/** Option rows carry the row's own colour and glyph, so the list is scannable. */
function renderAccountOption(
  accounts: readonly Account[],
  option: {value?: string | number; label?: React.ReactNode},
) {
  const account = accounts.find((candidate) => candidate.id === option.value);
  if (!account) return option.label;

  return (
    <Stack direction="horizontal" gap={2} vAlign="center">
      <EntityIcon name={account.icon} color={account.colorHex} size="sm" />
      {account.name}
    </Stack>
  );
}

function renderCategoryOption(
  categories: readonly Category[],
  option: {value?: string | number; label?: React.ReactNode},
) {
  const category = categories.find((candidate) => candidate.id === option.value);
  if (!category) return option.label;

  return (
    <Stack direction="horizontal" gap={2} vAlign="center">
      <EntityIcon name={category.icon} color={category.colorHex} size="sm" />
      {category.name}
    </Stack>
  );
}
