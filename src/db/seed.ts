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

/** Icon names are Lucide, which the Astryx neutral theme already ships. */
const DEFAULT_CATEGORIES: CategorySeed[] = [
  // Present in the real export.
  {name: 'Food', icon: 'utensils', colorHex: '#EA3B35', kind: 'EXPENSE'},
  {name: 'Transportation', icon: 'car', colorHex: '#2196F3', kind: 'EXPENSE'},
  {name: 'Books', icon: 'book', colorHex: '#795548', kind: 'EXPENSE'},
  {name: 'Medicine', icon: 'pill', colorHex: '#E91E63', kind: 'EXPENSE'},
  {name: 'Movie', icon: 'film', colorHex: '#9C27B0', kind: 'EXPENSE'},
  {name: 'Gift', icon: 'gift', colorHex: '#FF9800', kind: 'BOTH'},

  // Quick-spend shortcuts from the old app's dashboard.
  {name: 'Shopping', icon: 'shopping-bag', colorHex: '#00BCD4', kind: 'EXPENSE'},
  {name: 'Bills', icon: 'receipt', colorHex: '#607D8B', kind: 'EXPENSE'},
  {name: 'Travel', icon: 'plane', colorHex: '#3F51B5', kind: 'EXPENSE'},
  {name: 'Groceries', icon: 'shopping-cart', colorHex: '#4CAF50', kind: 'EXPENSE'},
  {name: 'Health', icon: 'heart-pulse', colorHex: '#F44336', kind: 'EXPENSE'},
  {name: 'Education', icon: 'graduation-cap', colorHex: '#009688', kind: 'EXPENSE'},

  {name: 'Salary', icon: 'banknote', colorHex: '#4CAF50', kind: 'INCOME'},
  {name: 'Freelance', icon: 'laptop', colorHex: '#8BC34A', kind: 'INCOME'},

  // Kept last so it sorts to the bottom of pickers.
  {name: 'Other', icon: 'circle-ellipsis', colorHex: '#9E9E9E', kind: 'BOTH'},
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
