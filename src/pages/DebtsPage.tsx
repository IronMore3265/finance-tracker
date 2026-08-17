/**
 * Money owed, in both directions.
 *
 * The old app's `MainViewModel.kt` exposed `addDebtDue` and `deleteDebtDue`
 * and no update — the same gap as transactions — plus a bare
 * `Pending`/`Settled` status with no notion of a part payment. Paying half of
 * what you owed left the row saying "Pending" at the full amount.
 *
 * So the outstanding balance here is derived from `debtPayments` rather than
 * stored, for the same reason account balances are derived from the ledger:
 * a stored remaining-amount column desyncs the first time a write half-fails
 * and nothing ever notices.
 *
 * A settlement is also two facts, not one — what is owed changed, *and* money
 * moved. `settleDebt` records the payment and optionally posts the matching
 * ledger entry, linking them so deleting one finds the other.
 */
import {useMemo, useState} from 'react';
import {Badge} from '@astryxdesign/core/Badge';
import {Button} from '@astryxdesign/core/Button';
import {DateInput} from '@astryxdesign/core/DateInput';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Icon} from '@astryxdesign/core/Icon';
import {Item} from '@astryxdesign/core/Item';
import {List} from '@astryxdesign/core/List';
import {MoreMenu} from '@astryxdesign/core/MoreMenu';
import {ProgressBar} from '@astryxdesign/core/ProgressBar';
import {
  SegmentedControl,
  SegmentedControlItem,
} from '@astryxdesign/core/SegmentedControl';
import {Section} from '@astryxdesign/core/Section';
import {Selector} from '@astryxdesign/core/Selector';
import {Stack} from '@astryxdesign/core/Stack';
import {Switch} from '@astryxdesign/core/Switch';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {HandCoins, Plus} from 'lucide-react';
import {computeDebtOutstanding, settleDebt} from '../db/commands';
import {useAccounts, useDebtPayments, useDebts} from '../db/queries';
import {debtsRepo} from '../db/repositories';
import type {Account, Debt, DebtType} from '../db/types';
import {dominantCurrency} from '../format/money';
import {describeRelativeDay, formatDate, fromISODate, toISODate, type ISODate} from '../format/dates';
import {AmountInput, parseAmount} from '../components/AmountInput';
import {FormDialog} from '../components/FormDialog';
import {MoneyText, useMoneyFormatter} from '../components/MoneyText';
import {Page} from '../components/Page';
import {useUndoableDelete} from '../components/useUndoableDelete';

export function DebtsPage() {
  const debts = useDebts();
  const payments = useDebtPayments();
  const accounts = useAccounts();
  const deleteWithUndo = useUndoableDelete();

  const [editing, setEditing] = useState<Debt | 'new' | null>(null);
  const [settling, setSettling] = useState<Debt | null>(null);
  const [showCleared, setShowCleared] = useState(false);

  const outstanding = useMemo(
    () => computeDebtOutstanding(debts ?? [], payments ?? []),
    [debts, payments],
  );

  const currency = accounts ? dominantCurrency(accounts) : 'BDT';

  const visible = useMemo(
    () => (debts ?? []).filter((debt) => showCleared || !debt.isCleared),
    [debts, showCleared],
  );

  const owed = useMemo(
    () => sumOutstanding(visible, outstanding, 'DEBT'),
    [visible, outstanding],
  );
  const due = useMemo(
    () => sumOutstanding(visible, outstanding, 'DUE'),
    [visible, outstanding],
  );

  return (
    <Page
      title="Debts"
      description="What you owe and what you are owed, with part payments tracked."
      actions={
        <Button
          label="New debt"
          variant="primary"
          icon={<Icon icon={Plus} />}
          onClick={() => setEditing('new')}
        />
      }
    >
      {debts === undefined ? null : debts.length === 0 ? (
        <Section variant="muted" padding={8}>
          <EmptyState
            headingLevel={2}
            icon={<Icon icon={HandCoins} size="lg" />}
            title="Nothing owed either way"
            description="Track money you have borrowed or lent. Part payments count, and settling one can post to your ledger at the same time."
            actions={
              <Button
                label="New debt"
                variant="primary"
                onClick={() => setEditing('new')}
              />
            }
          />
        </Section>
      ) : (
        <>
          <Section>
            <Stack direction="horizontal" gap={8} wrap="wrap">
              <Stack gap={0.5}>
                <Text type="supporting" as="p">
                  You owe
                </Text>
                <MoneyText
                  amount={owed}
                  currency={currency}
                  type="large"
                  weight="semibold"
                />
              </Stack>
              <Stack gap={0.5}>
                <Text type="supporting" as="p">
                  Owed to you
                </Text>
                <MoneyText
                  amount={due}
                  currency={currency}
                  type="large"
                  weight="semibold"
                />
              </Stack>
              <Switch
                label="Show settled"
                value={showCleared}
                onChange={setShowCleared}
              />
            </Stack>
          </Section>

          <Section padding={0}>
            <List hasDividers>
              {visible.map((debt) => (
                <DebtRow
                  key={debt.id}
                  debt={debt}
                  outstanding={outstanding.get(debt.id) ?? 0}
                  currency={currency}
                  onEdit={() => setEditing(debt)}
                  onSettle={() => setSettling(debt)}
                  onDelete={() =>
                    void deleteWithUndo(debtsRepo, debt.id, {label: debt.personName})
                  }
                />
              ))}
            </List>
          </Section>
        </>
      )}

      {editing !== null ? (
        <DebtDialog
          debt={editing === 'new' ? null : editing}
          defaultCurrency={currency}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {settling !== null && accounts !== undefined ? (
        <SettleDialog
          debt={settling}
          outstanding={outstanding.get(settling.id) ?? 0}
          accounts={accounts}
          onClose={() => setSettling(null)}
        />
      ) : null}
    </Page>
  );
}

function sumOutstanding(
  debts: readonly Debt[],
  outstanding: Map<string, number>,
  type: DebtType,
): number {
  let total = 0;
  for (const debt of debts) {
    if (debt.type !== type || debt.isCleared) continue;
    total += outstanding.get(debt.id) ?? 0;
  }
  return total;
}

function DebtRow({
  debt,
  outstanding,
  currency,
  onEdit,
  onSettle,
  onDelete,
}: {
  debt: Debt;
  outstanding: number;
  currency: string;
  onEdit: () => void;
  onSettle: () => void;
  onDelete: () => void;
}) {
  // Not `formatMoney` directly: that would leave this label readable while
  // "hide amounts" was on.
  const money = useMoneyFormatter();
  const paid = debt.amount - outstanding;
  const isPartlyPaid = paid > 0 && outstanding > 0;
  const isOverdue =
    !debt.isCleared && debt.dueDate !== null && debt.dueDate < Date.now();

  return (
    <Item
      as="li"
      align="start"
      label={debt.personName}
      startContent={<Icon icon={HandCoins} />}
      description={
        <Stack gap={1}>
          <Text type="supporting">
            {[
              debt.type === 'DEBT' ? 'You owe' : 'Owed to you',
              debt.description || null,
              debt.dueDate !== null
                ? `due ${describeRelativeDay(debt.dueDate)}`
                : `since ${formatDate(debt.date)}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          {isPartlyPaid ? (
            <ProgressBar
              label={`Paid off ${debt.personName}`}
              isLabelHidden
              value={paid}
              max={debt.amount}
              hasValueLabel
              formatValueLabel={() =>
                `${formatShare(paid, debt.amount)} paid · ${money(outstanding, currency)} left`
              }
              variant="accent"
            />
          ) : null}
        </Stack>
      }
      endContent={
        <Stack direction="horizontal" gap={2} vAlign="center">
          {debt.isCleared ? <Badge variant="success" label="Settled" /> : null}
          {isOverdue ? <Badge variant="warning" label="Overdue" /> : null}
          <MoneyText
            amount={debt.isCleared ? 0 : outstanding}
            currency={currency}
            weight="medium"
          />
          {debt.isCleared ? null : (
            <Button label="Settle" size="sm" onClick={onSettle} />
          )}
          <MoreMenu
            label={`Actions for ${debt.personName}`}
            alignment="end"
            items={[
              {label: 'Edit', onClick: onEdit},
              {
                label: debt.isCleared ? 'Reopen' : 'Mark settled',
                onClick: () => {
                  void debtsRepo.update(debt.id, {isCleared: !debt.isCleared});
                },
              },
              {type: 'divider'},
              {label: 'Delete', variant: 'destructive', onClick: onDelete},
            ]}
          />
        </Stack>
      }
    />
  );
}

function formatShare(paid: number, total: number): string {
  if (total <= 0) return '0%';
  return `${Math.round((paid / total) * 100)}%`;
}

function DebtDialog({
  debt,
  defaultCurrency,
  onClose,
}: {
  debt: Debt | null;
  defaultCurrency: string;
  onClose: () => void;
}) {
  const [personName, setPersonName] = useState(debt?.personName ?? '');
  const [amount, setAmount] = useState(debt ? String(debt.amount) : '');
  const [type, setType] = useState<DebtType>(debt?.type ?? 'DEBT');
  const [description, setDescription] = useState(debt?.description ?? '');
  const [date, setDate] = useState<ISODate>(toISODate(debt?.date ?? Date.now()));
  const [dueDate, setDueDate] = useState<ISODate | ''>(
    debt?.dueDate !== null && debt?.dueDate !== undefined
      ? toISODate(debt.dueDate)
      : '',
  );
  const [hasTriedSubmit, setHasTriedSubmit] = useState(false);

  const parsedAmount = parseAmount(amount);
  const when = fromISODate(date);
  const isValid = personName.trim().length > 0 && parsedAmount !== null && when !== null;

  async function submit() {
    setHasTriedSubmit(true);
    if (parsedAmount === null || when === null) return false;

    const fields = {
      personName: personName.trim(),
      amount: parsedAmount,
      description: description.trim(),
      date: when,
      dueDate: dueDate === '' ? null : fromISODate(dueDate),
      type,
    };

    if (debt) {
      await debtsRepo.update(debt.id, fields);
    } else {
      await debtsRepo.create({...fields, isCleared: false, accountId: null});
    }
    return true;
  }

  return (
    <FormDialog
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={debt ? 'Edit debt' : 'New debt'}
      submitLabel={debt ? 'Save changes' : 'Add debt'}
      isSubmitDisabled={!isValid}
      onSubmit={submit}
    >
      <SegmentedControl
        label="Direction"
        value={type}
        onChange={(next) => setType(next as DebtType)}
        layout="fill"
      >
        <SegmentedControlItem value="DEBT" label="I owe them" />
        <SegmentedControlItem value="DUE" label="They owe me" />
      </SegmentedControl>

      <TextInput
        label="Person"
        value={personName}
        onChange={setPersonName}
        isRequired
        hasAutoFocus={debt === null}
        width="100%"
      />

      <AmountInput
        label="Amount"
        value={amount}
        onChange={setAmount}
        currency={defaultCurrency}
        isRequired
        hasValidation={hasTriedSubmit}
      />

      <TextInput
        label="What for"
        value={description}
        onChange={setDescription}
        isOptional
        width="100%"
      />

      <Stack direction="horizontal" gap={3} wrap="wrap">
        <DateInput
          label="Date"
          value={date}
          onChange={(next) => {
            if (next !== undefined) setDate(next);
          }}
          isRequired
          width="100%"
        />
        <DateInput
          label="Due by"
          {...(dueDate !== '' && {value: dueDate})}
          onChange={(next) => setDueDate(next ?? '')}
          hasClear
          isOptional
          width="100%"
        />
      </Stack>
    </FormDialog>
  );
}

/**
 * Record a payment.
 *
 * Defaults to the full outstanding amount because settling in full is the
 * common case, but the amount is editable — a part payment is the thing the
 * old app's Pending/Settled flag could not represent at all.
 */
function SettleDialog({
  debt,
  outstanding,
  accounts,
  onClose,
}: {
  debt: Debt;
  outstanding: number;
  accounts: readonly Account[];
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(String(outstanding));
  const [accountId, setAccountId] = useState<string>(accounts[0]?.id ?? '');
  const [postToLedger, setPostToLedger] = useState(accounts.length > 0);
  const [date, setDate] = useState<ISODate>(toISODate(Date.now()));
  const [hasTriedSubmit, setHasTriedSubmit] = useState(false);

  const parsedAmount = parseAmount(amount);
  const when = fromISODate(date);
  const isValid = parsedAmount !== null && when !== null;
  const willClear = parsedAmount !== null && parsedAmount >= outstanding - 0.005;

  async function submit() {
    setHasTriedSubmit(true);
    if (parsedAmount === null || when === null) return false;

    await settleDebt(debt, {
      amount: parsedAmount,
      date: when,
      accountId: postToLedger && accountId !== '' ? accountId : null,
      isClearing: willClear,
    });
    return true;
  }

  return (
    <FormDialog
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={debt.type === 'DEBT' ? `Repay ${debt.personName}` : `Collect from ${debt.personName}`}
      subtitle={
        willClear
          ? 'This settles the debt in full.'
          : 'A part payment. The rest stays outstanding.'
      }
      submitLabel="Record payment"
      isSubmitDisabled={!isValid}
      onSubmit={submit}
    >
      <AmountInput
        label="Amount"
        value={amount}
        onChange={setAmount}
        currency={accounts.find((a) => a.id === accountId)?.currency ?? 'BDT'}
        isRequired
        hasAutoFocus
        hasValidation={hasTriedSubmit}
      />

      <DateInput
        label="Date"
        value={date}
        onChange={(next) => {
          if (next !== undefined) setDate(next);
        }}
        isRequired
        width="100%"
      />

      <Switch
        label="Also record it in my ledger"
        description={
          debt.type === 'DEBT'
            ? 'Adds an expense, so the account balance reflects the money leaving.'
            : 'Adds income, so the account balance reflects the money arriving.'
        }
        value={postToLedger}
        onChange={setPostToLedger}
        isDisabled={accounts.length === 0}
        labelPosition="start"
        labelSpacing="spread"
        width="100%"
      />

      {postToLedger && accounts.length > 0 ? (
        <Selector
          label="Account"
          value={accountId}
          onChange={(next) => setAccountId(next ?? '')}
          options={accounts.map((account) => ({
            value: account.id,
            label: account.name,
          }))}
          width="100%"
        />
      ) : null}
    </FormDialog>
  );
}
