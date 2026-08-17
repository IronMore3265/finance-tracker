/**
 * Per-category budgets.
 *
 * The old app had exactly one global budget with one period — you could cap
 * total spending, but not say "≤ 6000 on food this month", which is the
 * question people actually ask. Categories being a real table is what makes
 * the per-category version possible at all.
 *
 * The period is anchored to the budget's own start date rather than the
 * calendar, which is the feature the old README called out as most valuable
 * and never shipped: a budget starting on the 15th runs 15th to 15th, so
 * "remaining" tracks a real pay cycle instead of resetting mid-month.
 * `resolvePeriod` handles the awkward cases (a monthly budget anchored on the
 * 31st clamps in short months without the series drifting backwards).
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
import {Section} from '@astryxdesign/core/Section';
import {Selector} from '@astryxdesign/core/Selector';
import {Stack} from '@astryxdesign/core/Stack';
import {Switch} from '@astryxdesign/core/Switch';
import {Text} from '@astryxdesign/core/Text';
import {Plus, Target} from 'lucide-react';
import {
  useAccounts,
  useBudgets,
  useById,
  useCategories,
  useTransactions,
} from '../db/queries';
import {budgetsRepo} from '../db/repositories';
import type {Budget, BudgetPeriod, Category} from '../db/types';
import {computeAllBudgetProgress, type BudgetProgress} from '../domain/budgets';
import {formatDate, fromISODate, toISODate, type ISODate} from '../format/dates';
import {dominantCurrency} from '../format/money';
import {AmountInput, parseAmount} from '../components/AmountInput';
import {EntityIcon} from '../components/EntityIcon';
import {FormDialog} from '../components/FormDialog';
import {MoneyText, useMoneyFormatter} from '../components/MoneyText';
import {Page} from '../components/Page';
import {useUndoableDelete} from '../components/useUndoableDelete';

const PERIOD_OPTIONS = [
  {value: 'WEEK', label: 'Weekly'},
  {value: 'MONTH', label: 'Monthly'},
  {value: 'YEAR', label: 'Yearly'},
  {value: 'CUSTOM', label: 'Custom range'},
];

const STATUS_VARIANT = {
  ok: 'accent',
  warning: 'warning',
  over: 'error',
} as const;

export function BudgetsPage() {
  const budgets = useBudgets();
  const transactions = useTransactions();
  const categories = useCategories();
  const accounts = useAccounts();
  const categoriesById = useById(categories);
  const deleteWithUndo = useUndoableDelete();

  const [editing, setEditing] = useState<Budget | 'new' | null>(null);

  const currency = accounts ? dominantCurrency(accounts) : 'BDT';

  // Worst first, so a budget that is already over is the first thing read.
  const progress = useMemo<BudgetProgress[]>(() => {
    if (!budgets || !transactions) return [];
    return computeAllBudgetProgress(budgets, transactions, Date.now());
  }, [budgets, transactions]);

  const inactive = useMemo(
    () => (budgets ?? []).filter((budget) => !budget.isActive),
    [budgets],
  );

  return (
    <Page
      title="Budgets"
      description="Caps per category, on a period anchored to your pay cycle rather than the calendar."
      actions={
        <Button
          label="New budget"
          variant="primary"
          icon={<Icon icon={Plus} />}
          onClick={() => setEditing('new')}
        />
      }
    >
      {budgets === undefined ? null : budgets.length === 0 ? (
        <Section variant="muted" padding={8}>
          <EmptyState
            headingLevel={2}
            icon={<Icon icon={Target} size="lg" />}
            title="No budgets set"
            description="Cap a category, or your overall spending. A budget starting on the 15th runs 15th to 15th, so what is left tracks your actual pay cycle."
            actions={
              <Button
                label="New budget"
                variant="primary"
                onClick={() => setEditing('new')}
              />
            }
          />
        </Section>
      ) : (
        <Section padding={0}>
          <List hasDividers>
            {progress.map((entry) => (
              <BudgetRow
                key={entry.budget.id}
                progress={entry}
                category={
                  entry.budget.categoryId === null
                    ? undefined
                    : categoriesById.get(entry.budget.categoryId)
                }
                currency={currency}
                onEdit={() => setEditing(entry.budget)}
                onDelete={() =>
                  void deleteWithUndo(budgetsRepo, entry.budget.id, {
                    label: budgetLabel(entry.budget, categoriesById),
                  })
                }
              />
            ))}
            {inactive.map((budget) => (
              <Item
                key={budget.id}
                as="li"
                label={budgetLabel(budget, categoriesById)}
                startContent={<Icon icon={Target} />}
                description="Paused"
                endContent={
                  <Stack direction="horizontal" gap={2} vAlign="center">
                    <Badge variant="neutral" label="Paused" />
                    <MoreMenu
                      label={`Actions for ${budgetLabel(budget, categoriesById)}`}
                      alignment="end"
                      items={[
                        {label: 'Edit', onClick: () => setEditing(budget)},
                        {
                          label: 'Resume',
                          onClick: () => {
                            void budgetsRepo.update(budget.id, {isActive: true});
                          },
                        },
                        {type: 'divider'},
                        {
                          label: 'Delete',
                          variant: 'destructive',
                          onClick: () =>
                            void deleteWithUndo(budgetsRepo, budget.id, {
                              label: budgetLabel(budget, categoriesById),
                            }),
                        },
                      ]}
                    />
                  </Stack>
                }
              />
            ))}
          </List>
        </Section>
      )}

      {editing !== null && categories !== undefined ? (
        <BudgetDialog
          budget={editing === 'new' ? null : editing}
          categories={categories}
          currency={currency}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Page>
  );
}

function budgetLabel(budget: Budget, categoriesById: Map<string, Category>): string {
  if (budget.categoryId === null) return 'Overall spending';
  return categoriesById.get(budget.categoryId)?.name ?? 'Deleted category';
}

function BudgetRow({
  progress,
  category,
  currency,
  onEdit,
  onDelete,
}: {
  progress: BudgetProgress;
  category: Category | undefined;
  currency: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const {budget, spent, limit, remaining, status, period} = progress;
  const label = category?.name ?? 'Overall spending';
  // Routed through the hook so "hide amounts" covers this label too.
  const money = useMoneyFormatter();

  return (
    <Item
      as="li"
      align="start"
      label={label}
      startContent={
        category ? (
          <EntityIcon name={category.icon} color={category.colorHex} />
        ) : (
          <Icon icon={Target} />
        )
      }
      description={
        <Stack gap={1}>
          <Text type="supporting">
            {describePeriod(budget, period)} · {money(spent, currency)} of{' '}
            {money(limit, currency)}
          </Text>
          <ProgressBar
            label={`${label} budget`}
            isLabelHidden
            // `spent` rather than the clamped fraction, so a budget at 130%
            // still fills the bar and the number below tells the truth.
            value={Math.min(spent, limit)}
            max={limit > 0 ? limit : 1}
            variant={STATUS_VARIANT[status]}
          />
        </Stack>
      }
      endContent={
        <Stack direction="horizontal" gap={2} vAlign="center">
          {status === 'over' ? (
            <Badge variant="error" label="Over" />
          ) : status === 'warning' ? (
            <Badge variant="warning" label="Close" />
          ) : null}
          <Stack gap={0} hAlign="end">
            <MoneyText
              amount={Math.abs(remaining)}
              currency={currency}
              weight="medium"
            />
            <Text type="supporting">{remaining < 0 ? 'over' : 'left'}</Text>
          </Stack>
          <MoreMenu
            label={`Actions for ${label} budget`}
            alignment="end"
            items={[
              {label: 'Edit', onClick: onEdit},
              {
                label: 'Pause',
                onClick: () => {
                  void budgetsRepo.update(budget.id, {isActive: false});
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

function describePeriod(budget: Budget, period: {from: number; to: number}): string {
  if (budget.period === 'CUSTOM') {
    return budget.endDate === null
      ? `From ${formatDate(budget.startDate)}`
      : `${formatDate(budget.startDate)} – ${formatDate(budget.endDate)}`;
  }
  // The resolved period, not the label: a monthly budget anchored on the 15th
  // says "15 Aug – 15 Sep", which is the thing that makes anchoring visible.
  return `${formatDate(period.from)} – ${formatDate(period.to)}`;
}

function BudgetDialog({
  budget,
  categories,
  currency,
  onClose,
}: {
  budget: Budget | null;
  categories: readonly Category[];
  currency: string;
  onClose: () => void;
}) {
  const [categoryId, setCategoryId] = useState<string | null>(
    budget?.categoryId ?? null,
  );
  const [amount, setAmount] = useState(budget ? String(budget.amount) : '');
  const [period, setPeriod] = useState<BudgetPeriod>(budget?.period ?? 'MONTH');
  const [startDate, setStartDate] = useState<ISODate>(
    toISODate(budget?.startDate ?? Date.now()),
  );
  const [endDate, setEndDate] = useState<ISODate | ''>(
    budget?.endDate != null ? toISODate(budget.endDate) : '',
  );
  const [isActive, setIsActive] = useState(budget?.isActive ?? true);
  const [hasTriedSubmit, setHasTriedSubmit] = useState(false);

  const parsedAmount = parseAmount(amount);
  const start = fromISODate(startDate);
  const isValid =
    parsedAmount !== null &&
    start !== null &&
    (period !== 'CUSTOM' || fromISODate(endDate) !== null);

  async function submit() {
    setHasTriedSubmit(true);
    if (parsedAmount === null || start === null) return false;

    const fields = {
      categoryId,
      amount: parsedAmount,
      period,
      startDate: start,
      // Only a custom range has a meaningful end; the repeating periods derive
      // theirs from the anchor.
      endDate: period === 'CUSTOM' ? fromISODate(endDate) : null,
      isActive,
    };

    if (budget) {
      await budgetsRepo.update(budget.id, fields);
    } else {
      await budgetsRepo.create(fields);
    }
    return true;
  }

  return (
    <FormDialog
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={budget ? 'Edit budget' : 'New budget'}
      submitLabel={budget ? 'Save changes' : 'Add budget'}
      isSubmitDisabled={!isValid}
      onSubmit={submit}
    >
      <Selector
        label="Applies to"
        value={categoryId ?? ''}
        onChange={(next) => setCategoryId(next === '' ? null : next)}
        options={[
          {value: '', label: 'All spending'},
          ...categories
            .filter((category) => category.kind !== 'INCOME')
            .map((category) => ({value: category.id, label: category.name})),
        ]}
        hasSearch
        width="100%"
      />

      <AmountInput
        label="Limit"
        value={amount}
        onChange={setAmount}
        currency={currency}
        isRequired
        hasValidation={hasTriedSubmit}
      />

      <Selector
        label="Period"
        value={period}
        onChange={(next) => {
          if (next !== null) setPeriod(next as BudgetPeriod);
        }}
        options={PERIOD_OPTIONS}
        width="100%"
      />

      <DateInput
        label={period === 'CUSTOM' ? 'From' : 'Anchored to'}
        value={startDate}
        onChange={(next) => {
          if (next !== undefined) setStartDate(next);
        }}
        {...(period !== 'CUSTOM' && {
          description:
            'Periods count forward from this date, so a budget starting on the 15th runs 15th to 15th.',
        })}
        isRequired
        width="100%"
      />

      {period === 'CUSTOM' ? (
        <DateInput
          label="To"
          {...(endDate !== '' && {value: endDate})}
          onChange={(next) => setEndDate(next ?? '')}
          isRequired
          width="100%"
        />
      ) : null}

      <Switch
        label="Active"
        description="Paused budgets keep their settings but stop being measured."
        value={isActive}
        onChange={setIsActive}
        labelPosition="start"
        labelSpacing="spread"
        width="100%"
      />
    </FormDialog>
  );
}
