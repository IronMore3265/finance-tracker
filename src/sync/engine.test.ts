// Patches indexedDB onto globalThis so Dexie runs under Node.
import 'fake-indexeddb/auto';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {createTestDatabase, type FinanceDatabase} from '../db/db';
import {getMeta, setMeta} from '../db/meta';
import {createRepository} from '../db/repo';
import type {Account, SyncedTable, SyncMeta} from '../db/types';
import {
  LAST_SYNCED_AT_KEY,
  SYNC_USER_KEY,
  SyncAccountMismatchError,
  cursorKey,
  remoteWins,
  runSync,
} from './engine';
import type {PullCursor, SyncRemote} from './remote';

const USER = 'user-a';
const OTHER_USER = 'user-b';

/**
 * The server, in memory.
 *
 * Implements the same ordering and keyset contract the Supabase gateway does,
 * so the engine's paging, cursors and conflict resolution are exercised for
 * real — the only thing missing is PostgREST. Two databases sharing one of
 * these is two devices sharing one account, which is what the interesting
 * cases need.
 */
class FakeRemote implements SyncRemote {
  readonly tables = new Map<SyncedTable, Map<string, SyncMeta>>();
  readonly pushed: {table: SyncedTable; count: number}[] = [];
  /** Set to fail the next push, to test that the outbox survives it. */
  failNextPush: string | null = null;

  /**
   * Ownership is bound per connection, exactly as `createSupabaseRemote`
   * binds it — the engine hands over local rows, whose `userId` is still null
   * until they have been pushed once.
   */
  constructor(private readonly userId: string = USER) {}

  private store(table: SyncedTable): Map<string, SyncMeta> {
    let rows = this.tables.get(table);
    if (!rows) {
      rows = new Map();
      this.tables.set(table, rows);
    }
    return rows;
  }

  seed(table: SyncedTable, rows: readonly SyncMeta[]): void {
    for (const row of rows) this.store(table).set(row.id, {...row});
  }

  rows(table: SyncedTable): SyncMeta[] {
    return [...this.store(table).values()];
  }

  async push(table: SyncedTable, rows: readonly SyncMeta[]): Promise<void> {
    if (this.failNextPush !== null) {
      const message = this.failNextPush;
      this.failNextPush = null;
      throw new Error(message);
    }

    this.pushed.push({table, count: rows.length});

    for (const row of rows) {
      const store = this.store(table);
      const existing = store.get(row.id);
      // Models the `reject_stale_write` trigger. Without it this fake would
      // let an older offline edit overwrite a newer server row, which is the
      // one thing the server is there to prevent — and the tests below would
      // pass against a server that does not behave like the real one.
      if (existing && row.updatedAt <= existing.updatedAt) continue;
      store.set(row.id, {...row, userId: this.userId});
    }
  }

  async pull(
    table: SyncedTable,
    after: PullCursor | null,
    limit: number,
  ): Promise<SyncMeta[]> {
    const ordered = this.rows(table).sort(
      (a, b) => a.updatedAt - b.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );

    const remaining = after
      ? ordered.filter(
          (row) =>
            row.updatedAt > after.updatedAt ||
            (row.updatedAt === after.updatedAt && row.id > after.id),
        )
      : ordered;

    return remaining.slice(0, limit).map((row) => ({...row}));
  }
}

let db: FinanceDatabase;
let remote: FakeRemote;
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

/** A remote account row, as the server would hold it. */
const remoteAccount = (overrides: Partial<Account> = {}): Account => ({
  id: 'acct-remote',
  createdAt: 1_000,
  updatedAt: 5_000,
  deletedAt: null,
  userId: USER,
  ...draft({name: 'Brac Bank'}),
  ...overrides,
});

function freshDatabase(): FinanceDatabase {
  return createTestDatabase(`sync-${(dbCount += 1)}-${Date.now()}`);
}

beforeEach(async () => {
  db = freshDatabase();
  await db.open();
  accounts = createRepository<Account>('accounts', db);
  remote = new FakeRemote();
});

afterEach(async () => {
  db.close();
});

const sync = (database: FinanceDatabase = db, userId = USER, pageSize?: number) =>
  runSync({
    remote,
    userId,
    database,
    ...(pageSize === undefined ? {} : {pageSize}),
  });

describe('remoteWins', () => {
  const at = (updatedAt: number): SyncMeta => ({
    id: 'x',
    createdAt: 0,
    updatedAt,
    deletedAt: null,
    userId: null,
  });

  it('takes a row that is not here yet', () => {
    expect(remoteWins(undefined, at(1))).toBe(true);
  });

  it('takes a strictly newer row', () => {
    expect(remoteWins(at(1), at(2))).toBe(true);
  });

  it('keeps a strictly newer local row', () => {
    expect(remoteWins(at(2), at(1))).toBe(false);
  });

  it('keeps the local row on a tie, so the pair converges', () => {
    expect(remoteWins(at(2), at(2))).toBe(false);
  });
});

describe('push', () => {
  it('sends queued rows and clears the queue', async () => {
    const created = await accounts.create(draft());

    const result = await sync();

    expect(result.pushed).toBe(1);
    expect(remote.rows('accounts')).toHaveLength(1);
    expect(remote.rows('accounts')[0]).toMatchObject({id: created.id, name: 'Cash'});
    expect(await db.outbox.count()).toBe(0);
  });

  it('collapses repeated edits into one push', async () => {
    const created = await accounts.create(draft());
    await accounts.update(created.id, {name: 'Wallet'});
    await accounts.update(created.id, {name: 'Pocket'});

    const result = await sync();

    expect(result.pushed).toBe(1);
    expect(remote.rows('accounts')[0]).toMatchObject({name: 'Pocket'});
  });

  it('stamps the account on the local row without marking it changed', async () => {
    const created = await accounts.create(draft());
    expect(created.userId).toBeNull();

    await sync();
    const stored = await db.accounts.get(created.id);

    expect(stored?.userId).toBe(USER);
    // The whole point: stamping must not look like an edit, or the row would
    // re-queue itself on every cycle and sync would never settle.
    expect(stored?.updatedAt).toBe(created.updatedAt);
    expect(await db.outbox.count()).toBe(0);
  });

  it('replicates a soft delete as an ordinary field', async () => {
    const created = await accounts.create(draft());
    await sync();
    await accounts.softDelete(created.id);
    await sync();

    expect(remote.rows('accounts')[0]?.deletedAt).toEqual(expect.any(Number));
  });

  it('keeps the queue when the push fails', async () => {
    await accounts.create(draft());
    remote.failNextPush = 'offline';

    await expect(sync()).rejects.toThrow('offline');
    expect(await db.outbox.count()).toBe(1);
    expect(remote.rows('accounts')).toHaveLength(0);
  });

  it('drops the entry for a row purged after it was queued', async () => {
    const created = await accounts.create(draft());
    await accounts.softDelete(created.id);
    await accounts.purge(created.id);

    const result = await sync();

    expect(result.pushed).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it('does not clear an entry re-queued while the push was in flight', async () => {
    const created = await accounts.create(draft({name: 'Cash'}));

    // The row is edited while the request is out. The entry the pusher read
    // is no longer the entry in the queue by the time it comes back, so the
    // edit must survive to be sent next cycle rather than being marked done.
    const send = remote.push.bind(remote);
    remote.push = async (table, rows) => {
      await send(table, rows);
      await accounts.update(created.id, {name: 'Edited mid-flight'});
    };

    await sync();

    expect(await db.outbox.count()).toBe(1);
    expect(remote.rows('accounts')[0]).toMatchObject({name: 'Cash'});

    remote.push = send;
    await sync();

    expect(await db.outbox.count()).toBe(0);
    expect(remote.rows('accounts')[0]).toMatchObject({name: 'Edited mid-flight'});
  });
});

describe('pull', () => {
  it('writes rows that are not here yet', async () => {
    remote.seed('accounts', [remoteAccount()]);

    const result = await sync();

    expect(result).toMatchObject({pulled: 1, applied: 1});
    expect((await db.accounts.get('acct-remote'))?.name).toBe('Brac Bank');
  });

  it('does not queue what it pulled', async () => {
    remote.seed('accounts', [remoteAccount()]);

    await sync();

    // The failure this guards against is an infinite loop: a pulled row that
    // enqueues is pushed back, which changes nothing but never stops.
    expect(await db.outbox.count()).toBe(0);
  });

  it('advances the cursor so a second cycle pulls nothing', async () => {
    remote.seed('accounts', [remoteAccount()]);
    await sync();

    const second = await sync();

    expect(second.pulled).toBe(0);
    expect(await getMeta<PullCursor>(cursorKey('accounts'), db)).toEqual({
      updatedAt: 5_000,
      id: 'acct-remote',
    });
  });

  it('lets a newer remote row replace an older local one', async () => {
    const created = await accounts.create(draft({name: 'Cash'}));
    await sync();
    remote.seed('accounts', [
      {...remote.rows('accounts')[0], name: 'Renamed elsewhere', updatedAt: Date.now() + 10_000} as Account,
    ]);

    const result = await sync();

    expect(result.applied).toBe(1);
    expect((await db.accounts.get(created.id))?.name).toBe('Renamed elsewhere');
  });

  it('keeps a newer local row against an older remote one', async () => {
    remote.seed('accounts', [remoteAccount({updatedAt: 1})]);
    await accounts.create(draft({id: 'acct-remote', name: 'Local wins'} as Partial<Account>));

    const result = await sync();

    expect(result.applied).toBe(0);
    expect((await db.accounts.get('acct-remote'))?.name).toBe('Local wins');
  });

  it('pages without skipping rows that share an updatedAt', async () => {
    // The reason the cursor is a keyset rather than a timestamp. `createMany`
    // stamps a whole batch with one millisecond, so a page boundary landing
    // inside that batch is the normal case, not a corner one.
    const tied = Array.from({length: 7}, (_, index) => ({
      ...remoteAccount({updatedAt: 4_000}),
      id: `acct-${index}`,
    }));
    remote.seed('accounts', tied);

    const result = await sync(db, USER, 2);

    expect(result.pulled).toBe(7);
    expect(await db.accounts.count()).toBe(7);
  });
});

describe('account stamping', () => {
  it('records the account on first sync', async () => {
    await sync();
    expect(await getMeta<string>(SYNC_USER_KEY, db)).toBe(USER);
  });

  it('refuses to sync data belonging to a different account', async () => {
    await accounts.create(draft());
    await sync();

    await expect(sync(db, OTHER_USER)).rejects.toThrow(SyncAccountMismatchError);
    // Nothing leaked into the other account.
    expect(remote.rows('accounts').every((row) => row.userId === USER)).toBe(true);
  });

  it('records when the cycle finished', async () => {
    const before = Date.now();
    const result = await sync();

    expect(result.finishedAt).toBeGreaterThanOrEqual(before);
    expect(await getMeta<number>(LAST_SYNCED_AT_KEY, db)).toBe(result.finishedAt);
  });

  it('starts over when the sync state is cleared', async () => {
    remote.seed('accounts', [remoteAccount()]);
    await sync();
    await db.meta.clear();

    const result = await sync();

    expect(result.pulled).toBe(1);
    // Pulled again, but the local copy is not older, so nothing is rewritten.
    expect(result.applied).toBe(0);
  });
});

describe('two devices, both offline', () => {
  let other: FinanceDatabase;
  let otherAccounts: ReturnType<typeof createRepository<Account>>;

  beforeEach(async () => {
    other = freshDatabase();
    await other.open();
    otherAccounts = createRepository<Account>('accounts', other);
  });

  afterEach(() => {
    other.close();
  });

  it('converges on the later edit, whichever device syncs first', async () => {
    // Both devices start from the same synced row.
    const created = await accounts.create(draft({name: 'Cash'}));
    await sync();
    await sync(other);
    expect((await other.accounts.get(created.id))?.name).toBe('Cash');

    // Both go offline and edit it. The second edit is the later one.
    await accounts.update(created.id, {name: 'Edited on A'});
    await new Promise((resolve) => setTimeout(resolve, 2));
    await otherAccounts.update(created.id, {name: 'Edited on B'});

    // Device B reconnects first, then A — so the *older* edit is the one that
    // arrives last, which is the case a naive "last push wins" gets wrong.
    await sync(other);
    await sync();
    // And once more each, to let the resolution propagate back.
    await sync(other);
    await sync();

    expect((await db.accounts.get(created.id))?.name).toBe('Edited on B');
    expect((await other.accounts.get(created.id))?.name).toBe('Edited on B');
    expect(remote.rows('accounts')[0]).toMatchObject({name: 'Edited on B'});
  });

  it('settles: a further cycle on either device changes nothing', async () => {
    const created = await accounts.create(draft());
    await sync();
    await sync(other);
    await otherAccounts.update(created.id, {name: 'Elsewhere'});
    await sync(other);
    await sync();

    const quiet = await sync();
    const quietOther = await sync(other);

    expect(quiet).toMatchObject({pushed: 0, applied: 0});
    expect(quietOther).toMatchObject({pushed: 0, applied: 0});
    expect(await db.outbox.count()).toBe(0);
    expect(await other.outbox.count()).toBe(0);
  });

  it('replicates a delete made on the other device', async () => {
    const created = await accounts.create(draft());
    await sync();
    await sync(other);

    await otherAccounts.softDelete(created.id);
    await sync(other);
    await sync();

    expect((await db.accounts.get(created.id))?.deletedAt).toEqual(expect.any(Number));
    // Still present locally — a delete is a field, not a removal, or the next
    // pull from a device that had not heard would resurrect it.
    expect(await db.accounts.count()).toBe(1);
  });

  it('carries a restore back across', async () => {
    const created = await accounts.create(draft());
    await sync();
    await accounts.softDelete(created.id);
    await sync();
    await sync(other);
    expect((await other.accounts.get(created.id))?.deletedAt).toEqual(expect.any(Number));

    await otherAccounts.restore(created.id);
    await sync(other);
    await sync();

    expect((await db.accounts.get(created.id))?.deletedAt).toBeNull();
  });
});

describe('cursors', () => {
  it('resumes from a saved cursor rather than re-reading everything', async () => {
    remote.seed('accounts', [
      remoteAccount({id: 'a', updatedAt: 1_000} as Partial<Account>),
      remoteAccount({id: 'b', updatedAt: 2_000} as Partial<Account>),
    ]);
    await setMeta(cursorKey('accounts'), {updatedAt: 1_000, id: 'a'}, db);

    const result = await sync();

    expect(result.pulled).toBe(1);
    expect(await db.accounts.get('a')).toBeUndefined();
    expect(await db.accounts.get('b')).toBeDefined();
  });
});
