/**
 * A monetary amount, coloured by direction.
 *
 * Astryx's `Text` exposes only the semantic text colours (primary, secondary,
 * accent…), which have no notion of "money coming in" versus "money going
 * out". The success/error tokens do, and `tailwind-theme.css` bridges them
 * onto `text-success` / `text-error` utilities — so this uses className rather
 * than reaching past the design system for a raw hex or a `--color-*` var.
 *
 * Colour is never the only cue: the sign is always rendered too, so this stays
 * readable for colour-blind users and in a monochrome print.
 */
import {useCallback} from 'react';
import {Text} from '@astryxdesign/core/Text';
import {usePrivacyMode} from '../app/privacy-mode';
import {formatCompactMoney, formatMoney, formatSignedMoney} from '../format/money';

/**
 * What a masked amount renders as.
 *
 * A fixed width rather than one dot per digit: matching the digit count would
 * leak the order of magnitude, which is most of what a shoulder-surfer wants.
 */
const MASK = '••••';

export interface MoneyTextProps {
  amount: number;
  currency?: string;
  /**
   * How to colour the value:
   *  - `signed`  — green above zero, red below (a ledger delta, a net total)
   *  - `flow`    — the caller states the direction (income vs expense rows,
   *                where the stored amount is positive either way)
   *  - `neutral` — plain text (a balance, a budget limit)
   */
  tone?: 'signed' | 'flow' | 'neutral';
  /** With `tone="flow"`, which way the money moved. */
  direction?: 'in' | 'out';
  /** Print the sign even when the tone is neutral. */
  hasSign?: boolean;
  type?: 'body' | 'large' | 'label' | 'supporting' | 'display-3';
  weight?: 'normal' | 'medium' | 'semibold' | 'bold';
}

export function MoneyText({
  amount,
  currency,
  tone = 'neutral',
  direction,
  hasSign = false,
  type = 'body',
  weight,
}: MoneyTextProps) {
  const {isHidden} = usePrivacyMode();
  const signed = hasSign || tone === 'signed' || tone === 'flow';

  // `flow` rows store a positive amount and carry the direction separately, so
  // the sign has to be applied here rather than read off the number.
  const display = tone === 'flow' && direction === 'out' ? -amount : amount;
  const text = isHidden
    ? MASK
    : signed
      ? formatSignedMoney(display, currency)
      : formatMoney(display, currency);

  // Colour is dropped along with the digits: a red figure still says "you
  // overspent", which is the sort of thing being hidden in the first place.
  const colour = isHidden ? undefined : colourClass(tone, display);

  return (
    <Text
      type={type}
      // `exactOptionalPropertyTypes` rejects an explicit `undefined`, so
      // absent props are spread in conditionally rather than passed as one.
      {...(weight !== undefined && {weight})}
      {...(colour !== undefined && {className: colour})}
      // Digits line up column-to-column in a table, which is most of why an
      // amount column is scannable at all.
      hasTabularNumbers
    >
      {text}
    </Text>
  );
}

/**
 * `formatMoney`, but honouring "hide amounts on screen".
 *
 * For the places an amount is part of a longer string — "৳420 of ৳6000" under
 * a budget bar — where a `<MoneyText>` cannot be nested. Calling `formatMoney`
 * directly in a component works and is the easy mistake: it silently defeats
 * privacy mode for that one label, which is exactly the kind of leak nobody
 * notices until it matters. Use this instead.
 */
export function useMoneyFormatter(): (amount: number, currency?: string) => string {
  const {isHidden} = usePrivacyMode();

  return useCallback(
    (amount: number, currency?: string) =>
      isHidden ? MASK : formatMoney(amount, currency),
    [isHidden],
  );
}

/**
 * `formatCompactMoney`, but honouring "hide amounts on screen".
 *
 * For axis ticks and bar-tip labels, which are SVG `<text>` and so cannot host
 * a `<MoneyText>`. Same trap as `useMoneyFormatter`: reaching for
 * `formatCompactMoney` directly compiles and silently leaks every value on the
 * chart, which is a worse leak than a single label because a chart shows the
 * whole range at once.
 *
 * The *marks* are not masked, only the numbers — a bar's length still says
 * "this one is roughly twice that one". Privacy mode is a shoulder-surfing
 * measure, not a redaction, and hiding the shapes as well would leave a card
 * with nothing in it rather than a chart with its figures covered.
 */
export function useCompactMoneyFormatter(): (amount: number, currency?: string) => string {
  const {isHidden} = usePrivacyMode();

  return useCallback(
    (amount: number, currency?: string) =>
      isHidden ? MASK : formatCompactMoney(amount, currency),
    [isHidden],
  );
}

function colourClass(tone: MoneyTextProps['tone'], value: number): string | undefined {
  if (tone === 'neutral') return undefined;
  if (value > 0) return 'text-success';
  if (value < 0) return 'text-error';
  // Exactly zero is neither good nor bad; colouring it would imply a movement.
  return undefined;
}
