/**
 * Arithmetic evaluation for the amount field.
 *
 * Lets you type `4500 / 3` or `1200 + 450 + 900` straight into the amount box
 * instead of switching to a calculator. Ported from the old app's
 * `MathEvaluator.kt` (recursive descent over `+ - * / ( )` with unary signs,
 * returning null on any parse or arithmetic error).
 *
 * Two deliberate deviations from the original:
 *
 *  1. Unclosed parentheses are an error. The original called `eat(')')` and
 *     ignored the result, so `(1+2` silently evaluated to 3. For a field that
 *     sets a monetary amount, quietly accepting malformed input is worse than
 *     showing no preview until the expression is well-formed.
 *
 *  2. Currency stripping covers the symbols this app can actually store, not
 *     just the hardcoded taka sign, since accounts carry their own currency.
 *
 * Never use `eval` or `new Function` here: this parses user input, and a money
 * field is the last place to hand over arbitrary code execution.
 */

/** Symbols stripped before parsing. Extend alongside the account currency list. */
const CURRENCY_SYMBOLS = /[৳$€£¥₹₽₩₪₫₱฿,\s]/g;

export function evaluateAmount(expression: string): number | null {
  const clean = expression.replace(CURRENCY_SYMBOLS, '');
  if (clean.length === 0) return null;

  let pos = -1;
  let ch = -1;

  function nextChar(): void {
    pos += 1;
    ch = pos < clean.length ? clean.charCodeAt(pos) : -1;
  }

  function eat(charCode: number): boolean {
    if (ch === charCode) {
      nextChar();
      return true;
    }
    return false;
  }

  function isDigitOrDot(code: number): boolean {
    return (code >= 0x30 && code <= 0x39) || code === 0x2e; // 0-9 or .
  }

  function parseFactor(): number {
    if (eat(0x2b)) return parseFactor(); // unary +
    if (eat(0x2d)) return -parseFactor(); // unary -

    if (eat(0x28)) {
      // (
      const inner = parseExpression();
      // Deviation 1: the closing paren is required.
      if (!eat(0x29)) throw new SyntaxError('Unclosed parenthesis');
      return inner;
    }

    const start = pos;
    if (!isDigitOrDot(ch)) throw new SyntaxError('Expected a number');
    while (isDigitOrDot(ch)) nextChar();

    const literal = clean.slice(start, pos);
    const value = Number(literal);
    // Catches malformed literals like "1.2.3", which Number() returns NaN for.
    if (!Number.isFinite(value)) throw new SyntaxError('Malformed number');
    return value;
  }

  function parseTerm(): number {
    let x = parseFactor();
    for (;;) {
      if (eat(0x2a)) {
        // *
        x *= parseFactor();
      } else if (eat(0x2f)) {
        // /
        const divisor = parseFactor();
        if (divisor === 0) throw new RangeError('Division by zero');
        x /= divisor;
      } else {
        return x;
      }
    }
  }

  function parseExpression(): number {
    let x = parseTerm();
    for (;;) {
      if (eat(0x2b)) x += parseTerm();
      else if (eat(0x2d)) x -= parseTerm();
      else return x;
    }
  }

  try {
    nextChar();
    const result = parseExpression();
    // Trailing junk means the whole expression was not consumed.
    if (pos < clean.length) return null;
    if (!Number.isFinite(result)) return null;
    return result;
  } catch {
    return null;
  }
}

/**
 * True when the input is more than a plain number, i.e. worth showing a live
 * "= 1500" preview next to the field.
 */
export function isExpression(input: string): boolean {
  const clean = input.replace(CURRENCY_SYMBOLS, '');
  // Skip index 0 so a leading unary sign ("-500") is not mistaken for one.
  return /[+\-*/()]/.test(clean.slice(1));
}

/**
 * Money is stored as a number, so round to the currency's minor unit to keep
 * `4500 / 3` from persisting as 1499.9999999999998.
 */
export function roundToMinorUnit(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
