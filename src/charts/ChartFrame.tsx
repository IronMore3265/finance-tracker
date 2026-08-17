/**
 * The shared chart frame: heading, legend, table twin, and a measured plot.
 *
 * Built before any individual chart, deliberately. Four charts that each grew
 * their own margins, tick counts and empty states would drift apart within a
 * week; here the only thing a chart supplies is its marks.
 *
 * Three things the frame owns that are easy to get wrong per-chart:
 *
 *  1. **Height includes the axis band.** The `<svg>` is `plotHeight` *plus*
 *     the margins, so the x-axis labels are inside the box rather than
 *     overflowing it. Sizing a container to the plot alone is what produces a
 *     card with its own tiny nested scrollbar and half a row of clipped month
 *     names.
 *  2. **A table twin, always.** Every chart can be switched to the table that
 *     carries the same numbers. This is what makes it legitimate for a mark
 *     to fall below 3:1 against the surface, for a value to be reachable only
 *     by hovering, or for a label not to fit inside its bar — the value is
 *     never gated behind the picture.
 *  3. **Width is measured, never assumed.** A chart rendered at a guessed
 *     width and then scaled produces blurry text and lying axes.
 *
 * The frame renders nothing until it has a width, which is one frame later
 * than the card appears. That is why the plot area reserves its height up
 * front — otherwise every chart on the screen would jump downward on mount.
 */
import {useId, useState, type ReactNode} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {Card} from '@astryxdesign/core/Card';
import {Heading} from '@astryxdesign/core/Heading';
import {Stack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {VisuallyHidden} from '@astryxdesign/core/VisuallyHidden';
import {useParentSize} from '@visx/responsive';
import {Group} from '@visx/group';
import {DEFAULT_MARGIN, MARK, type Margin} from './chrome';

export interface PlotSize {
  /** Plot area width, inside the margins. */
  width: number;
  /** Plot area height, inside the margins. */
  height: number;
}

export interface ChartFrameProps {
  title: string;
  /** One line on what question this chart answers. */
  description?: string;
  /** Height of the plot area itself; the axis bands are added on top. */
  plotHeight: number;
  margin?: Margin;
  /** Identity channel for two or more series. Omitted for a single series. */
  legend?: readonly LegendItem[];
  /**
   * The same numbers as a table. Required, not optional — see the note above
   * on why the chart is never the only way to read a value.
   */
  table: ReactNode;
  /** One sentence describing the shape, for screen readers. */
  summary: string;
  /** True while the live query has not resolved yet. */
  isLoading?: boolean;
  /** True when the query resolved and there is genuinely nothing to draw. */
  isEmpty?: boolean;
  emptyMessage?: string;
  /** Floating readout, positioned by the chart. Rendered over the plot. */
  overlay?: ReactNode;
  children: (size: PlotSize) => ReactNode;
}

export function ChartFrame({
  title,
  description,
  plotHeight,
  margin = DEFAULT_MARGIN,
  legend,
  table,
  summary,
  isLoading = false,
  isEmpty = false,
  emptyMessage = 'Nothing to chart for this range yet.',
  overlay,
  children,
}: ChartFrameProps) {
  // `debounceTime: 0` because a resize here is a layout change the user is
  // watching (dragging the window, opening the nav drawer), not a stream of
  // events worth coalescing — a debounce reads as the chart lagging behind
  // the card it lives in.
  const {parentRef, width} = useParentSize<HTMLElement>({debounceTime: 0});
  const [isTableShown, setIsTableShown] = useState(false);
  const summaryId = useId();

  const svgHeight = plotHeight + margin.top + margin.bottom;
  const innerWidth = Math.max(0, width - margin.left - margin.right);

  return (
    <Card padding={0}>
      <Stack gap={3} padding={4}>
        <Stack direction="horizontal" hAlign="between" vAlign="start" gap={3} wrap="wrap">
          <Stack gap={1}>
            <Heading level={3}>{title}</Heading>
            {description !== undefined ? (
              <Text type="supporting" as="p">
                {description}
              </Text>
            ) : null}
          </Stack>
          {!isEmpty && !isLoading ? (
            <Button
              label={isTableShown ? 'Show chart' : 'Show table'}
              variant="ghost"
              size="sm"
              onClick={() => setIsTableShown((shown) => !shown)}
            />
          ) : null}
        </Stack>

        {legend !== undefined && legend.length > 0 && !isTableShown && !isEmpty ? (
          <ChartLegend items={legend} />
        ) : null}

        {isTableShown ? (
          table
        ) : isEmpty ? (
          // While the live query is still resolving there is no message to
          // show and no data to scale against — a chart built from an empty
          // domain would divide by a zero-width range. The height is held
          // open instead, so the card does not jump once the rows arrive.
          isLoading ? (
            <Stack width="100%" height={svgHeight} />
          ) : (
            <Text type="supporting" as="p">
              {emptyMessage}
            </Text>
          )
        ) : (
          // `relative` so a pointer-positioned readout can be placed against
          // this box rather than against the page.
          <Stack ref={parentRef} width="100%" height={svgHeight} className="relative">
            {width > 0 && innerWidth > 0 ? (
              <>
                <svg width={width} height={svgHeight} role="img" aria-labelledby={summaryId}>
                  {/* The marks are meaningless to a screen reader on their
                      own; this title and the table twin carry the content. */}
                  <title id={summaryId}>{summary}</title>
                  <Group left={margin.left} top={margin.top}>
                    {children({width: innerWidth, height: plotHeight})}
                  </Group>
                </svg>
                {overlay}
              </>
            ) : (
              <VisuallyHidden>{summary}</VisuallyHidden>
            )}
          </Stack>
        )}
      </Stack>
    </Card>
  );
}

// --- Legend -----------------------------------------------------------------

export interface LegendItem {
  label: string;
  /**
   * A token-backed fill utility (`fill-success`). Written out as a literal at
   * the call site, never composed — see the note in chrome.ts.
   */
  className?: string;
  /** A category's own colour, when the swatch stands for user data. */
  colorHex?: string;
  /** Legends mirror the mark: a bar gets a rect, a line gets a line. */
  shape?: 'rect' | 'line';
}

/**
 * The dependable identity channel for two or more series.
 *
 * Present whenever more than one series is on screen — never make the reader
 * match colours from memory. A single-series chart gets none: one colour
 * restates the title and costs a row of space.
 */
export function ChartLegend({items}: {items: readonly LegendItem[]}) {
  return (
    <Stack direction="horizontal" gap={4} wrap="wrap" vAlign="center" as="ul">
      {items.map((item) => (
        <Stack key={item.label} direction="horizontal" gap={2} vAlign="center" as="li">
          <LegendSwatch {...item} />
          <Text type="supporting">{item.label}</Text>
        </Stack>
      ))}
    </Stack>
  );
}

const SWATCH = 12;

function LegendSwatch({className, colorHex, shape = 'rect'}: LegendItem) {
  // A user-chosen `colorHex` is runtime data, so it arrives as an inline fill
  // — the same documented exception the entity swatches use (EntityIcon.tsx).
  // Every *design* colour still comes through a token-backed class.
  const paint = colorHex !== undefined ? {fill: colorHex} : {};

  return (
    <svg width={SWATCH} height={SWATCH} aria-hidden focusable="false">
      {shape === 'line' ? (
        <rect
          x={0}
          y={SWATCH / 2 - MARK.lineWidth / 2}
          width={SWATCH}
          height={MARK.lineWidth}
          rx={MARK.lineWidth / 2}
          {...(className !== undefined && {className})}
          {...paint}
        />
      ) : (
        <rect
          width={SWATCH}
          height={SWATCH}
          rx={2}
          {...(className !== undefined && {className})}
          {...paint}
        />
      )}
    </svg>
  );
}

// --- Tooltip ----------------------------------------------------------------

export interface ChartTooltipProps {
  /** Pointer position within the frame, in px. */
  x: number;
  y: number;
  children: ReactNode;
}

/**
 * The floating readout.
 *
 * Enhances, never gates: everything shown here is also in the table twin, so
 * a reader who cannot hover is not locked out of a number. `x`/`y` are
 * pointer coordinates — runtime values a token cannot express — which is why
 * they arrive as an inline `style` rather than a class.
 *
 * `pointer-events-none` matters more than it looks: a readout that sat under
 * the cursor and captured the pointer would fire the plot's `mouseleave`,
 * hide itself, restore the hover, and flicker at about 30Hz.
 *
 * The surface is built from token-backed utilities rather than a `Card`,
 * because Astryx's own guidance is not to nest a Card inside a Card and this
 * always renders inside the frame's.
 */
export function ChartTooltip({x, y, children}: ChartTooltipProps) {
  return (
    <Stack
      gap={1}
      padding={2}
      className="absolute pointer-events-none z-10 bg-popover border border-border rounded-lg shadow-md"
      style={{left: x, top: y, transform: 'translate(-50%, -100%)'}}
    >
      {children}
    </Stack>
  );
}
