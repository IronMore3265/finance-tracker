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
import {Text} from '@astryxdesign/core/Text';
import {formatMoney, formatSignedMoney} from '../format/money';

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
  const signed = hasSign || tone === 'signed' || tone === 'flow';

  // `flow` rows store a positive amount and carry the direction separately, so
  // the sign has to be applied here rather than read off the number.
  const display = tone === 'flow' && direction === 'out' ? -amount : amount;
  const text = signed
    ? formatSignedMoney(display, currency)
    : formatMoney(display, currency);

  const colour = colourClass(tone, display);

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

function colourClass(tone: MoneyTextProps['tone'], value: number): string | undefined {
  if (tone === 'neutral') return undefined;
  if (value > 0) return 'text-success';
  if (value < 0) return 'text-error';
  // Exactly zero is neither good nor bad; colouring it would imply a movement.
  return undefined;
}
