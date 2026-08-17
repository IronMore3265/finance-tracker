/**
 * The chart contract: mark specs, chrome colours, and layout constants.
 *
 * Defined once so every chart looks like the same instrument. The values are
 * not taste — they are the specs the data-viz method fixes across all charts
 * (thin marks, hairline recessive grid, negative space doing the separating),
 * and re-deciding them per chart is how a dashboard ends up looking like four
 * dashboards.
 *
 * **Colours are Tailwind utility class names, not hex.** SVG's `fill` and
 * `stroke` are CSS properties, so a class backed by an Astryx token resolves
 * live — which is the whole reason the charts theme correctly in light and
 * dark without a `mode` prop, a re-render, or a second palette. Reading the
 * token values into JS (the way `app/motion.ts` reads the duration tokens)
 * would *not* work here: durations are fixed for the life of the document,
 * colours change the moment the user flips the theme.
 *
 * The names are written out as literals rather than composed
 * (`` `fill-${hue}` ``) because Tailwind discovers utilities by scanning
 * source text. A computed class name is generated at runtime and never
 * emitted into the stylesheet, so the mark renders with no fill at all.
 */
import type {MouseEvent as ReactMouseEvent} from 'react';
import {localPoint} from '@visx/event';

/** Fixed mark geometry. Pixels, because SVG geometry is pixels. */
export const MARK = {
  /**
   * Bars and columns cap here rather than filling their band — the leftover
   * is deliberate air. A 60px-thick bar reads as a block, not a measurement.
   */
  maxThickness: 24,
  /** Rounded at the data end, square at the baseline. */
  endRadius: 4,
  lineWidth: 2,
  /** Markers are >= 8px across so they can actually be hit. */
  markerRadius: 4,
  /**
   * Surface-coloured gap between touching marks, and the ring around markers
   * that cross a line. A gap, never a border: a stroke around a mark adds ink
   * that is not data.
   */
  surfaceGap: 2,
  /** Area fills are a wash under the line, never a saturated block. */
  areaOpacity: 0.12,
} as const;

/**
 * Series colours.
 *
 * Only two jobs appear on this screen, and neither is "eight arbitrary
 * series" — see PROGRESS.md §7 for why the category charts deliberately do
 * *not* encode identity in colour.
 *
 *  - `accent`  — the single-series hue (spending, net worth). One series, so
 *                no legend: the chart's own title says what is plotted.
 *  - `in`/`out` — income and expense. These are **status** colours, not
 *                categorical ones, because here the series genuinely mean
 *                good and bad. Green/red is the classic colour-vision
 *                failure, so both charts using them ship the secondary
 *                encoding that makes it legal: a legend, fixed positions,
 *                signed values, and a table view.
 */
export const SERIES = {
  accent: 'fill-accent-bg',
  accentStroke: 'stroke-accent-bg',
  in: 'fill-success',
  out: 'fill-error',
  /** Context marks in an emphasis chart, and the folded "Other" bucket. */
  muted: 'fill-disabled',
} as const;

/** Grid, axes and label ink. All recessive: the data is the loud part. */
export const CHROME = {
  /** Hairline, solid, one step off the surface. Never dashed. */
  grid: 'stroke-border',
  axis: 'stroke-border-strong',
  /** Axis ticks and in-chart labels wear text ink, never the series colour. */
  label: 'fill-secondary text-2xs',
  labelStrong: 'fill-primary text-2xs',
  /** The gap and ring are painted in the surface the chart sits on. */
  surface: 'stroke-card',
} as const;

/**
 * Pointer position inside the chart's `<svg>`, or null if it cannot be
 * resolved.
 *
 * Wraps visx's `localPoint` rather than reading `event.nativeEvent.offsetX`.
 * `offsetX` is specified relative to the *target's* padding edge, and SVG
 * shapes have no padding box, so what browsers report there has historically
 * differed between engines — the readout would sit correctly in one browser
 * and be offset by a margin in another. `localPoint` goes through
 * `getScreenCTM`, so it answers in the SVG's own coordinate system whatever
 * the target and whatever transforms are in play.
 */
export function pointerIn(event: MouseEvent | ReactMouseEvent): {x: number; y: number} | null {
  const point = localPoint(event as MouseEvent);
  return point === null ? null : {x: point.x, y: point.y};
}

export type Margin = {top: number; right: number; bottom: number; left: number};

/**
 * Room for a bottom axis and a left value axis.
 *
 * The left margin fits a compact currency tick (`৳12.4K`); the bottom fits one
 * line of month label. Both are part of the frame's height rather than
 * something the plot has to give back later — a container sized to the plot
 * alone crops its own axis and grows a nested scrollbar.
 */
export const DEFAULT_MARGIN: Margin = {top: 8, right: 16, bottom: 28, left: 64};

/** Category names sit outside the plot, so the left margin carries them. */
export const CATEGORY_MARGIN: Margin = {top: 4, right: 56, bottom: 24, left: 132};

/**
 * Bar thickness for a band scale, capped and centred.
 *
 * Returns the offset that re-centres the capped bar inside its band, so a
 * chart with few rows gets thin bars with even air rather than one thick
 * band-filling slab.
 */
export function fitBand(bandwidth: number, max = MARK.maxThickness): {
  thickness: number;
  offset: number;
} {
  const thickness = Math.min(bandwidth, max);
  return {thickness, offset: (bandwidth - thickness) / 2};
}

/**
 * Fit a row label into the left margin.
 *
 * A character budget rather than a measured width: measuring SVG text needs a
 * layout pass against a webfont that may not have loaded yet, and the value
 * the measurement would protect is already reachable three other ways — the
 * `<title>` on the text node, the tooltip, and the table twin. The cap is
 * deliberately short so a run of wide glyphs still fits, because
 * over-truncating is recoverable and a name running under the bars is not.
 *
 * What this must never become is `overflow: hidden` on the mark, which crops
 * the first or last characters and reads as a rendering bug.
 */
export const MAX_LABEL_CHARS = 16;

export function truncateLabel(label: string): string {
  if (label.length <= MAX_LABEL_CHARS) return label;
  return `${label.slice(0, MAX_LABEL_CHARS - 1).trimEnd()}…`;
}
