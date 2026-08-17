/**
 * What changed: spending per category against the span before it.
 *
 * The question the old app could not answer at all. "You spent 12,000 on
 * food" is a fact; "you spent 4,000 more on food than last quarter" is a
 * decision, and it is the only chart here that tells you to *do* something.
 *
 * A **diverging** form, because the data's job is polarity: which side of
 * "no change" each category landed on. Bars grow right for more spending and
 * left for less, from a shared zero. As on the cash-flow chart, direction is
 * the primary channel and colour agrees with it rather than carrying it —
 * which is what makes the success/error pair safe here despite green and red
 * being the classic colour-vision collision.
 *
 * Value labels sit on the **empty** side of the baseline, mirrored across it.
 * Each row holds one bar, so the opposite half is always free: the label can
 * never be clipped by its own mark or pushed off the plot, which is what
 * happens when a long value is placed past the tip of a full-width bar.
 */
import {useState} from 'react';
import {Table, proportional} from '@astryxdesign/core/Table';
import {Text} from '@astryxdesign/core/Text';
import {Group} from '@visx/group';
import {scaleBand, scaleLinear} from '@visx/scale';
import {BarRounded} from '@visx/shape';
import type {CategoryChange, Range} from '../domain/analytics';
import {formatDate} from '../format/dates';
import {useCompactMoneyFormatter, useMoneyFormatter} from '../components/MoneyText';
import {ChartFrame, ChartTooltip, type LegendItem} from './ChartFrame';
import {
  CATEGORY_MARGIN,
  CHROME,
  MARK,
  SERIES,
  fitBand,
  pointerIn,
  truncateLabel,
} from './chrome';

const ROW_HEIGHT = 32;
const LABEL_GAP = 8;
const DOT_RADIUS = 4;

const LEGEND: readonly LegendItem[] = [
  {label: 'Spent more (bar grows right)', className: SERIES.out},
  {label: 'Spent less (bar grows left)', className: SERIES.in},
];

/** No names in the left margin would leave the diverging bars unlabelled. */
const MARGIN = {...CATEGORY_MARGIN, right: 24};

export interface CategoryChangeBarsProps {
  changes: readonly CategoryChange[];
  currency: string;
  /** The span being compared against, named in the description. */
  previous: Range | null;
  isLoading: boolean;
}

export function CategoryChangeBars({
  changes,
  currency,
  previous,
  isLoading,
}: CategoryChangeBarsProps) {
  const money = useMoneyFormatter();
  const compact = useCompactMoneyFormatter();
  const [hovered, setHovered] = useState<{change: CategoryChange; x: number; y: number} | null>(
    null,
  );

  const plotHeight = Math.max(ROW_HEIGHT, changes.length * ROW_HEIGHT);

  return (
    <ChartFrame
      title="What changed"
      description={
        previous === null
          ? 'Each category against the span before it.'
          : `Each category against ${formatDate(previous.from)} – ${formatDate(previous.to - 1)}.`
      }
      plotHeight={plotHeight}
      margin={MARGIN}
      legend={LEGEND}
      isLoading={isLoading}
      isEmpty={changes.length === 0}
      emptyMessage={
        previous === null
          ? 'Pick a fixed range to compare it against the span before it.'
          : 'Nothing moved between these two spans.'
      }
      summary={
        changes.length === 0
          ? 'No category changes to chart.'
          : `Change in spending per category. ${changes
              .map(
                (change) =>
                  `${change.label}, ${change.delta > 0 ? 'up' : 'down'} ${money(Math.abs(change.delta), currency)}`,
              )
              .join('. ')}.`
      }
      overlay={
        hovered !== null ? (
          <ChartTooltip x={hovered.x} y={hovered.y}>
            <Text type="supporting">{hovered.change.label}</Text>
            <Text weight="semibold" hasTabularNumbers>
              {hovered.change.delta > 0 ? '+' : '−'}
              {money(Math.abs(hovered.change.delta), currency)}
            </Text>
            <Text type="supporting" hasTabularNumbers>
              {money(hovered.change.previous, currency)} → {money(hovered.change.current, currency)}
            </Text>
          </ChartTooltip>
        ) : null
      }
      table={
        <Table
          data={changes.map((change) => ({
            key: change.key,
            category: change.label,
            previous: money(change.previous, currency),
            current: money(change.current, currency),
            delta: `${change.delta > 0 ? '+' : '−'}${money(Math.abs(change.delta), currency)}`,
          }))}
          idKey="key"
          density="compact"
          columns={[
            {key: 'category', header: 'Category', width: proportional(2)},
            {key: 'previous', header: 'Before', width: proportional(1), align: 'end'},
            {key: 'current', header: 'Now', width: proportional(1), align: 'end'},
            {key: 'delta', header: 'Change', width: proportional(1), align: 'end'},
          ]}
        />
      }
    >
      {({width, height}) => {
        const extent = Math.max(...changes.map((change) => Math.abs(change.delta)), 1);
        // Symmetric, so a 4,000 rise and a 4,000 fall draw the same length.
        const xScale = scaleLinear<number>({domain: [-extent, extent], range: [0, width]});
        const yScale = scaleBand<string>({
          domain: changes.map((change) => change.key),
          range: [0, height],
          padding: 0.3,
        });
        const {thickness, offset} = fitBand(yScale.bandwidth());
        const zero = xScale(0);

        return (
          <>
            {changes.map((change) => {
              const bandTop = yScale(change.key) ?? 0;
              const rowCentre = bandTop + yScale.bandwidth() / 2;
              const isUp = change.delta > 0;
              const tip = xScale(change.delta);
              // A pixel clear of the baseline on both sides, so the zero line
              // stays visible through a run of bars.
              const barLeft = isUp ? zero + MARK.surfaceGap / 2 : tip;
              const barWidth = Math.max(0, Math.abs(tip - zero) - MARK.surfaceGap / 2);

              return (
                <Group key={change.key}>
                  <rect
                    x={-MARGIN.left}
                    y={bandTop}
                    width={width + MARGIN.left + MARGIN.right}
                    height={yScale.bandwidth()}
                    fill="transparent"
                    onMouseMove={(event) => {
                      const point = pointerIn(event);
                      if (point !== null) {
                        setHovered({change, x: point.x, y: point.y - LABEL_GAP});
                      }
                    }}
                    onMouseLeave={() => setHovered(null)}
                  />
                  {change.colorHex !== null ? (
                    // User data, so an inline fill — see EntityIcon.tsx.
                    <circle
                      cx={-MARGIN.left + DOT_RADIUS}
                      cy={rowCentre}
                      r={DOT_RADIUS}
                      fill={change.colorHex}
                    />
                  ) : null}
                  <text
                    x={-MARGIN.left + DOT_RADIUS * 2 + LABEL_GAP}
                    y={rowCentre}
                    dominantBaseline="middle"
                    className={CHROME.labelStrong}
                  >
                    <title>{change.label}</title>
                    {truncateLabel(change.label)}
                  </text>
                  <BarRounded
                    x={barLeft}
                    y={bandTop + offset}
                    width={barWidth}
                    height={thickness}
                    radius={MARK.endRadius}
                    // Rounded at the data end, square against the baseline.
                    right={isUp}
                    left={!isUp}
                    className={isUp ? SERIES.out : SERIES.in}
                  />
                  {/* Mirrored into the row's empty half — see the note above. */}
                  <text
                    x={isUp ? zero - LABEL_GAP : zero + LABEL_GAP}
                    y={rowCentre}
                    dominantBaseline="middle"
                    textAnchor={isUp ? 'end' : 'start'}
                    className={CHROME.label}
                  >
                    {isUp ? '+' : '−'}
                    {compact(Math.abs(change.delta), currency)}
                  </text>
                </Group>
              );
            })}
            {/* Zero is the reference every bar is read against, so it is drawn
                a step stronger than a gridline would be. */}
            <line x1={zero} x2={zero} y1={0} y2={height} className={CHROME.axis} strokeWidth={1} />
          </>
        );
      }}
    </ChartFrame>
  );
}
