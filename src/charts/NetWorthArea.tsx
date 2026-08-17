/**
 * Net worth over time.
 *
 * One series, so no legend — the title already says what is plotted, and a
 * legend box with a single swatch restates it for the price of a row.
 *
 * The y-axis **always includes zero**, even when the balance never goes near
 * it. A trend line auto-scaled to its own range turns a 2% wobble into a
 * cliff, which is the most common way a finance chart lies to the person
 * reading it. Including zero costs some vertical resolution and is worth it.
 *
 * The reader aims at a *date*, never at a 2px line: an invisible overlay
 * spans the whole plot and snaps to the nearest sample, so the crosshair
 * follows the pointer anywhere in the chart and the readout sits on the
 * snapped point rather than under the cursor. Values are cumulative, so a
 * sampled point is the true balance on its date even when the days between
 * were skipped (see `netWorthSeries`).
 */
import {useMemo, useState} from 'react';
import {Table, proportional} from '@astryxdesign/core/Table';
import {Text} from '@astryxdesign/core/Text';
import {AxisBottom, AxisLeft} from '@visx/axis';
import {GridRows} from '@visx/grid';
import {scaleLinear} from '@visx/scale';
import {AreaClosed, LinePath} from '@visx/shape';
import {curveMonotoneX} from '@visx/curve';
import {monthStarts, type NetWorthPoint, type Range} from '../domain/analytics';
import {formatDate} from '../format/dates';
import {useCompactMoneyFormatter, useMoneyFormatter} from '../components/MoneyText';
import {ChartFrame, ChartTooltip} from './ChartFrame';
import {CHROME, DEFAULT_MARGIN, MARK, SERIES, pointerIn} from './chrome';

const PLOT_HEIGHT = 240;
/** Roughly the width one month label needs before neighbours collide. */
const LABEL_WIDTH = 48;

type Hover = {point: NetWorthPoint; index: number; x: number; y: number};

export interface NetWorthAreaProps {
  points: readonly NetWorthPoint[];
  range: Range;
  currency: string;
  isLoading: boolean;
}

export function NetWorthArea({points, range, currency, isLoading}: NetWorthAreaProps) {
  const money = useMoneyFormatter();
  const compact = useCompactMoneyFormatter();
  const [hovered, setHovered] = useState<Hover | null>(null);

  const first = points[0];
  const last = points[points.length - 1];

  // The table twin is one row per month end, not one per sample: a hundred
  // and eighty daily rows is not a table anyone reads, and the balance at the
  // end of a month is the figure a statement would show.
  const monthEnds = useMemo(() => monthEndPoints(points), [points]);

  return (
    <ChartFrame
      title="Net worth"
      description="Every account that counts toward your balance, carried forward from the start of the ledger."
      plotHeight={PLOT_HEIGHT}
      isLoading={isLoading}
      isEmpty={points.length < 2}
      emptyMessage="Not enough history in this range to draw a trend."
      summary={
        first !== undefined && last !== undefined
          ? `Net worth from ${money(first.value, currency)} on ${formatDate(first.date)} to ${money(last.value, currency)} on ${formatDate(last.date)}.`
          : 'No net worth history to chart.'
      }
      overlay={
        hovered !== null ? (
          <ChartTooltip x={hovered.x} y={hovered.y}>
            <Text type="supporting">{formatDate(hovered.point.date)}</Text>
            <Text weight="semibold" hasTabularNumbers>
              {money(hovered.point.value, currency)}
            </Text>
          </ChartTooltip>
        ) : null
      }
      table={
        <Table
          data={monthEnds.map((point) => ({
            key: String(point.date),
            date: formatDate(point.date),
            value: money(point.value, currency),
          }))}
          idKey="key"
          density="compact"
          columns={[
            {key: 'date', header: 'As of', width: proportional(1.5)},
            {key: 'value', header: 'Net worth', width: proportional(1), align: 'end'},
          ]}
        />
      }
    >
      {({width, height}) => {
        const values = points.map((point) => point.value);
        const xScale = scaleLinear<number>({
          // The sampled extent, not the range bounds. `range.to` is the
          // exclusive end — the instant *after* the last day — so scaling to
          // it would leave the line stopping a day short of the right edge
          // and float the end marker inside the plot. Every month tick still
          // falls inside this domain, because the first sample is the range's
          // own start and the last is on or after the final month start.
          domain: [first?.date ?? range.from, last?.date ?? range.to - 1],
          range: [0, width],
        });
        const yScale = scaleLinear<number>({
          // Zero is always in the domain — see the note at the top.
          domain: [Math.min(0, ...values), Math.max(0, ...values)],
          range: [height, 0],
          nice: true,
        });

        const x = (point: NetWorthPoint) => xScale(point.date);
        const y = (point: NetWorthPoint) => yScale(point.value);

        const months = monthStarts(range);
        const stride = Math.max(
          1,
          Math.ceil(months.length / Math.max(1, Math.floor(width / LABEL_WIDTH))),
        );
        // Counted from the end so the most recent month is always labelled.
        const tickValues = months.filter(
          (_, index) => (months.length - 1 - index) % stride === 0,
        );

        return (
          <>
            <GridRows
              scale={yScale}
              width={width}
              numTicks={5}
              className={CHROME.grid}
              strokeWidth={1}
            />
            <AreaClosed<NetWorthPoint>
              data={[...points]}
              x={x}
              y={y}
              yScale={yScale}
              curve={curveMonotoneX}
              className={SERIES.accent}
              // A wash under the line, never a saturated block. A presentation
              // attribute rather than a utility class, because this is the
              // mark's geometry rather than a themed colour.
              fillOpacity={MARK.areaOpacity}
            />
            <LinePath<NetWorthPoint>
              data={[...points]}
              x={x}
              y={y}
              curve={curveMonotoneX}
              className={SERIES.accentStroke}
              strokeWidth={MARK.lineWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />

            {/* The end of the line is the number the reader came for, so it
                carries the one permanent marker on this chart. The ring is
                painted in the surface colour so the dot stays legible where
                it sits on top of the line. */}
            {last !== undefined ? (
              <circle
                cx={x(last)}
                cy={y(last)}
                r={MARK.markerRadius}
                className={`${SERIES.accent} ${CHROME.surface}`}
                strokeWidth={MARK.surfaceGap}
              />
            ) : null}

            {hovered !== null ? (
              <>
                <line
                  x1={x(hovered.point)}
                  x2={x(hovered.point)}
                  y1={0}
                  y2={height}
                  className={CHROME.axis}
                  strokeWidth={1}
                />
                <circle
                  cx={x(hovered.point)}
                  cy={y(hovered.point)}
                  r={MARK.markerRadius}
                  className={`${SERIES.accent} ${CHROME.surface}`}
                  strokeWidth={MARK.surfaceGap}
                />
              </>
            ) : null}

            <AxisLeft
              scale={yScale}
              numTicks={5}
              tickFormat={(value) => compact(Number(value), currency)}
              axisLineClassName={CHROME.axis}
              tickClassName={CHROME.axis}
              tickLabelProps={() => ({className: CHROME.label, textAnchor: 'end', dx: -4, dy: 3})}
            />
            <AxisBottom
              top={height}
              scale={xScale}
              tickValues={tickValues}
              tickFormat={(value) =>
                new Date(Number(value)).toLocaleDateString(undefined, {month: 'short'})
              }
              axisLineClassName={CHROME.axis}
              tickClassName={CHROME.axis}
              tickLabelProps={() => ({className: CHROME.label, textAnchor: 'middle', dy: 2})}
            />

            {/*
              The hit layer, drawn last so it sits above every mark. It covers
              the whole plot rather than each point: aiming at an 8px dot on a
              line is a pinpoint nobody hits reliably, and the reader is aiming
              at a date anyway.
            */}
            <rect
              width={width}
              height={height}
              fill="transparent"
              onMouseMove={(event) => {
                const pointer = pointerIn(event);
                if (pointer === null) return;

                // `pointerIn` answers in svg coordinates; the plot itself
                // starts one left margin in.
                const date = xScale.invert(pointer.x - DEFAULT_MARGIN.left);
                const index = nearestIndex(points, date);
                const point = index === null ? undefined : points[index];
                if (index === null || point === undefined) return;

                setHovered({
                  point,
                  index,
                  // Anchored on the snapped sample rather than the raw
                  // pointer, so the readout and the crosshair agree.
                  x: x(point) + DEFAULT_MARGIN.left,
                  y: y(point) + DEFAULT_MARGIN.top - MARK.markerRadius * 2,
                });
              }}
              onMouseLeave={() => setHovered(null)}
            />
          </>
        );
      }}
    </ChartFrame>
  );
}

/** Nearest sample to a date, by linear scan — these arrays are short. */
function nearestIndex(points: readonly NetWorthPoint[], date: number): number | null {
  if (points.length === 0) return null;

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length; index += 1) {
    const distance = Math.abs(points[index]!.date - date);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

/** The last sample in each calendar month, for the table twin. */
function monthEndPoints(points: readonly NetWorthPoint[]): NetWorthPoint[] {
  const byMonth = new Map<string, NetWorthPoint>();
  for (const point of points) {
    const date = new Date(point.date);
    // Later samples overwrite earlier ones, so each entry ends up holding the
    // last sample of its month.
    byMonth.set(`${date.getFullYear()}-${date.getMonth()}`, point);
  }
  return [...byMonth.values()];
}
