/**
 * The dashboard.
 *
 * Carries friction fix 3 of PROGRESS.md §6: **fast entry**. The old app put
 * every entry behind a modal, so recording a 60-taka coffee meant opening a
 * dialog, filling four fields and dismissing it. The quick-add here is inline
 * and always on screen — amount, category, done — with the full dialog one
 * click away for the entries that need the other fields.
 *
 * Everything else is a read of state that already exists: balances derived
 * from the ledger, budget progress from `computeAllBudgetProgress`, and what
 * is due next from the recurrence rules. Charts arrive in Phase 4; the tiles
 * here are deliberately numeric, not graphical.
 */
import {useMemo, useState} from 'react';
import {Badge} from '@astryxdesign/core/Badge';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {EmptyState} from '@astryxdesign/core/EmptyState';
import {Grid} from '@astryxdesign/core/Grid';
import {Heading} from '@astryxdesign/core/Heading';
import {Icon} from '@astryxdesign/core/Icon';
import {Item} from '@astryxdesign/core/Item';
import {List} from '@astryxdesign/core/List';
import {ProgressBar} from '@astryxdesign/core/ProgressBar';
import {Section} from '@astryxdesign/core/Section';
import {Selector} from '@astryxdesign/core/Selector';
import {Stack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {TextInput} from '@astryxdesign/core/TextInput';
import {CalendarSync, Plus, Wallet} from 'lucide-react';
import {useNavigate} from 'react-router';
import {materializeOccurrence} from '../db/commands';
import {
  useAccountBalances,
  useAccounts,
  useAllTags,
  useBudgets,
  useById,
  useCategories,
  usePlannedExceptions,
  usePlannedRules,
  useTransactions,
} from '../db/queries';
import {transactionsRepo} from '../db/repositories';
import type {PlannedException, PlannedTransaction} from '../db/types';
import {computeTotalBalance, computeTotals} from '../domain/balances';
import {computeAllBudgetProgress} from '../domain/budgets';
import {occurrencesBetween, overdueOccurrences, type Occurrence} from '../domain/recurrence';
import {describeRelativeDay, monthRange} from '../format/dates';
import {dominantCurrency} from '../format/money';
import {AmountInput, parseAmount} from '../components/AmountInput';
import {EntityIcon} from '../components/EntityIcon';
import {MoneyText, useMoneyFormatter} from '../components/MoneyText';
import {Page} from '../components/Page';
import {TransactionDialog} from '../components/TransactionDialog';

const UPCOMING_DAYS = 30;
const UPCOMING_LIMIT = 5;

export function DashboardPage() {
  const accounts = useAccounts();
  const categories = useCategories();
  const transactions = useTransactions();
  const budgets = useBudgets();
  const rules = usePlannedRules();
  const exceptions = usePlannedExceptions();
  const knownTags = useAllTags(transactions);

  const balances = useAccountBalances(accounts, transactions);
  const accountsById = useById(accounts);
  const categoriesById = useById(categories);
  const navigate = useNavigate();
  const money = useMoneyFormatter();

  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const currency = accounts ? dominantCurrency(accounts) : 'BDT';
  const total =
    accounts && transactions ? computeTotalBalance(accounts, transactions) : 0;

  const month = monthRange(Date.now());
  const totals = useMemo(
    () => computeTotals(transactions ?? [], month.from, month.to),
    [transactions, month.from, month.to],
  );

  const budgetProgress = useMemo(() => {
    if (!budgets || !transactions) return [];
    return computeAllBudgetProgress(budgets, transactions, Date.now()).slice(0, 4);
  }, [budgets, transactions]);

  const upcoming = useMemo(
    () => collectUpcoming(rules, exceptions, transactions),
    [rules, exceptions, transactions],
  );

  const hasAccounts = accounts !== undefined && accounts.length > 0;

  return (
    <Page
      title="Dashboard"
      description="Where you stand, what is due, and somewhere to record what you just spent."
      actions={
        <Button
          label="New transaction"
          variant="primary"
          icon={<Icon icon={Plus} />}
          isDisabled={!hasAccounts}
          onClick={() => setIsDialogOpen(true)}
        />
      }
    >
      {accounts !== undefined && accounts.length === 0 ? (
        <Section variant="muted" padding={8}>
          <EmptyState
            headingLevel={2}
            icon={<Icon icon={Wallet} size="lg" />}
            title="Start with an account"
            description="Every transaction is recorded against an account, so that is the first thing to add. Balances, budgets and analytics build from there."
            actions={
              <Button
                label="Add an account"
                variant="primary"
                onClick={() => void navigate('/accounts')}
              />
            }
          />
        </Section>
      ) : (
        <>
          <Grid columns={{minWidth: 220, repeat: 'fit'}} gap={4}>
            <SummaryTile
              label="Total balance"
              amount={total}
              currency={currency}
              tone="neutral"
            />
            <SummaryTile
              label="Income this month"
              amount={totals.income}
              currency={currency}
              tone="in"
            />
            <SummaryTile
              label="Spent this month"
              amount={totals.expense}
              currency={currency}
              tone="out"
            />
            <SummaryTile
              label="Net this month"
              amount={totals.net}
              currency={currency}
              tone="signed"
            />
          </Grid>

          {hasAccounts && categories !== undefined ? (
            <QuickAdd
              accounts={accounts}
              categories={categories}
              onNeedMoreFields={() => setIsDialogOpen(true)}
            />
          ) : null}

          <Grid columns={{minWidth: 320, repeat: 'fit'}} gap={4}>
            <Card padding={0}>
              <Stack gap={3} padding={4}>
                <Stack direction="horizontal" hAlign="between" vAlign="center">
                  <Heading level={2}>Accounts</Heading>
                  <Button
                    label="All accounts"
                    variant="ghost"
                    size="sm"
                    onClick={() => void navigate('/accounts')}
                  />
                </Stack>
                <List hasDividers>
                  {(accounts ?? []).map((account) => (
                    <Item
                      key={account.id}
                      as="li"
                      density="compact"
                      label={account.name}
                      startContent={
                        <EntityIcon
                          name={account.icon}
                          color={account.colorHex}
                          size="sm"
                        />
                      }
                      endContent={
                        <MoneyText
                          amount={balances.get(account.id) ?? 0}
                          currency={account.currency}
                          weight="medium"
                        />
                      }
                    />
                  ))}
                </List>
              </Stack>
            </Card>

            <Card padding={0}>
              <Stack gap={3} padding={4}>
                <Stack direction="horizontal" hAlign="between" vAlign="center">
                  <Heading level={2}>Due next</Heading>
                  <Button
                    label="All planned"
                    variant="ghost"
                    size="sm"
                    onClick={() => void navigate('/planned')}
                  />
                </Stack>
                {upcoming.length === 0 ? (
                  <Text type="supporting" as="p">
                    Nothing scheduled in the next {UPCOMING_DAYS} days.
                  </Text>
                ) : (
                  <List hasDividers>
                    {upcoming.map((entry) => (
                      <Item
                        key={`${entry.rule.id}-${entry.occurrence.occurrenceDate}`}
                        as="li"
                        density="compact"
                        label={entry.occurrence.title}
                        startContent={<Icon icon={CalendarSync} size="sm" />}
                        description={describeRelativeDay(
                          entry.occurrence.effectiveDate,
                        )}
                        endContent={
                          <Stack direction="horizontal" gap={2} vAlign="center">
                            {entry.isOverdue ? (
                              <Badge variant="warning" label="Overdue" />
                            ) : null}
                            <MoneyText
                              amount={entry.occurrence.amount}
                              currency={
                                accountsById.get(entry.occurrence.accountId ?? '')
                                  ?.currency ?? currency
                              }
                              tone="flow"
                              direction={entry.rule.type === 'INCOME' ? 'in' : 'out'}
                            />
                            <Button
                              label="Pay"
                              size="sm"
                              clickAction={async () => {
                                await materializeOccurrence(
                                  entry.rule,
                                  entry.occurrence,
                                );
                              }}
                            />
                          </Stack>
                        }
                      />
                    ))}
                  </List>
                )}
              </Stack>
            </Card>
          </Grid>

          {budgetProgress.length > 0 ? (
            <Card padding={0}>
              <Stack gap={3} padding={4}>
                <Stack direction="horizontal" hAlign="between" vAlign="center">
                  <Heading level={2}>Budgets</Heading>
                  <Button
                    label="All budgets"
                    variant="ghost"
                    size="sm"
                    onClick={() => void navigate('/budgets')}
                  />
                </Stack>
                <Stack gap={3}>
                  {budgetProgress.map((entry) => {
                    const label =
                      entry.budget.categoryId === null
                        ? 'Overall spending'
                        : (categoriesById.get(entry.budget.categoryId)?.name ??
                          'Deleted category');

                    return (
                      <Stack key={entry.budget.id} gap={1}>
                        <Stack direction="horizontal" hAlign="between" gap={3}>
                          <Text>{label}</Text>
                          <Text type="supporting">
                            {money(entry.spent, currency)} of{' '}
                            {money(entry.limit, currency)}
                          </Text>
                        </Stack>
                        <ProgressBar
                          label={`${label} budget`}
                          isLabelHidden
                          value={Math.min(entry.spent, entry.limit)}
                          max={entry.limit > 0 ? entry.limit : 1}
                          variant={
                            entry.status === 'over'
                              ? 'error'
                              : entry.status === 'warning'
                                ? 'warning'
                                : 'accent'
                          }
                        />
                      </Stack>
                    );
                  })}
                </Stack>
              </Stack>
            </Card>
          ) : null}
        </>
      )}

      {isDialogOpen && accounts !== undefined && categories !== undefined ? (
        <TransactionDialog
          transaction={null}
          accounts={accounts}
          categories={categories}
          knownTags={knownTags}
          onClose={() => setIsDialogOpen(false)}
        />
      ) : null}
    </Page>
  );
}

function SummaryTile({
  label,
  amount,
  currency,
  tone,
}: {
  label: string;
  amount: number;
  currency: string;
  tone: 'neutral' | 'in' | 'out' | 'signed';
}) {
  return (
    <Card>
      <Stack gap={1}>
        <Text type="supporting" as="p">
          {label}
        </Text>
        <MoneyText
          amount={amount}
          currency={currency}
          type="large"
          weight="semibold"
          tone={tone === 'neutral' ? 'neutral' : tone === 'signed' ? 'signed' : 'flow'}
          {...(tone === 'in' || tone === 'out' ? {direction: tone} : {})}
        />
      </Stack>
    </Card>
  );
}

/**
 * Inline entry — amount, category, account, done.
 *
 * Deliberately not a dialog. This is the entry path for the common case (a
 * small expense, today, on the default account), and the whole complaint about
 * the old app was that this took four taps and a modal. Anything needing a
 * date, a tag, or a transfer goes through the full dialog via "More fields",
 * which is one click away rather than the only route.
 */
function QuickAdd({
  accounts,
  categories,
  onNeedMoreFields,
}: {
  accounts: readonly {id: string; name: string; currency: string}[];
  categories: readonly {id: string; name: string; kind: string; icon: string; colorHex: string}[];
  onNeedMoreFields: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [accountId, setAccountId] = useState<string>(accounts[0]?.id ?? '');

  const expenseCategories = categories.filter(
    (category) => category.kind === 'EXPENSE' || category.kind === 'BOTH',
  );

  const parsed = parseAmount(amount);
  const canSubmit = parsed !== null && accountId !== '';

  async function submit() {
    if (parsed === null || accountId === '') return;

    await transactionsRepo.create({
      amount: parsed,
      description: description.trim(),
      categoryId: categoryId === '' ? null : categoryId,
      date: Date.now(),
      type: 'EXPENSE',
      accountId,
      toAccountId: null,
      tags: [],
      plannedId: null,
      occurrenceDate: null,
    });

    // Cleared so the next entry starts empty, but the account stays — entering
    // three things in a row is almost always three things from one wallet.
    setAmount('');
    setDescription('');
    setCategoryId('');
  }

  return (
    <Card>
      <Stack gap={3}>
        <Heading level={2}>Quick add</Heading>
        <Stack direction="horizontal" gap={3} wrap="wrap" vAlign="end">
          <Stack width={180}>
            <AmountInput
              label="Amount"
              value={amount}
              onChange={setAmount}
              currency={accounts.find((a) => a.id === accountId)?.currency ?? 'BDT'}
              placeholder="60 or 4500/3"
            />
          </Stack>
          <TextInput
            label="What for"
            value={description}
            onChange={setDescription}
            isOptional
            width={220}
          />
          <Selector
            label="Category"
            value={categoryId}
            onChange={(next) => setCategoryId(next ?? '')}
            options={expenseCategories.map((category) => ({
              value: category.id,
              label: category.name,
            }))}
            hasClear
            hasSearch={expenseCategories.length > 8}
            width={200}
          />
          <Selector
            label="Account"
            value={accountId}
            onChange={(next) => setAccountId(next ?? '')}
            options={accounts.map((account) => ({
              value: account.id,
              label: account.name,
            }))}
            width={180}
          />
          <Button
            label="Add expense"
            variant="primary"
            isDisabled={!canSubmit}
            clickAction={submit}
          />
          <Button label="More fields" variant="ghost" onClick={onNeedMoreFields} />
        </Stack>
      </Stack>
    </Card>
  );
}

interface UpcomingEntry {
  rule: PlannedTransaction;
  occurrence: Occurrence;
  isOverdue: boolean;
}

/** The same overdue-then-upcoming logic the Planned screen uses, capped short. */
function collectUpcoming(
  rules: PlannedTransaction[] | undefined,
  exceptions: PlannedException[] | undefined,
  transactions: {plannedId: string | null; occurrenceDate: number | null}[] | undefined,
): UpcomingEntry[] {
  if (!rules) return [];

  const byRule = new Map<string, PlannedException[]>();
  for (const exception of exceptions ?? []) {
    const list = byRule.get(exception.plannedId);
    if (list) list.push(exception);
    else byRule.set(exception.plannedId, [exception]);
  }

  const paidByRule = new Map<string, Set<number>>();
  for (const txn of transactions ?? []) {
    if (txn.plannedId === null || txn.occurrenceDate === null) continue;
    const set = paidByRule.get(txn.plannedId);
    if (set) set.add(txn.occurrenceDate);
    else paidByRule.set(txn.plannedId, new Set([txn.occurrenceDate]));
  }

  const now = Date.now();
  const horizon = now + UPCOMING_DAYS * 86_400_000;
  const entries: UpcomingEntry[] = [];

  for (const rule of rules) {
    if (!rule.isActive) continue;
    const ruleExceptions = byRule.get(rule.id) ?? [];
    const paid = paidByRule.get(rule.id) ?? new Set<number>();

    for (const occurrence of overdueOccurrences(rule, now, paid, ruleExceptions)) {
      entries.push({rule, occurrence, isOverdue: true});
    }
    for (const occurrence of occurrencesBetween(rule, now, horizon, ruleExceptions)) {
      if (paid.has(occurrence.occurrenceDate)) continue;
      entries.push({rule, occurrence, isOverdue: false});
    }
  }

  return entries
    .sort((a, b) => a.occurrence.effectiveDate - b.occurrence.effectiveDate)
    .slice(0, UPCOMING_LIMIT);
}
