/**
 * Cash flow: what came in against what went out, month by month.
 *
 * **Income grows up from a zero baseline, expense grows down**, rather than
 * the two sitting side by side. That is not decoration — it is the secondary
 * encoding that makes this chart safe.
 *
 * These two series genuinely mean good and bad, so they wear the status
 * tokens (`--color-success` / `--color-error`) rather than categorical hues.
 * Green against red is the classic colour-vision failure, and it measures as
 * one: under simulated deuteranopia the light-mode pair separates by ΔE 6.3
 * (OKLab x100), inside the 6-8 floor band that is legal *only* alongside a
 * second, non-colour channel. Direction is that channel, and it is a stronger
 * one than a legend — above and below the baseline reads identically in
 * greyscale, in print, and under any form of colour blindness. The legend,
 * the 2px surface gap at the baseline, the tooltip and the table twin are all
 * still present on top of it.
 *
 * The scale is **symmetric around zero** so the two arms are directly
 * comparable. With independent extents a 9,000 income arm could render
 * shorter than a 4,000 expense arm, and the one thing this chart exists to
 * show — which side is bigger — would be a scale artefact.
 */
import {useState} from 'react';
import {Table, proportional} from '@astryxdesign/core/Table';
import {Text} from '@astryxdesign/core/Text';
import {AxisBottom, AxisLeft} from '@visx/axis';
import {GridRows} from '@visx/grid';
import {Group} from '@visx/group';
import {scaleBand, scaleLinear} from '@visx/scale';
import {BarRounded} from '@visx/shape';
import type {MonthlyFlow} from '../domain/analytics';
import {useCompactMoneyFormatter, useMoneyFormatter} from '../components/MoneyText';
import {ChartFrame, ChartTooltip, type LegendItem} from './ChartFrame';
import {CHROME, MARK, SERIES, fitBand, pointerIn} from './chrome';

const PLOT_HEIGHT = 260;
/** Roughly the width one month label needs before neighbours collide. */
const LABEL_WIDTH = 52;

const LEGEND: readonly LegendItem[] = [
  {label: 'Income (above the line)', className: SERIES.in},
  {label: 'Spending (below the line)', className: SERIES.out},
];

export interface CashFlowColumnsProps {
  flow: readonly MonthlyFlow[];
  currency: string;
  isLoading: boolean;
}

export function CashFlowColumns({flow, currency, isLoading}: CashFlowColumnsProps) {
  const money = useMoneyFormatter();
  const compact = useCompactMoneyFormatter();
  const [hovered, setHovered] = useState<{month: MonthlyFlow; x: number; y: number} | null>(
    null,
  );

  const hasActivity = flow.some((month) => month.income > 0 || month.expense > 0);

  return (
    <ChartFrame
      title="Money in, money out"
      description="Each month's income above the line and spending below it. Transfers between your own accounts are excluded."
      plotHeight={PLOT_HEIGHT}
      legend={LEGEND}
      isLoading={isLoading}
      isEmpty={!hasActivity}
      emptyMessage="No income or spending recorded in this range."
      summary={
        hasActivity
          ? `Monthly cash flow. ${flow
              .map(
                (month) =>
                  `${monthLabel(month.monthStart)}: in ${money(month.income, currency)}, out ${money(month.expense, currency)}`,
              )
              .join('. ')}.`
          : 'No cash flow to chart.'
      }
      overlay={
        hovered !== null ? (
          <ChartTooltip x={hovered.x} y={hovered.y}>
            <Text type="supporting">{monthLabel(hovered.month.monthStart, true)}</Text>
            <Text weight="semibold" hasTabularNumbers>
              {money(hovered.month.income, currency)} in
            </Text>
            <Text weight="semibold" hasTabularNumbers>
              {money(hovered.month.expense, currency)} out
            </Text>
            <Text type="supporting" hasTabularNumbers>
              Net {hovered.month.net < 0 ? '−' : '+'}
              {money(Math.abs(hovered.month.net), currency)}
            </Text>
          </ChartTooltip>
        ) : null
      }
      table={
        <Table
          data={flow.map((month) => ({
            key: String(month.monthStart),
            month: monthLabel(month.monthStart, true),
            income: money(month.income, currency),
            expense: money(month.expense, currency),
            net: `${month.net < 0 ? '−' : '+'}${money(Math.abs(month.net), currency)}`,
          }))}
          idKey="key"
          density="compact"
          columns={[
            {key: 'month', header: 'Month', width: proportional(1.5)},
            {key: 'income', header: 'In', width: proportional(1), align: 'end'},
            {key: 'expense', header: 'Out', width: proportional(1), align: 'end'},
            {key: 'net', header: 'Net', width: proportional(1), align: 'end'},
          ]}
        />
      }
    >
      {({width, height}) => {
        const extent = Math.max(
          ...flow.map((month) => Math.max(month.income, month.expense)),
          1,
        );
        const yScale = scaleLinear<number>({
          domain: [-extent, extent],
          range: [height, 0],
          nice: true,
        });
        const xScale = scaleBand<number>({
          domain: flow.map((month) => month.monthStart),
          range: [0, width],
          padding: 0.25,
        });
        const {thickness, offset} = fitBand(xScale.bandwidth());
        const zero = yScale(0);

        // Show every Nth month label rather than letting them overlap. Bands
        // are discrete, so `numTicks` cannot thin them out for us.
        const stride = Math.max(1, Math.ceil(flow.length / Math.max(1, Math.floor(width / LABEL_WIDTH))));
        const tickValues = flow
          .map((month) => month.monthStart)
          // Counted from the end so the most recent month is always labelled.
          .filter((_, index) => (flow.length - 1 - index) % stride === 0);

        return (
          <>
            <GridRows
              scale={yScale}
              width={width}
              numTicks={5}
              className={CHROME.grid}
              strokeWidth={1}
            />
            {flow.map((month) => {
              const bandLeft = xScale(month.monthStart) ?? 0;
              const barLeft = bandLeft + offset;
              // Each arm is pushed a pixel clear of zero, so the two never
              // touch: the separator between them is surface, not a stroke.
              const inTop = yScale(month.income);
              const outBottom = yScale(-month.expense);

              return (
                <Group key={month.monthStart}>
                  <rect
                    x={bandLeft}
                    y={0}
                    width={xScale.bandwidth()}
                    height={height}
                    fill="transparent"
                    onMouseMove={(event) => {
                      const point = pointerIn(event);
                      if (point !== null) {
                        setHovered({
                          month,
                          x: point.x,
                          y: point.y - MARK.maxThickness / 2,
                        });
                      }
                    }}
                    onMouseLeave={() => setHovered(null)}
                  />
                  {month.income > 0 ? (
                    <BarRounded
                      x={barLeft}
                      y={inTop}
                      width={thickness}
                      height={Math.max(0, zero - inTop - MARK.surfaceGap / 2)}
                      radius={MARK.endRadius}
                      top
                      className={SERIES.in}
                    />
                  ) : null}
                  {month.expense > 0 ? (
                    <BarRounded
                      x={barLeft}
                      y={zero + MARK.surfaceGap / 2}
                      width={thickness}
                      height={Math.max(0, outBottom - zero - MARK.surfaceGap / 2)}
                      radius={MARK.endRadius}
                      bottom
                      className={SERIES.out}
                    />
                  ) : null}
                </Group>
              );
            })}
            <AxisLeft
              scale={yScale}
              numTicks={5}
              // Both arms are magnitudes; the sign is carried by which side of
              // the line the bar is on, so a negative tick would misread as
              // "you earned minus 4,000".
              tickFormat={(value) => compact(Math.abs(Number(value)), currency)}
              axisLineClassName={CHROME.axis}
              tickClassName={CHROME.axis}
              tickLabelProps={() => ({className: CHROME.label, textAnchor: 'end', dx: -4, dy: 3})}
            />
            {/* The zero baseline is the reference both arms are read against,
                so it is drawn a step stronger than the gridlines. */}
            <line x1={0} x2={width} y1={zero} y2={zero} className={CHROME.axis} strokeWidth={1} />
            <AxisBottom
              top={height}
              scale={xScale}
              tickValues={tickValues}
              tickFormat={(value) => monthLabel(Number(value))}
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

function monthLabel(epochMs: number, isLong = false): string {
  return new Date(epochMs).toLocaleDateString(undefined, {
    month: 'short',
    // The year only earns its space in the long form and in January, where
    // it is the thing that tells two Januaries apart.
    ...(isLong || new Date(epochMs).getMonth() === 0 ? {year: 'numeric'} : {}),
  });
}
