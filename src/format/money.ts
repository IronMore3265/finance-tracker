/**
 * Money formatting.
 *
 * Amounts are stored as plain numbers in *major* units (1234.56, not 123456),
 * matching the old app's schema, and rounded to the minor unit on write by
 * `roundToMinorUnit`. Formatting therefore only has to present a value, never
 * to rescale one.
 *
 * `Intl.NumberFormat` instances are cached: constructing one costs roughly a
 * hundred times as much as calling `format` on it, and a transaction table
 * formats one per row on every render.
 */

/**
 * Fallback when nothing else says otherwise.
 *
 * The old app is Bangladeshi and its export writes taka; `mathEval` already
 * strips `৳` first in its symbol list. Accounts each carry their own currency
 * though, so this is only the seed for a brand-new database.
 */
export const DEFAULT_CURRENCY = 'BDT';

const formatterCache = new Map<string, Intl.NumberFormat>();

function formatterFor(currency: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${currency}|${JSON.stringify(options)}`;
  const cached = formatterCache.get(key);
  if (cached) return cached;

  let formatter: Intl.NumberFormat;
  try {
    formatter = new Intl.NumberFormat(undefined, {style: 'currency', currency, ...options});
  } catch {
    // An unknown or malformed ISO code throws rather than degrading. A row
    // imported with a junk currency should still render its number.
    formatter = new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      ...options,
    });
  }

  formatterCache.set(key, formatter);
  return formatter;
}

/**
 * `৳1,234.56`.
 *
 * `narrowSymbol` keeps the symbol short where a locale would otherwise
 * disambiguate it ("BDT 1,234.56", or "US$" for USD outside the US), which
 * matters in a table where the currency is already implied by the account.
 */
export function formatMoney(amount: number, currency = DEFAULT_CURRENCY): string {
  return formatterFor(currency, {currencyDisplay: 'narrowSymbol'}).format(amount);
}

/**
 * Always signed: `+৳500.00` / `−৳500.00`.
 *
 * Used where the direction of a movement is the point (a ledger row, a
 * transfer leg). Uses `signDisplay` rather than string surgery so the sign
 * lands where the locale puts it, and so the minus is a real U+2212 minus
 * rather than a hyphen.
 */
export function formatSignedMoney(amount: number, currency = DEFAULT_CURRENCY): string {
  return formatterFor(currency, {
    currencyDisplay: 'narrowSymbol',
    signDisplay: 'exceptZero',
  }).format(amount);
}

/** `৳1.2K` for axis labels and tight summary tiles. */
export function formatCompactMoney(amount: number, currency = DEFAULT_CURRENCY): string {
  return formatterFor(currency, {
    currencyDisplay: 'narrowSymbol',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(amount);
}

/**
 * The currency to use when no account is in scope.
 *
 * Taken from the accounts themselves rather than a separate setting, so there
 * is no second place for it to disagree with the ledger. The most common
 * currency across accounts wins; ties break toward the earliest-created
 * account, which `accounts` is already sorted by.
 */
export function dominantCurrency(
  accounts: readonly {currency: string}[],
  fallback = DEFAULT_CURRENCY,
): string {
  const first = accounts[0];
  if (first === undefined) return fallback;

  const counts = new Map<string, number>();
  for (const account of accounts) {
    counts.set(account.currency, (counts.get(account.currency) ?? 0) + 1);
  }

  let best = first.currency;
  let bestCount = 0;
  for (const [currency, count] of counts) {
    if (count > bestCount) {
      best = currency;
      bestCount = count;
    }
  }

  return best;
}

/**
 * ISO 4217 codes offered when creating an account.
 *
 * Short on purpose: a picker of every world currency is worse than a short
 * list plus the ability to type one, and this is a single-user app.
 */
export const COMMON_CURRENCIES = [
  'BDT',
  'USD',
  'EUR',
  'GBP',
  'INR',
  'AUD',
  'CAD',
  'JPY',
  'SGD',
  'AED',
  'MYR',
  'SAR',
] as const;
