/**
 * First-run seed data.
 *
 * The category list starts from the ones actually present in the old app's
 * export (Food, Books, Gift, Medicine, Movie, Transportation, Other) so an
 * import maps onto existing rows by name instead of creating duplicates, plus
 * the rest of the old app's quick-spend shortcuts.
 *
 * Seeding is idempotent and runs only when the table is empty — re-running it
 * on an existing database would resurrect categories the user had merged away.
 */
import type {FinanceDatabase} from './db';
import {db as defaultDb} from './db';
import {createRepository, type NewRow} from './repo';
import type {Category} from './types';

type CategorySeed = Pick<Category, 'name' | 'icon' | 'colorHex' | 'kind'>;

/**
 * Icon names are Lucide, which the Astryx neutral theme already ships.
 *
 * The colours are **not** Material's 500 shades, which is what this list held
 * until Phase 4 measured them. One hex has to stay legible on both the light
 * card (`#FFFFFF`) and the dark one (`#1F1F22`), and nine of the fifteen
 * failed on one side or the other: `#FF9800` sits at 2.16:1 on white,
 * `#3F51B5` at 2.39:1 on the dark surface, and `#795548`/`#607D8B`/`#9E9E9E`
 * carry so little chroma that they read as the same grey. These replacements
 * hold each category's hue and move only its lightness, into the band where
 * one value clears 3:1 against both surfaces (OKLCH L 0.48–0.67).
 *
 * Fifteen categories cannot all be told apart by colour, and are not meant to
 * be — see PROGRESS.md §7. The charts encode identity in the row label and
 * carry the colour as a dot beside it, so this list only has to make each
 * colour *legible*, never pairwise-distinct.
 *
 * Only a database with no categories at all is seeded, so this changes what a
 * fresh install looks like and leaves every existing row alone.
 */
const DEFAULT_CATEGORIES: CategorySeed[] = [
  // Present in the real export.
  {name: 'Food', icon: 'utensils', colorHex: '#EA3B35', kind: 'EXPENSE'},
  {name: 'Transportation', icon: 'car', colorHex: '#2196F3', kind: 'EXPENSE'},
  {name: 'Books', icon: 'book', colorHex: '#A15437', kind: 'EXPENSE'},
  {name: 'Medicine', icon: 'pill', colorHex: '#E0407F', kind: 'EXPENSE'},
  {name: 'Movie', icon: 'film', colorHex: '#A537B8', kind: 'EXPENSE'},
  {name: 'Gift', icon: 'gift', colorHex: '#D47D00', kind: 'BOTH'},

  // Quick-spend shortcuts from the old app's dashboard.
  {name: 'Shopping', icon: 'shopping-bag', colorHex: '#00A3B8', kind: 'EXPENSE'},
  {name: 'Bills', icon: 'receipt', colorHex: '#007296', kind: 'EXPENSE'},
  {name: 'Travel', icon: 'plane', colorHex: '#4C61C7', kind: 'EXPENSE'},
  {name: 'Groceries', icon: 'shopping-cart', colorHex: '#5C9000', kind: 'EXPENSE'},
  {name: 'Health', icon: 'heart-pulse', colorHex: '#D42A6D', kind: 'EXPENSE'},
  {name: 'Education', icon: 'graduation-cap', colorHex: '#009688', kind: 'EXPENSE'},

  {name: 'Salary', icon: 'banknote', colorHex: '#007B17', kind: 'INCOME'},
  {name: 'Freelance', icon: 'laptop', colorHex: '#2E9E6B', kind: 'INCOME'},

  // Kept last so it sorts to the bottom of pickers. Deliberately the one
  // near-neutral in the list: "Other" is the de-emphasis slot, and a grey
  // that reads as grey is the point rather than a failed colour.
  {name: 'Other', icon: 'circle-ellipsis', colorHex: '#767676', kind: 'BOTH'},
];

export async function seedDefaultCategories(
  database: FinanceDatabase = defaultDb,
): Promise<number> {
  const repo = createRepository<Category>('categories', database);

  // Count every row, including soft-deleted ones: a user who deleted all their
  // categories should not have the defaults reappear on next launch.
  const existing = await database.categories.count();
  if (existing > 0) return 0;

  const rows: NewRow<Category>[] = DEFAULT_CATEGORIES.map((seed, index) => ({
    ...seed,
    displayOrder: index,
    isDefault: true,
  }));

  await repo.createMany(rows);
  return rows.length;
}

/**
 * Run once at startup, before the first render that reads categories.
 * Safe to call on every launch.
 */
export async function initializeDatabase(
  database: FinanceDatabase = defaultDb,
): Promise<void> {
  await database.open();
  await seedDefaultCategories(database);
}
