/**
 * The motion contract.
 *
 * Defined once, here, and reused everywhere. Motion animates in JS, so it
 * cannot consume `var(--duration-fast)` directly the way CSS can. Rather than
 * hardcoding a second copy of the numbers, we read the Astryx tokens off the
 * document at startup — a custom theme's `defineTheme({motion})` config
 * changes those tokens, and this keeps the theme authoritative.
 *
 * Astryx motion guidance, which the variants below follow:
 *   - Animate spatial change: sheets, route transitions, expanding cards.
 *   - Do NOT animate high-frequency interactions (list-row hovers) — it
 *     makes the UI feel like it is lagging behind the cursor.
 *   - Never let an animation block the user's next action.
 */
import type {Transition, Variants} from 'motion/react';

/** Fallbacks match @astryxdesign/theme-neutral 0.4.3. */
const FALLBACK = {
  fast: 125,
  medium: 300,
  slow: 700,
  ease: [0.24, 1, 0.4, 1] as [number, number, number, number],
};

function readMs(styles: CSSStyleDeclaration, name: string, fallback: number): number {
  const raw = styles.getPropertyValue(name).trim();
  if (!raw) return fallback;
  // Tokens are authored as `125ms`, but tolerate `0.125s` too.
  const value = Number.parseFloat(raw);
  if (Number.isNaN(value)) return fallback;
  return raw.endsWith('ms') ? value : value * 1000;
}

function readCubicBezier(
  styles: CSSStyleDeclaration,
  name: string,
  fallback: [number, number, number, number],
): [number, number, number, number] {
  const raw = styles.getPropertyValue(name).trim();
  const match = /cubic-bezier\(([^)]+)\)/.exec(raw);
  if (!match?.[1]) return fallback;
  const parts = match[1].split(',').map((n) => Number.parseFloat(n));
  if (parts.length !== 4 || parts.some(Number.isNaN)) return fallback;
  return parts as [number, number, number, number];
}

function readTokens() {
  // Guard for the test environment, where there is no document.
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return FALLBACK;
  }
  const styles = getComputedStyle(document.documentElement);
  return {
    fast: readMs(styles, '--duration-fast', FALLBACK.fast),
    medium: readMs(styles, '--duration-medium', FALLBACK.medium),
    slow: readMs(styles, '--duration-slow', FALLBACK.slow),
    ease: readCubicBezier(styles, '--ease-standard', FALLBACK.ease),
  };
}

/**
 * Resolved once at module load. The theme's token values do not change at
 * runtime — switching light/dark swaps colors, not durations.
 */
export const motionTokens = readTokens();

/** Taps, toggles, small state changes. */
export const fast: Transition = {
  duration: motionTokens.fast / 1000,
  ease: motionTokens.ease,
};

/** Panels, sheets, route changes — anything that rearranges layout. */
export const medium: Transition = {
  duration: motionTokens.medium / 1000,
  ease: motionTokens.ease,
};

/** Reserved for deliberate, attention-drawing moments. Use sparingly. */
export const slow: Transition = {
  duration: motionTokens.slow / 1000,
  ease: motionTokens.ease,
};

/**
 * Springs read as more "alive" than fixed durations for direct manipulation
 * (drag, press, reorder). Tuned to settle in roughly `fast`.
 */
export const spring: Transition = {
  type: 'spring',
  stiffness: 420,
  damping: 34,
  mass: 0.9,
};

// --- Shared variants -------------------------------------------------------

/** Route-level transition. Content enters from below, exits upward. */
export const pageVariants: Variants = {
  initial: {opacity: 0, y: 8},
  animate: {opacity: 1, y: 0, transition: medium},
  exit: {opacity: 0, y: -8, transition: fast},
};

/** Bottom sheets and modal surfaces on touch. */
export const sheetVariants: Variants = {
  initial: {y: '100%'},
  animate: {y: 0, transition: medium},
  exit: {y: '100%', transition: fast},
};

/** Popovers, menus, and cards that expand from a trigger. */
export const popVariants: Variants = {
  initial: {opacity: 0, scale: 0.96},
  animate: {opacity: 1, scale: 1, transition: fast},
  // Contextual UI the user is moving away from can leave instantly.
  exit: {opacity: 0, scale: 0.96, transition: {duration: 0}},
};

/**
 * Parent for staggered lists. Keep `staggerChildren` small — a long ledger
 * should feel like it snapped into place, not dealt like cards.
 */
export const listVariants: Variants = {
  initial: {},
  animate: {transition: {staggerChildren: 0.025, delayChildren: 0.02}},
  exit: {},
};

export const listItemVariants: Variants = {
  initial: {opacity: 0, y: 6},
  animate: {opacity: 1, y: 0, transition: fast},
  exit: {opacity: 0, transition: fast},
};
