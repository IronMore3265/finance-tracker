/**
 * Where the money went: spending per category.
 *
 * **Bars, not a donut** — a deliberate departure from the Phase 4 note in
 * PROGRESS.md, and the reason is measured rather than aesthetic. A donut
 * compares angles, which is the hardest comparison to make by eye and fails
 * exactly when two categories are close, which is the common case. Bars share
 * a baseline, so "Food is a bit more than Transport" is readable at a glance.
 * PROGRESS.md §7 carries the full note.
 *
 * **Every bar is the same colour, on purpose.** These categories have no
 * natural order, so colour has no ordering to express, and bar length already
 * carries the magnitude — colouring each bar differently would spend the one
 * free channel restating what the length says. Identity comes from the name
 * beside each bar. The category's own colour rides along as a dot next to
 * that name, so the chart still looks like the rest of the app, without the
 * chart depending on colours the user is free to set to anything at all.
 */
import {useState} from 'react';
import {Table, pixel, proportional} from '@astryxdesign/core/Table';
import {Text} from '@astryxdesign/core/Text';
import {AxisBottom} from '@visx/axis';
import {GridColumns} from '@visx/grid';
import {Group} from '@visx/group';
import {scaleBand, scaleLinear} from '@visx/scale';
import {BarRounded} from '@visx/shape';
import type {CategorySlice} from '../domain/analytics';
import {useCompactMoneyFormatter, useMoneyFormatter} from '../components/MoneyText';
import {ChartFrame, ChartTooltip} from './ChartFrame';
import {
  CATEGORY_MARGIN,
  CHROME,
  MARK,
  SERIES,
  fitBand,
  pointerIn,
  truncateLabel,
} from './chrome';

/** Tall enough that a 24px bar has air above and below it. */
const ROW_HEIGHT = 34;
/** Distance from the axis to the label column, and from a bar tip to its value. */
const LABEL_GAP = 8;
const DOT_RADIUS = 4;

export interface CategoryBarsProps {
  slices: readonly CategorySlice[];
  currency: string;
  isLoading: boolean;
}

export function CategoryBars({slices, currency, isLoading}: CategoryBarsProps) {
  const money = useMoneyFormatter();
  const compact = useCompactMoneyFormatter();
  const [hovered, setHovered] = useState<{slice: CategorySlice; x: number; y: number} | null>(
    null,
  );

  const plotHeight = Math.max(ROW_HEIGHT, slices.length * ROW_HEIGHT);
  const total = slices.reduce((sum, slice) => sum + slice.amount, 0);

  return (
    <ChartFrame
      title="Where the money went"
      description="Spending by category over the selected range."
      plotHeight={plotHeight}
      margin={CATEGORY_MARGIN}
      isLoading={isLoading}
      isEmpty={slices.length === 0}
      emptyMessage="No spending recorded in this range."
      summary={
        slices.length === 0
          ? 'No spending to chart.'
          : `Spending by category. ${slices
              .map((slice) => `${slice.label}, ${money(slice.amount, currency)}`)
              .join('. ')}.`
      }
      overlay={
        hovered !== null ? (
          <ChartTooltip x={hovered.x} y={hovered.y}>
            <Text type="supporting">{hovered.slice.label}</Text>
            <Text weight="semibold" hasTabularNumbers>
              {money(hovered.slice.amount, currency)}
            </Text>
            <Text type="supporting">
              {Math.round(hovered.slice.share * 100)}% of {money(total, currency)}
            </Text>
          </ChartTooltip>
        ) : null
      }
      table={
        <Table
          data={slices.map((slice) => ({
            key: slice.key,
            category: slice.label,
            amount: money(slice.amount, currency),
            share: `${Math.round(slice.share * 100)}%`,
          }))}
          idKey="key"
          density="compact"
          columns={[
            {key: 'category', header: 'Category', width: proportional(2)},
            {key: 'amount', header: 'Spent', width: proportional(1), align: 'end'},
            {key: 'share', header: 'Share', width: pixel(80), align: 'end'},
          ]}
        />
      }
    >
      {({width, height}) => {
        const xScale = scaleLinear<number>({
          // Anchored at zero: a bar chart whose axis starts anywhere else
          // exaggerates differences by an arbitrary factor.
          domain: [0, Math.max(...slices.map((slice) => slice.amount), 1)],
          range: [0, width],
          nice: true,
        });
        const yScale = scaleBand<string>({
          domain: slices.map((slice) => slice.key),
          range: [0, height],
          padding: 0.3,
        });
        const {thickness, offset} = fitBand(yScale.bandwidth());

        return (
          <>
            <GridColumns
              scale={xScale}
              height={height}
              numTicks={4}
              className={CHROME.grid}
              strokeWidth={1}
            />
            {slices.map((slice) => {
              const bandTop = yScale(slice.key) ?? 0;
              const barTop = bandTop + offset;
              const barWidth = Math.max(0, xScale(slice.amount));
              const rowCentre = bandTop + yScale.bandwidth() / 2;

              return (
                <Group key={slice.key}>
                  {/*
                    A transparent hit area spanning the whole row, including
                    the label column and the space past a short bar. Aiming at
                    a 6px sliver is not a hit target; this one is the full
                    band height and the full width.
                  */}
                  <rect
                    x={-CATEGORY_MARGIN.left}
                    y={bandTop}
                    width={width + CATEGORY_MARGIN.left + CATEGORY_MARGIN.right}
                    height={yScale.bandwidth()}
                    fill="transparent"
                    onMouseMove={(event) => {
                      const point = pointerIn(event);
                      if (point !== null) {
                        setHovered({slice, x: point.x, y: point.y - LABEL_GAP});
                      }
                    }}
                    onMouseLeave={() => setHovered(null)}
                  />
                  {slice.colorHex !== null ? (
                    // The category's own colour is user data, so it arrives
                    // inline — the exception documented in EntityIcon.tsx.
                    <circle
                      cx={-CATEGORY_MARGIN.left + DOT_RADIUS}
                      cy={rowCentre}
                      r={DOT_RADIUS}
                      fill={slice.colorHex}
                    />
                  ) : null}
                  <text
                    x={-CATEGORY_MARGIN.left + DOT_RADIUS * 2 + LABEL_GAP}
                    y={rowCentre}
                    dominantBaseline="middle"
                    className={CHROME.labelStrong}
                  >
                    {/* The full name stays reachable through this title, the
                        tooltip and the table, so a truncated label never
                        hides anything. */}
                    <title>{slice.label}</title>
                    {truncateLabel(slice.label)}
                  </text>
                  <BarRounded
                    x={0}
                    y={barTop}
                    width={barWidth}
                    height={thickness}
                    radius={MARK.endRadius}
                    // Rounded where the data ends, square where it starts.
                    right
                    className={slice.isOther ? SERIES.muted : SERIES.accent}
                  />
                  <text
                    x={barWidth + LABEL_GAP}
                    y={rowCentre}
                    dominantBaseline="middle"
                    className={CHROME.label}
                  >
                    {compact(slice.amount, currency)}
                  </text>
                </Group>
              );
            })}
            <AxisBottom
              top={height}
              scale={xScale}
              numTicks={4}
              tickFormat={(value) => compact(Number(value), currency)}
              axisLineClassName={CHROME.axis}
              tickClassName={CHROME.axis}
              tickLabelProps={() => ({className: CHROME.label, textAnchor: 'middle', dy: 2})}
            />
          </>
        );
      }}
    </ChartFrame>
  );
}
