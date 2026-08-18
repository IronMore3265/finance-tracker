/**
 * Stable identity for rows that arrive without one.
 *
 * The old app's export has no ids at all (PROGRESS.md section 5) — accounts
 * and categories are referenced by name, and a transaction is just its
 * columns. That leaves one hard requirement: importing the same file twice
 * must not produce two copies of every transaction. Someone re-exporting after
 * another week of spending, or simply pressing the button again, is the normal
 * case, not the edge case.
 *
 * Two designs were possible. Fuzzy matching on re-import — "is there already a
 * row that looks like this?" — puts the duplicate-detection rule in the
 * importer, where it has to be re-run and re-tuned on every import, and gets
 * it wrong in both directions. Instead the id is *derived from the row's
 * content*: UUIDv5 over a natural key, so the same source row always produces
 * the same id, on any device, forever. Re-import then reduces to a primary-key
 * lookup, which cannot be fuzzy.
 *
 * The cost is deliberate and small: these ids are v5, not the v7 the rest of
 * the app generates, so they do not sort by creation time. Nothing depends on
 * that — every row carries a real `date`, and ordering is done on it.
 *
 * Two source rows identical in every column (same second, same amount, same
 * account, same category, same description) would collapse onto one id, so
 * `naturalKey` takes an occurrence index and the caller counts duplicates
 * within a run. Two genuinely identical spends stay two rows.
 */
import {v5 as uuidv5} from 'uuid';

/**
 * Namespace for every id this importer derives. Fixed for good: changing it
 * would make every previously imported row look new again, and the next
 * import would duplicate the lot.
 */
const IMPORT_NAMESPACE = 'ab47d1fb-ea74-4dc8-a820-afc3a27ef5c3';

/**
 * Field separator inside a natural key.
 *
 * U+0001 rather than a printable character: a description holding the
 * separator would otherwise be able to shift the field boundaries and collide
 * with a different row, and a control character is the one thing a spreadsheet
 * cell cannot contain.
 */
const SEPARATOR = '\u0001';

/**
 * The kinds of row the importer creates. Part of the key, so an account and a
 * category of the same name never collide.
 */
export type ImportedKind =
  | 'account'
  | 'category'
  | 'transaction'
  | 'debt'
  | 'debtPayment'
  | 'planned';

/** Join the parts of a natural key. */
export function naturalKey(parts: readonly (string | number | null)[]): string {
  return parts.map((part) => (part === null ? '' : String(part))).join(SEPARATOR);
}

/** The id a given source row will always have. */
export function importedId(kind: ImportedKind, key: string): string {
  return uuidv5(`${kind}${SEPARATOR}${key}`, IMPORT_NAMESPACE);
}

/** Names resolve case- and whitespace-insensitively, so `Cash` and ` cash ` are one account. */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}
