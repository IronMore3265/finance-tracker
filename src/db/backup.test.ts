// Patches indexedDB onto globalThis so Dexie runs under Node.
import 'fake-indexeddb/auto';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
  BACKUP_FORMAT_VERSION,
  exportBackup,
  importBackup,
  parseBackupText,
  summarizeBackup,
} from './backup';
import {createTestDatabase, type FinanceDatabase} from './db';
import {createRepository} from './repo';
import type {Account, Category, Transaction} from './types';

let db: FinanceDatabase;
let dbCount = 0;

let accounts: ReturnType<typeof createRepository<Account>>;
let categories: ReturnType<typeof createRepository<Category>>;
let transactions: ReturnType<typeof createRepository<Transaction>>;

const account = (overrides: Partial<Account> = {}) => ({
  name: 'Cash',
  openingBalance: 1000,
  colorHex: '#2196F3',
  icon: 'wallet' as const,
  currency: 'BDT',
  includeInBalance: true,
  displayOrder: 0,
  ...overrides,
});

beforeEach(async () => {
  db = createTestDatabase(`backup-${(dbCount += 1)}-${Date.now()}`);
  await db.open();
  accounts = createRepository<Account>('accounts', db);
  categories = createRepository<Category>('categories', db);
  transactions = createRepository<Transaction>('transactions', db);
});

afterEach(() => {
  db.close();
});

describe('exportBackup', () => {
  it('captures every synced table', async () => {
    await accounts.create(account());

    const backup = await exportBackup(db);

    expect(backup.format).toBe('finance-tracker-backup');
    expect(backup.version).toBe(BACKUP_FORMAT_VERSION);
    expect(backup.tables.accounts).toHaveLength(1);
    // Present but empty, so a reader can tell "no debts" from "no debts key".
    expect(backup.tables.debts).toEqual([]);
  });

  it('includes soft-deleted rows', async () => {
    const created = await accounts.create(account());
    await accounts.softDelete(created.id);

    const backup = await exportBackup(db);

    // Omitting them would silently empty the trash on restore, and would
    // resurrect the row the moment a peer compared the two copies.
    expect(backup.tables.accounts).toHaveLength(1);
    expect((backup.tables.accounts as Account[])[0]?.deletedAt).not.toBeNull();
  });

  it('does not export the outbox', async () => {
    await accounts.create(account());
    const backup = await exportBackup(db);

    // Device-local push bookkeeping. Restoring another device's queue would
    // try to push rows this device never changed.
    expect('outbox' in backup.tables).toBe(false);
  });
});

describe('summarizeBackup', () => {
  it('counts the rows in each table', async () => {
    await accounts.create(account());
    await categories.create({
      name: 'Food',
      icon: 'utensils',
      colorHex: '#EA3B35',
      kind: 'EXPENSE',
      displayOrder: 0,
      isDefault: false,
    });

    const summary = summarizeBackup(await exportBackup(db));

    expect(summary.counts.accounts).toBe(1);
    expect(summary.counts.categories).toBe(1);
    expect(summary.total).toBe(2);
  });

  it('rejects a file that is not a backup', () => {
    expect(() => summarizeBackup({hello: 'world'})).toThrow(/does not look like/);
    expect(() => summarizeBackup(null)).toThrow(/does not look like/);
  });

  it('rejects a backup from a newer format', () => {
    expect(() =>
      summarizeBackup({
        format: 'finance-tracker-backup',
        version: BACKUP_FORMAT_VERSION + 1,
        tables: {},
      }),
    ).toThrow(/newer version/);
  });
});

describe('importBackup', () => {
  it('round-trips rows unchanged, including their timestamps', async () => {
    const created = await accounts.create(account({name: 'Brac Bank'}));
    const backup = await exportBackup(db);

    await accounts.softDelete(created.id);
    await importBackup(backup, 'replace', db);

    const restored = await accounts.get(created.id);
    expect(restored?.name).toBe('Brac Bank');
    // Re-stamping on restore would make a restored copy beat a newer remote
    // row under last-write-wins, so the original timestamps must survive.
    expect(restored?.updatedAt).toBe(created.updatedAt);
    expect(restored?.createdAt).toBe(created.createdAt);
  });

  it('replace clears rows the backup does not contain', async () => {
    const kept = await accounts.create(account({name: 'Cash'}));
    const backup = await exportBackup(db);

    const added = await accounts.create(account({name: 'Added later'}));
    await importBackup(backup, 'replace', db);

    expect(await accounts.get(kept.id)).toBeDefined();
    expect(await accounts.getIncludingDeleted(added.id)).toBeUndefined();
  });

  it('merge keeps rows the backup does not contain', async () => {
    await accounts.create(account({name: 'Cash'}));
    const backup = await exportBackup(db);

    const added = await accounts.create(account({name: 'Added later'}));
    await importBackup(backup, 'merge', db);

    expect(await accounts.get(added.id)).toBeDefined();
    expect(await accounts.all()).toHaveLength(2);
  });

  it('the backup wins on an id collision', async () => {
    const created = await accounts.create(account({name: 'Original'}));
    const backup = await exportBackup(db);

    await accounts.update(created.id, {name: 'Renamed after the backup'});
    await importBackup(backup, 'merge', db);

    expect((await accounts.get(created.id))?.name).toBe('Original');
  });

  it('restores relationships between tables', async () => {
    const wallet = await accounts.create(account());
    const food = await categories.create({
      name: 'Food',
      icon: 'utensils',
      colorHex: '#EA3B35',
      kind: 'EXPENSE',
      displayOrder: 0,
      isDefault: false,
    });
    const spend = await transactions.create({
      amount: 250,
      description: 'Lunch',
      categoryId: food.id,
      date: Date.now(),
      type: 'EXPENSE',
      accountId: wallet.id,
      toAccountId: null,
      tags: ['work'],
      plannedId: null,
      occurrenceDate: null,
    });

    const backup = await exportBackup(db);
    await importBackup(backup, 'replace', db);

    const restored = await transactions.get(spend.id);
    // Ids, not names — which is exactly what the old app's .xls export could
    // not carry, and why re-importing it could only guess.
    expect(restored?.accountId).toBe(wallet.id);
    expect(restored?.categoryId).toBe(food.id);
    expect(restored?.tags).toEqual(['work']);
  });

  it('survives a real JSON round trip', async () => {
    await accounts.create(account());
    const text = JSON.stringify(await exportBackup(db));

    await importBackup(parseBackupText(text), 'replace', db);

    expect(await accounts.all()).toHaveLength(1);
  });
});

describe('parseBackupText', () => {
  it('reports unreadable files in plain language', () => {
    expect(() => parseBackupText('not json at all')).toThrow(/not valid JSON/);
  });
});
