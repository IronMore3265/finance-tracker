/**
 * Analytics.
 *
 * Replaces the old app's single 7-day line chart — which could only ever
 * answer "did I spend anything this week?" — with four charts that each
 * answer a different question, over a span the reader chooses:
 *
 *   Where the money went   · which categories take the money
 *   Money in, money out    · whether the month ended up or down
 *   What changed           · which categories moved, and by how much
 *   Net worth              · whether the total is going anywhere
 *
 * **One filter row, above everything.** The range control sits in the page
 * header and scopes every tile and every chart below it, so the numbers on
 * the screen always describe the same span. Per-chart ranges are how a
 * dashboard ends up with four figures that quietly disagree.
 *
 * All aggregation lives in `domain/analytics.ts`; this file picks a range,
 * hands the resulting series to the charts, and owns nothing else.
 */
import {useMemo, useState} from 'react';
import {Card} from '@astryxdesign/core/Card';
import {Grid} from '@astryxdesign/core/Grid';
import {SegmentedControl, SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {Stack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {useAccounts, useCategories, useTransactions} from '../db/queries';
import {
  RANGE_PRESETS,
  categoryChanges,
  monthlyFlow,
  netWorthSeries,
  resolveRange,
  spendByCategory,
  summarise,
  type RangePreset,
} from '../domain/analytics';
import {dominantCurrency} from '../format/money';
import {CashFlowColumns} from '../charts/CashFlowColumns';
import {CategoryBars} from '../charts/CategoryBars';
import {CategoryChangeBars} from '../charts/CategoryChangeBars';
import {NetWorthArea} from '../charts/NetWorthArea';
import {MoneyText} from '../components/MoneyText';
import {Page} from '../components/Page';

/**
 * Six months by default: long enough that the cash-flow chart has a shape to
 * read, short enough that a category's recent behaviour is not averaged away
 * by a year of history.
 */
const DEFAULT_PRESET: RangePreset = '6M';

export function AnalyticsPage() {
  const transactions = useTransactions();
  const categories = useCategories();
  const accounts = useAccounts();

  const [preset, setPreset] = useState<RangePreset>(DEFAULT_PRESET);

  const isLoading =
    transactions === undefined || categories === undefined || accounts === undefined;
  const currency = accounts ? dominantCurrency(accounts) : 'BDT';

  // Every aggregation is derived from one `Date.now()` reading, so the charts
  // cannot disagree about where "now" is — reading the clock per aggregation
  // would let a recompute that straddles midnight resolve two different
  // ranges into the same screen.
  const series = useMemo(() => {
    const rows = transactions ?? [];
    const {current, previous} = resolveRange(preset, rows, Date.now());
    const flow = monthlyFlow(rows, current);

    return {
      range: current,
      previous,
      flow,
      summary: summarise(flow),
      slices: spendByCategory(rows, categories ?? [], current),
      changes:
        previous === null ? [] : categoryChanges(rows, categories ?? [], current, previous),
      netWorth: netWorthSeries(accounts ?? [], rows, current),
    };
  }, [transactions, categories, accounts, preset]);

  return (
    <Page
      title="Analytics"
      description="Where the money went, over whatever span you ask for."
      actions={
        <SegmentedControl
          label="Date range"
          value={preset}
          onChange={(next) => setPreset(next as RangePreset)}
          size="sm"
        >
          {RANGE_PRESETS.map((option) => (
            <SegmentedControlItem
              key={option.value}
              value={option.value}
              label={option.label}
            />
          ))}
        </SegmentedControl>
      }
    >
      <Grid columns={{minWidth: 200, repeat: 'fit'}} gap={4}>
        <StatTile
          label="Income"
          amount={series.summary.income}
          currency={currency}
          tone="in"
        />
        <StatTile
          label="Spent"
          amount={series.summary.expense}
          currency={currency}
          tone="out"
        />
        <StatTile
          label="Net"
          amount={series.summary.net}
          currency={currency}
          tone="signed"
          detail={
            series.summary.savingsRate === null
              ? 'No income recorded'
              : `${Math.round(series.summary.savingsRate * 100)}% of income kept`
          }
        />
        <StatTile
          label="Average month"
          amount={series.summary.averageMonthlyExpense}
          currency={currency}
          tone="neutral"
          detail={`Spending, across ${series.flow.length} ${series.flow.length === 1 ? 'month' : 'months'}`}
        />
      </Grid>

      <CategoryBars slices={series.slices} currency={currency} isLoading={isLoading} />

      <CashFlowColumns flow={series.flow} currency={currency} isLoading={isLoading} />

      <CategoryChangeBars
        changes={series.changes}
        currency={currency}
        previous={series.previous}
        isLoading={isLoading}
      />

      <NetWorthArea
        points={series.netWorth}
        range={series.range}
        currency={currency}
        isLoading={isLoading}
      />
    </Page>
  );
}

/**
 * A headline number.
 *
 * Deliberately a tile and not a one-bar chart: a single current value is a
 * number, and drawing one bar for it spends a chart's worth of space saying
 * less than the digits do.
 */
function StatTile({
  label,
  amount,
  currency,
  tone,
  detail,
}: {
  label: string;
  amount: number;
  currency: string;
  tone: 'neutral' | 'in' | 'out' | 'signed';
  detail?: string;
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
        {detail !== undefined ? <Text type="supporting">{detail}</Text> : null}
      </Stack>
    </Card>
  );
}
