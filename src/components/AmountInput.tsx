/**
 * The amount field.
 *
 * Accepts arithmetic — `4500 / 3`, `1200 + 450 + 900` — because splitting a
 * bill or summing a receipt is the common case and switching to a calculator
 * to do it is the friction the old app had. `evaluateAmount` is a hand-written
 * recursive-descent parser, never `eval`; see domain/mathEval.ts.
 *
 * The field is deliberately a **text** input rather than Astryx's NumberInput.
 * NumberInput commits only valid numbers, so the intermediate states of typing
 * an expression (`4500 /`) would be rejected keystroke by keystroke and the
 * feature could not exist. The cost is that this component owns its own
 * validation, which is why the raw string and the parsed number are kept
 * separate all the way up to the form.
 *
 * There is no `inputMode="decimal"` to summon a numeric keypad on mobile:
 * Astryx's `BaseProps` explicitly omits `inputMode` from the attributes it
 * forwards, so passing it would be silently dropped. It would also be the
 * wrong keypad — a decimal pad has no `+`, `*` or parentheses.
 */
import {TextInput} from '@astryxdesign/core/TextInput';
import {evaluateAmount, isExpression, roundToMinorUnit} from '../domain/mathEval';
import {formatMoney} from '../format/money';

export interface AmountInputProps {
  label: string;
  /** Raw text as typed, expression and all. The form owns it. */
  value: string;
  onChange: (raw: string) => void;
  currency?: string;
  isRequired?: boolean;
  isDisabled?: boolean;
  hasAutoFocus?: boolean;
  placeholder?: string;
  width?: number | string;
  /** Show the "not a valid amount" error. Hold this off until first submit. */
  hasValidation?: boolean;
}

/**
 * Parse what the user typed into a storable amount.
 *
 * Rounds to the minor unit so `4500 / 3` persists as 1500 rather than
 * 1499.9999999999998, and rejects zero and negatives — direction is carried by
 * the transaction's `type`, so a negative expense would double-count as
 * income once balances are derived.
 */
export function parseAmount(raw: string): number | null {
  const value = evaluateAmount(raw);
  if (value === null) return null;

  const rounded = roundToMinorUnit(value);
  if (rounded <= 0) return null;
  return rounded;
}

export function AmountInput({
  label,
  value,
  onChange,
  currency,
  isRequired = false,
  isDisabled = false,
  hasAutoFocus = false,
  placeholder = '0.00',
  width = '100%',
  hasValidation = false,
}: AmountInputProps) {
  const parsed = parseAmount(value);
  const isEmpty = value.trim().length === 0;

  // The live "= ৳1,500.00" readout is only useful while an expression is being
  // typed. Echoing a plain number back at the user is noise.
  const preview =
    parsed !== null && isExpression(value)
      ? `= ${formatMoney(parsed, currency)}`
      : undefined;

  const status =
    hasValidation && !isEmpty && parsed === null
      ? ({type: 'error', message: 'Enter an amount above zero, or an expression like 1200 + 450'} as const)
      : undefined;

  return (
    <TextInput
      label={label}
      value={value}
      onChange={onChange}
      isRequired={isRequired}
      isDisabled={isDisabled}
      hasAutoFocus={hasAutoFocus}
      placeholder={placeholder}
      // `exactOptionalPropertyTypes` is on, so an absent prop has to be
      // genuinely absent — passing `undefined` is a type error, not a no-op.
      {...(preview !== undefined && {description: preview})}
      {...(status !== undefined && {status})}
      statusVariant="detached"
      hasClear
      width={width}
    />
  );
}
