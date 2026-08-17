/**
 * Recurring and scheduled transactions.
 *
 * Friction fix 2 of PROGRESS.md §6, and the one the old app could not have
 * had without a schema change. It stored a single `nextDueDate` and advanced
 * it in place, so there was no such thing as "an occurrence" — only a moving
 * pointer. You could not correct March's rent without corrupting April's, and
 * skipping a month was indistinguishable from paying it.
 *
 * Here a rule generates occurrences, and each occurrence can be:
 *   - **posted** to the ledger, tagged with which occurrence it was;
 *   - **skipped**, writing a SKIP exception rather than moving anything;
 *   - **edited for this occurrence only**, writing an OVERRIDE exception;
 *   - **edited from here on**, splitting the series so history stays intact.
 *
 * All four are already implemented and tested in domain/recurrence.ts and
 * db/commands.ts. This screen is the UI over them.
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
import {NumberInput} from '@astryxdesign/core/NumberInput';
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
import {CalendarSync, Plus} from 'lucide-react';
import {
  clearOccurrenceException,
  materializeOccurrence,
  nextDueDateFor,
  overrideOccurrence,
  skipOccurrence,
  splitSeries,
} from '../db/commands';
import {
  useAccounts,
  useById,
  useCategories,
  usePlannedExceptions,
  usePlannedRules,
  useTransactions,
} from '../db/queries';
import {plannedRepo} from '../db/repositories';
import type {
  Account,
  Category,
  IntervalType,
  PlannedException,
  PlannedTransaction,
} from '../db/types';
import {
  nextOccurrence,
  occurrencesBetween,
  overdueOccurrences,
  type Occurrence,
} from '../domain/recurrence';
import {describeRelativeDay, formatDate, fromISODate, toISODate, type ISODate} from '../format/dates';
import {AmountInput, parseAmount} from '../components/AmountInput';
import {EntityIcon} from '../components/EntityIcon';
import {FormDialog} from '../components/FormDialog';
import {MoneyText} from '../components/MoneyText';
import {Page} from '../components/Page';
import {useUndoableDelete} from '../components/useUndoableDelete';

const INTERVAL_OPTIONS = [
  {value: 'DAY', label: 'Day'},
  {value: 'WEEK', label: 'Week'},
  {value: 'MONTH', label: 'Month'},
  {value: 'YEAR', label: 'Year'},
];

/** How far ahead the upcoming list looks. Beyond this it stops being a plan. */
const HORIZON_DAYS = 90;

interface Upcoming {
  rule: PlannedTransaction;
  occurrence: Occurrence;
  isOverdue: boolean;
}

export function PlannedPage() {
  const rules = usePlannedRules();
  const exceptions = usePlannedExceptions();
  const transactions = useTransactions();
  const accounts = useAccounts();
  const categories = useCategories();
  const accountsById = useById(accounts);
  const categoriesById = useById(categories);
  const deleteWithUndo = useUndoableDelete();

  const [editingRule, setEditingRule] = useState<PlannedTransaction | 'new' | null>(
    null,
  );
  const [editingOccurrence, setEditingOccurrence] = useState<Upcoming | null>(null);

  const exceptionsByRule = useMemo(() => {
    const map = new Map<string, PlannedException[]>();
    for (const exception of exceptions ?? []) {
      const list = map.get(exception.plannedId);
      if (list) list.push(exception);
      else map.set(exception.plannedId, [exception]);
    }
    return map;
  }, [exceptions]);

  /** Occurrence dates already posted, so paid ones drop out of "overdue". */
  const paidByRule = useMemo(() => {
    const map = new Map<string, Set<number>>();
    for (const txn of transactions ?? []) {
      if (txn.plannedId === null || txn.occurrenceDate === null) continue;
      const set = map.get(txn.plannedId);
      if (set) set.add(txn.occurrenceDate);
      else map.set(txn.plannedId, new Set([txn.occurrenceDate]));
    }
    return map;
  }, [transactions]);

  const upcoming = useMemo<Upcoming[]>(() => {
    if (!rules) return [];
    const now = Date.now();
    const horizon = now + HORIZON_DAYS * 86_400_000;
    const entries: Upcoming[] = [];

    for (const rule of rules) {
      if (!rule.isActive) continue;
      const ruleExceptions = exceptionsByRule.get(rule.id) ?? [];
      const paid = paidByRule.get(rule.id) ?? new Set<number>();

      // Overdue first: an occurrence whose date has passed and which has no
      // transaction against it. No pointer is involved — paying one simply
      // removes it from this list.
      for (const occurrence of overdueOccurrences(rule, now, paid, ruleExceptions)) {
        entries.push({rule, occurrence, isOverdue: true});
      }

      for (const occurrence of occurrencesBetween(
        rule,
        now,
        horizon,
        ruleExceptions,
      )) {
        if (paid.has(occurrence.occurrenceDate)) continue;
        entries.push({rule, occurrence, isOverdue: false});
      }
    }

    return entries.sort(
      (a, b) => a.occurrence.effectiveDate - b.occurrence.effectiveDate,
    );
  }, [rules, exceptionsByRule, paidByRule]);

  return (
    <Page
      title="Planned"
      description="Rent, subscriptions and anything else on a schedule. Edit one occurrence or the whole series."
      actions={
        <Button
          label="New planned entry"
          variant="primary"
          icon={<Icon icon={Plus} />}
          isDisabled={accounts !== undefined && accounts.length === 0}
          onClick={() => setEditingRule('new')}
        />
      }
    >
      {rules === undefined ? null : rules.length === 0 ? (
        <Section variant="muted" padding={8}>
          <EmptyState
            headingLevel={2}
            icon={<Icon icon={CalendarSync} size="lg" />}
            title="Nothing planned"
            description="Set up the payments that repeat. Each one generates occurrences you can post, skip, or change individually."
            actions={
              <Button
                label="New planned entry"
                variant="primary"
                isDisabled={accounts !== undefined && accounts.length === 0}
                onClick={() => setEditingRule('new')}
              />
            }
          />
        </Section>
      ) : (
        <>
          <Section padding={0}>
            <List
              hasDividers
              header={
                <Stack paddingInline={4} paddingBlock={3}>
                  <Text weight="semibold">Next {HORIZON_DAYS} days</Text>
                </Stack>
              }
            >
              {upcoming.length === 0 ? (
                <Item
                  as="li"
                  label="Nothing due in the next 90 days"
                  description="Every active rule is either paid up or scheduled further out."
                />
              ) : (
                upcoming.map((entry) => (
                  <Item
                    key={`${entry.rule.id}-${entry.occurrence.occurrenceDate}`}
                    as="li"
                    label={entry.occurrence.title}
                    startContent={
                      <OccurrenceIcon
                        categoryId={entry.occurrence.categoryId}
                        categoriesById={categoriesById}
                      />
                    }
                    description={`${describeRelativeDay(entry.occurrence.effectiveDate)} · ${
                      accountsById.get(entry.occurrence.accountId ?? '')?.name ??
                      'No account'
                    }`}
                    endContent={
                      <Stack direction="horizontal" gap={2} vAlign="center">
                        {entry.isOverdue ? (
                          <Badge variant="warning" label="Overdue" />
                        ) : null}
                        <MoneyText
                          amount={entry.occurrence.amount}
                          currency={
                            accountsById.get(entry.occurrence.accountId ?? '')
                              ?.currency ?? 'BDT'
                          }
                          tone="flow"
                          direction={entry.rule.type === 'INCOME' ? 'in' : 'out'}
                          weight="medium"
                        />
                        <Button
                          label="Mark paid"
                          size="sm"
                          clickAction={async () => {
                            await materializeOccurrence(entry.rule, entry.occurrence);
                          }}
                        />
                        <MoreMenu
                          label={`Actions for ${entry.occurrence.title}`}
                          alignment="end"
                          items={[
                            {
                              label: 'Edit this occurrence…',
                              onClick: () => setEditingOccurrence(entry),
                            },
                            {
                              label: 'Skip this occurrence',
                              onClick: () =>
                                void skipOccurrence(
                                  entry.rule.id,
                                  entry.occurrence.occurrenceDate,
                                ),
                            },
                            {type: 'divider'},
                            {
                              label: 'Edit the whole series…',
                              onClick: () => setEditingRule(entry.rule),
                            },
                          ]}
                        />
                      </Stack>
                    }
                  />
                ))
              )}
            </List>
          </Section>

          <Section padding={0}>
            <List
              hasDividers
              header={
                <Stack paddingInline={4} paddingBlock={3}>
                  <Text weight="semibold">All rules</Text>
                </Stack>
              }
            >
              {rules.map((rule) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  exceptions={exceptionsByRule.get(rule.id) ?? []}
                  account={accountsById.get(rule.accountId ?? '')}
                  category={categoriesById.get(rule.categoryId ?? '')}
                  onEdit={() => setEditingRule(rule)}
                  onDelete={() =>
                    void deleteWithUndo(plannedRepo, rule.id, {label: rule.title})
                  }
                />
              ))}
            </List>
          </Section>
        </>
      )}

      {editingRule !== null && accounts !== undefined && categories !== undefined ? (
        <RuleDialog
          rule={editingRule === 'new' ? null : editingRule}
          accounts={accounts}
          categories={categories}
          onClose={() => setEditingRule(null)}
        />
      ) : null}

      {editingOccurrence !== null &&
      accounts !== undefined &&
      categories !== undefined ? (
        <OccurrenceDialog
          entry={editingOccurrence}
          accounts={accounts}
          categories={categories}
          onClose={() => setEditingOccurrence(null)}
        />
      ) : null}
    </Page>
  );
}

function OccurrenceIcon({
  categoryId,
  categoriesById,
}: {
  categoryId: string | null;
  categoriesById: Map<string, Category>;
}) {
  const category = categoryId === null ? undefined : categoriesById.get(categoryId);
  if (!category) return <Icon icon={CalendarSync} />;
  return <EntityIcon name={category.icon} color={category.colorHex} />;
}

function RuleRow({
  rule,
  exceptions,
  account,
  category,
  onEdit,
  onDelete,
}: {
  rule: PlannedTransaction;
  exceptions: PlannedException[];
  account: Account | undefined;
  category: Category | undefined;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const next = nextOccurrence(rule, Date.now(), exceptions);
  const skipped = exceptions.filter((e) => e.action === 'SKIP').length;
  const overridden = exceptions.filter((e) => e.action === 'OVERRIDE').length;

  return (
    <Item
      as="li"
      label={rule.title}
      startContent={
        category ? (
          <EntityIcon name={category.icon} color={category.colorHex} />
        ) : (
          <Icon icon={CalendarSync} />
        )
      }
      description={[
        describeSchedule(rule),
        account?.name,
        next ? `next ${formatDate(next.effectiveDate)}` : 'finished',
        skipped > 0 ? `${skipped} skipped` : null,
        overridden > 0 ? `${overridden} changed` : null,
      ]
        .filter(Boolean)
        .join(' · ')}
      endContent={
        <Stack direction="horizontal" gap={2} vAlign="center">
          {rule.isActive ? null : <Badge variant="neutral" label="Paused" />}
          <MoneyText
            amount={rule.amount}
            currency={account?.currency ?? 'BDT'}
            tone="flow"
            direction={rule.type === 'INCOME' ? 'in' : 'out'}
          />
          <MoreMenu
            label={`Actions for ${rule.title}`}
            alignment="end"
            items={[
              {label: 'Edit', onClick: onEdit},
              {
                label: rule.isActive ? 'Pause' : 'Resume',
                onClick: () => {
                  void plannedRepo.update(rule.id, {isActive: !rule.isActive});
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

function describeSchedule(rule: PlannedTransaction): string {
  if (rule.oneTime) return 'One time';
  const unit = rule.intervalType.toLowerCase();
  return rule.intervalN === 1
    ? `Every ${unit}`
    : `Every ${rule.intervalN} ${unit}s`;
}

/** Create or edit the *rule*, which affects every occurrence it generates. */
function RuleDialog({
  rule,
  accounts,
  categories,
  onClose,
}: {
  rule: PlannedTransaction | null;
  accounts: readonly Account[];
  categories: readonly Category[];
  onClose: () => void;
}) {
  const [title, setTitle] = useState(rule?.title ?? '');
  const [amount, setAmount] = useState(rule ? String(rule.amount) : '');
  const [type, setType] = useState<'EXPENSE' | 'INCOME'>(rule?.type ?? 'EXPENSE');
  const [accountId, setAccountId] = useState(rule?.accountId ?? accounts[0]?.id ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(rule?.categoryId ?? null);
  const [startDate, setStartDate] = useState<ISODate>(
    toISODate(rule?.startDate ?? Date.now()),
  );
  const [intervalType, setIntervalType] = useState<IntervalType>(
    rule?.intervalType ?? 'MONTH',
  );
  const [intervalN, setIntervalN] = useState(rule?.intervalN ?? 1);
  const [oneTime, setOneTime] = useState(rule?.oneTime ?? false);
  const [description, setDescription] = useState(rule?.description ?? '');
  const [hasTriedSubmit, setHasTriedSubmit] = useState(false);

  const parsedAmount = parseAmount(amount);
  const start = fromISODate(startDate);
  const isValid = title.trim().length > 0 && parsedAmount !== null && start !== null;

  const categoryOptions = categories
    .filter((category) => category.kind === type || category.kind === 'BOTH')
    .map((category) => ({value: category.id, label: category.name}));

  async function submit() {
    setHasTriedSubmit(true);
    if (parsedAmount === null || start === null || title.trim().length === 0) {
      return false;
    }

    const fields = {
      title: title.trim(),
      amount: parsedAmount,
      categoryId,
      type,
      accountId: accountId === '' ? null : accountId,
      startDate: start,
      intervalType,
      intervalN: Math.max(1, Math.trunc(intervalN)),
      oneTime,
      description: description.trim(),
    };

    if (rule) {
      // `nextDueDate` is recomputed from the rule rather than incremented.
      // Incrementing a stored pointer is exactly what made the old app's
      // recurring entries impossible to correct.
      const updated = {...rule, ...fields};
      await plannedRepo.update(rule.id, {
        ...fields,
        nextDueDate: nextDueDateFor(updated, Date.now()),
      });
    } else {
      await plannedRepo.create({
        ...fields,
        endDate: null,
        isActive: true,
        // `nextDueDateFor` takes only the scheduling fields, so it can be
        // asked about a rule that does not exist yet.
        nextDueDate: nextDueDateFor({...fields, endDate: null}, Date.now()),
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
      title={rule ? 'Edit planned entry' : 'New planned entry'}
      {...(rule && {
        subtitle:
          'Changes apply to every occurrence. To change just one, use "Edit this occurrence" on the upcoming list.',
      })}
      submitLabel={rule ? 'Save changes' : 'Add planned entry'}
      isSubmitDisabled={!isValid}
      onSubmit={submit}
    >
      <SegmentedControl
        label="Type"
        value={type}
        onChange={(next) => setType(next as 'EXPENSE' | 'INCOME')}
        layout="fill"
      >
        <SegmentedControlItem value="EXPENSE" label="Expense" />
        <SegmentedControlItem value="INCOME" label="Income" />
      </SegmentedControl>

      <TextInput
        label="Name"
        value={title}
        onChange={setTitle}
        isRequired
        hasAutoFocus={rule === null}
        placeholder="Rent, Netflix, Salary…"
        width="100%"
      />

      <AmountInput
        label="Amount"
        value={amount}
        onChange={setAmount}
        currency={accounts.find((a) => a.id === accountId)?.currency ?? 'BDT'}
        isRequired
        hasValidation={hasTriedSubmit}
      />

      <Stack direction="horizontal" gap={3} wrap="wrap">
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
        <Selector
          label="Category"
          value={categoryId ?? ''}
          onChange={(next) => setCategoryId(next)}
          options={categoryOptions}
          hasClear
          isOptional
          width="100%"
        />
      </Stack>

      <DateInput
        label="Starts"
        value={startDate}
        onChange={(next) => {
          if (next !== undefined) setStartDate(next);
        }}
        isRequired
        width="100%"
      />

      <Switch
        label="One time only"
        description="A single scheduled payment rather than a repeating one."
        value={oneTime}
        onChange={setOneTime}
        labelPosition="start"
        labelSpacing="spread"
        width="100%"
      />

      {oneTime ? null : (
        <Stack direction="horizontal" gap={3} wrap="wrap" vAlign="end">
          <NumberInput
            label="Repeat every"
            value={intervalN}
            onChange={setIntervalN}
            min={1}
            max={365}
            isIntegerOnly
            hasNumberSteppers
            width={160}
          />
          <Selector
            label="Unit"
            value={intervalType}
            onChange={(next) => {
              if (next !== null) setIntervalType(next as IntervalType);
            }}
            options={INTERVAL_OPTIONS}
            width={160}
          />
        </Stack>
      )}

      <TextInput
        label="Notes"
        value={description}
        onChange={setDescription}
        isOptional
        width="100%"
      />
    </FormDialog>
  );
}

/**
 * Edit a single occurrence — the thing the old schema could not represent.
 *
 * The scope choice at the bottom is the whole feature. "This occurrence only"
 * writes an OVERRIDE exception, leaving the rule alone. "This and all future"
 * calls `splitSeries`, which caps the current rule the millisecond before this
 * date and starts a successor, so occurrences already posted keep pointing at
 * the rule that produced them and history does not change retroactively.
 */
function OccurrenceDialog({
  entry,
  accounts,
  categories,
  onClose,
}: {
  entry: Upcoming;
  accounts: readonly Account[];
  categories: readonly Category[];
  onClose: () => void;
}) {
  const {rule, occurrence} = entry;

  const [scope, setScope] = useState<'one' | 'future'>('one');
  const [title, setTitle] = useState(occurrence.title);
  const [amount, setAmount] = useState(String(occurrence.amount));
  const [categoryId, setCategoryId] = useState<string | null>(occurrence.categoryId);
  const [accountId, setAccountId] = useState(occurrence.accountId ?? '');
  const [date, setDate] = useState<ISODate>(toISODate(occurrence.effectiveDate));
  const [hasTriedSubmit, setHasTriedSubmit] = useState(false);

  const parsedAmount = parseAmount(amount);
  const when = fromISODate(date);
  const isValid = parsedAmount !== null && when !== null && title.trim().length > 0;

  const categoryOptions = categories
    .filter((category) => category.kind === rule.type || category.kind === 'BOTH')
    .map((category) => ({value: category.id, label: category.name}));

  async function submit() {
    setHasTriedSubmit(true);
    if (parsedAmount === null || when === null) return false;

    if (scope === 'future') {
      await splitSeries(rule, occurrence.occurrenceDate, {
        title: title.trim(),
        amount: parsedAmount,
        categoryId,
        accountId: accountId === '' ? null : accountId,
      });
      return true;
    }

    await overrideOccurrence(rule.id, occurrence.occurrenceDate, {
      title: title.trim(),
      amount: parsedAmount,
      categoryId,
      accountId: accountId === '' ? null : accountId,
      // Only recorded when the date actually moved, so an untouched date does
      // not pin the occurrence to a value the rule would otherwise supply.
      ...(when !== occurrence.occurrenceDate && {occurrenceDate: when}),
    });
    return true;
  }

  return (
    <FormDialog
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`${occurrence.title} · ${formatDate(occurrence.effectiveDate)}`}
      subtitle="Change this one occurrence, or everything from it onwards."
      submitLabel="Save"
      isSubmitDisabled={!isValid}
      onSubmit={submit}
      footerStart={
        <Button
          label="Reset to the series"
          variant="ghost"
          clickAction={async () => {
            await clearOccurrenceException(rule.id, occurrence.occurrenceDate);
            onClose();
          }}
        />
      }
    >
      <SegmentedControl
        label="Applies to"
        value={scope}
        onChange={(next) => setScope(next as 'one' | 'future')}
        layout="fill"
      >
        <SegmentedControlItem value="one" label="This occurrence" />
        <SegmentedControlItem value="future" label="This and all future" />
      </SegmentedControl>

      <TextInput
        label="Name"
        value={title}
        onChange={setTitle}
        isRequired
        width="100%"
      />

      <AmountInput
        label="Amount"
        value={amount}
        onChange={setAmount}
        currency={accounts.find((a) => a.id === accountId)?.currency ?? 'BDT'}
        isRequired
        hasValidation={hasTriedSubmit}
      />

      <Stack direction="horizontal" gap={3} wrap="wrap">
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
        <Selector
          label="Category"
          value={categoryId ?? ''}
          onChange={(next) => setCategoryId(next)}
          options={categoryOptions}
          hasClear
          isOptional
          width="100%"
        />
      </Stack>

      {scope === 'one' ? (
        <DateInput
          label="Date"
          value={date}
          onChange={(next) => {
            if (next !== undefined) setDate(next);
          }}
          description="Moving this occurrence does not shift the rest of the series."
          width="100%"
        />
      ) : (
        <Text type="supporting" as="p">
          Occurrences before {formatDate(occurrence.effectiveDate)} keep their
          current values, and anything already posted to the ledger stays as it
          was recorded.
        </Text>
      )}
    </FormDialog>
  );
}
