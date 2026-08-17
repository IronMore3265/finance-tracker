// Patches indexedDB onto globalThis so Dexie runs under Node.
import 'fake-indexeddb/auto';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {createTestDatabase, type FinanceDatabase} from './db';
import {createRepository} from './repo';
import type {Account} from './types';

let db: FinanceDatabase;
let accounts: ReturnType<typeof createRepository<Account>>;
let dbCount = 0;

const draft = (overrides: Partial<Account> = {}) => ({
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
  db = createTestDatabase(`test-${(dbCount += 1)}-${Date.now()}`);
  await db.open();
  accounts = createRepository<Account>('accounts', db);
});

afterEach(async () => {
  db.close();
});

describe('create', () => {
  it('stamps sync metadata', async () => {
    const created = await accounts.create(draft());

    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.createdAt).toBeGreaterThan(0);
    expect(created.updatedAt).toBe(created.createdAt);
    expect(created.deletedAt).toBeNull();
    expect(created.userId).toBeNull();
  });

  it('generates sortable ids', async () => {
    const first = await accounts.create(draft({name: 'A'}));
    const second = await accounts.create(draft({name: 'B'}));
    // UUIDv7 is time-ordered, so lexical sort matches creation order.
    expect([second.id, first.id].sort()).toEqual([first.id, second.id]);
  });

  it('queues an outbox entry', async () => {
    const created = await accounts.create(draft());
    const queued = await db.outbox.toArray();

    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({table: 'accounts', rowId: created.id});
  });
});

describe('update', () => {
  it('patches fields and advances updatedAt', async () => {
    const created = await accounts.create(draft());
    const updated = await accounts.update(created.id, {name: 'Brac Bank'});

    expect(updated?.name).toBe('Brac Bank');
    expect(updated?.createdAt).toBe(created.createdAt);
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
  });

  it('refuses to edit a deleted row rather than resurrecting it', async () => {
    const created = await accounts.create(draft());
    await accounts.softDelete(created.id);

    expect(await accounts.update(created.id, {name: 'Ghost'})).toBeUndefined();
    expect(await accounts.getIncludingDeleted(created.id)).toMatchObject({
      name: 'Cash',
    });
  });

  it('returns undefined for an unknown id', async () => {
    expect(await accounts.update('missing', {name: 'x'})).toBeUndefined();
  });

  it('collapses repeated edits into one outbox entry', async () => {
    const created = await accounts.create(draft());
    await accounts.update(created.id, {name: 'One'});
    await accounts.update(created.id, {name: 'Two'});
    await accounts.update(created.id, {name: 'Three'});

    // The outbox records that the row changed, not each change.
    const queued = await db.outbox.toArray();
    expect(queued).toHaveLength(1);
    expect(queued[0]?.rowId).toBe(created.id);
  });
});

describe('soft delete and restore', () => {
  it('hides deleted rows from reads but keeps the data', async () => {
    const created = await accounts.create(draft());
    expect(await accounts.softDelete(created.id)).toBe(true);

    expect(await accounts.get(created.id)).toBeUndefined();
    expect(await accounts.all()).toHaveLength(0);

    const kept = await accounts.getIncludingDeleted(created.id);
    expect(kept?.deletedAt).toBeGreaterThan(0);
    expect(kept?.openingBalance).toBe(1000);
  });

  it('restores a deleted row', async () => {
    const created = await accounts.create(draft());
    await accounts.softDelete(created.id);

    expect(await accounts.restore(created.id)).toBe(true);
    expect(await accounts.get(created.id)).toMatchObject({name: 'Cash'});
    expect(await accounts.deleted()).toHaveLength(0);
  });

  it('is idempotent', async () => {
    const created = await accounts.create(draft());
    expect(await accounts.softDelete(created.id)).toBe(true);
    expect(await accounts.softDelete(created.id)).toBe(false);
    expect(await accounts.restore(created.id)).toBe(true);
    expect(await accounts.restore(created.id)).toBe(false);
  });

  it('lists deleted rows for the trash view', async () => {
    const keep = await accounts.create(draft({name: 'Keep'}));
    const drop = await accounts.create(draft({name: 'Drop'}));
    await accounts.softDelete(drop.id);

    expect((await accounts.all()).map((a) => a.name)).toEqual(['Keep']);
    expect((await accounts.deleted()).map((a) => a.name)).toEqual(['Drop']);
    expect(keep.deletedAt).toBeNull();
  });
});

describe('bulk operations', () => {
  it('creates many rows with one outbox entry each', async () => {
    const created = await accounts.createMany([
      draft({name: 'Cash'}),
      draft({name: 'Brac Bank'}),
      draft({name: 'CAAB'}),
    ]);

    expect(created).toHaveLength(3);
    expect(await accounts.all()).toHaveLength(3);
    expect(await db.outbox.count()).toBe(3);
  });

  it('soft-deletes and restores many, reporting how many actually changed', async () => {
    const created = await accounts.createMany([
      draft({name: 'A'}),
      draft({name: 'B'}),
      draft({name: 'C'}),
    ]);
    const ids = created.map((a) => a.id);

    expect(await accounts.softDeleteMany([...ids, 'missing'])).toBe(3);
    expect(await accounts.all()).toHaveLength(0);

    expect(await accounts.restoreMany(ids)).toBe(3);
    expect(await accounts.all()).toHaveLength(3);
  });
});

describe('purge', () => {
  it('removes a row permanently and does not queue it for push', async () => {
    const created = await accounts.create(draft());
    await accounts.softDelete(created.id);
    await db.outbox.clear();

    await accounts.purge(created.id);

    expect(await accounts.getIncludingDeleted(created.id)).toBeUndefined();
    // Purging is local-only; there is no tombstone protocol to express it.
    expect(await db.outbox.count()).toBe(0);
  });
});
