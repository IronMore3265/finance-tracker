/**
 * End-to-end check of the sync layer against a real Supabase project.
 *
 * Deliberately not part of `npm test`: it needs the network, it needs
 * credentials, and it writes to a live database. It exists because the unit
 * tests run against an in-memory fake, so everything the *real* server
 * enforces is precisely what they cannot cover — row-level security, the
 * not-null and check constraints, whether the column names actually match,
 * PostgREST's filter syntax, and the `reject_stale_write` trigger that the
 * whole convergence argument rests on.
 *
 *   npm run test:sync
 *
 * It needs two throwaway accounts, and they have to be made with SQL rather
 * than `signUp`, because Supabase rejects obviously fake email domains and
 * anything it accepts would send mail to a real address. Against a project
 * you own, run:
 *
 *   with new_users as (
 *     select * from (values
 *       ('e2e-primary@finance-tracker.test'),
 *       ('e2e-intruder@finance-tracker.test')
 *     ) as t(email)
 *   ), inserted as (
 *     insert into auth.users (
 *       instance_id, id, aud, role, email, encrypted_password,
 *       email_confirmed_at, created_at, updated_at,
 *       raw_app_meta_data, raw_user_meta_data,
 *       -- GoTrue scans these into non-nullable Go strings, so leaving them
 *       -- NULL fails every sign-in with "Database error querying schema".
 *       confirmation_token, recovery_token, email_change_token_new,
 *       email_change_token_current, email_change, phone_change,
 *       phone_change_token, reauthentication_token
 *     )
 *     select '00000000-0000-0000-0000-000000000000',
 *       extensions.gen_random_uuid(), 'authenticated', 'authenticated', email,
 *       extensions.crypt('<the password>', extensions.gen_salt('bf')),
 *       now(), now(), now(),
 *       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
 *       '', '', '', '', '', '', '', ''
 *     from new_users returning id, email
 *   )
 *   insert into auth.identities
 *     (provider_id, user_id, identity_data, provider,
 *      last_sign_in_at, created_at, updated_at)
 *   select id, id,
 *     jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true),
 *     'email', now(), now(), now()
 *   from inserted;
 *
 * Deleting them afterwards (`delete from auth.users where email like
 * 'e2e-%@finance-tracker.test'`) takes their rows with it, since every table
 * cascades from `auth.users`.
 *
 * The run clears the primary account's rows before it starts, so it is safe to
 * repeat — and it must never be pointed at an account holding real data.
 */
import 'fake-indexeddb/auto';
import {createClient} from '@supabase/supabase-js';
import {createTestDatabase} from '../src/db/db';
import {createRepository} from '../src/db/repo';
import {runSync} from '../src/sync/engine';
import {createSupabaseRemote} from '../src/sync/remote';
import type {
  Account,
  Budget,
  Category,
  Debt,
  DebtPayment,
  PlannedException,
  PlannedTransaction,
  Transaction,
} from '../src/db/types';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(
      `${name} is not set. This script needs a Supabase project and two ` +
        'throwaway accounts; see the comment at the top of this file.',
    );
    process.exit(2);
  }
  return value;
}

// `vite-node` loads .env for VITE_-prefixed variables; the credentials for the
// test accounts are separate, and deliberately not in .env.example — a fork
// has no reason to hold them.
const URL = required('VITE_SUPABASE_URL');
const KEY = required('VITE_SUPABASE_PUBLISHABLE_KEY');
const PASSWORD = required('E2E_PASSWORD');
const PRIMARY = process.env['E2E_PRIMARY_EMAIL'] ?? 'e2e-primary@finance-tracker.test';
const INTRUDER = process.env['E2E_INTRUDER_EMAIL'] ?? 'e2e-intruder@finance-tracker.test';

let failures = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function signIn(email: string) {
  const client = createClient(URL, KEY, {auth: {persistSession: false}});
  const {data, error} = await client.auth.signInWithPassword({email, password: PASSWORD});
  if (error) throw new Error(`sign in as ${email}: ${error.message}`);
  return {client, userId: data.user!.id};
}

function device(name: string) {
  const db = createTestDatabase(`e2e-${name}-${Date.now()}`);
  return {
    db,
    accounts: createRepository<Account>('accounts', db),
    categories: createRepository<Category>('categories', db),
    transactions: createRepository<Transaction>('transactions', db),
    planned: createRepository<PlannedTransaction>('plannedTransactions', db),
    exceptions: createRepository<PlannedException>('plannedExceptions', db),
    debts: createRepository<Debt>('debts', db),
    payments: createRepository<DebtPayment>('debtPayments', db),
    budgets: createRepository<Budget>('budgets', db),
  };
}

const REMOTE_TABLES = [
  'accounts', 'categories', 'transactions', 'planned_transactions',
  'planned_exceptions', 'debts', 'debt_payments', 'budgets',
];

async function main() {
  const primary = await signIn(PRIMARY);
  const remote = createSupabaseRemote(primary.client, primary.userId);

  // Start from an empty server, so a second run is not measuring the first
  // one's rows. Doubles as a check that the delete policy works.
  console.log('clearing the test account');
  for (const table of REMOTE_TABLES) {
    const {error} = await primary.client.from(table).delete().eq('user_id', primary.userId);
    if (error) throw new Error(`clearing ${table}: ${error.message}`);
  }

  // ---- Device A: one row in every table, every column populated ----------
  console.log('\npush: every table, every column');
  const a = device('a');
  await a.db.open();

  const cash = await a.accounts.create({
    name: 'Cash', openingBalance: 1234.56, colorHex: '#2196F3', icon: 'wallet',
    currency: 'BDT', includeInBalance: true, displayOrder: 0,
  });
  const food = await a.categories.create({
    name: 'Food', icon: 'utensils', colorHex: '#EA3B35', kind: 'EXPENSE',
    displayOrder: 1, isDefault: true,
  });
  const rule = await a.planned.create({
    title: 'Rent', amount: 15000, categoryId: food.id, type: 'EXPENSE',
    accountId: cash.id, startDate: Date.UTC(2026, 0, 1), intervalType: 'MONTH',
    intervalN: 1, oneTime: false, nextDueDate: Date.UTC(2026, 8, 1),
    endDate: null, isActive: true, description: 'Flat',
  });
  await a.exceptions.create({
    plannedId: rule.id, occurrenceDate: Date.UTC(2026, 8, 1), action: 'OVERRIDE',
    overrides: {amount: 16000, description: 'Went up'},
  });
  const lunch = await a.transactions.create({
    amount: 349.75, description: 'Lunch', categoryId: food.id,
    date: Date.UTC(2026, 7, 17, 12, 30, 0, 123), type: 'EXPENSE',
    accountId: cash.id, toAccountId: null, tags: ['work', 'reimbursable'],
    plannedId: null, occurrenceDate: null,
  });
  const debt = await a.debts.create({
    personName: 'Nabil', amount: 2000, description: 'Books',
    date: Date.UTC(2026, 6, 1), dueDate: Date.UTC(2026, 9, 1), type: 'DUE',
    isCleared: false, accountId: cash.id,
  });
  await a.payments.create({
    debtId: debt.id, amount: 500, date: Date.UTC(2026, 7, 1), transactionId: null,
  });
  await a.budgets.create({
    categoryId: food.id, amount: 30000, period: 'MONTH',
    startDate: Date.UTC(2026, 7, 1), endDate: null, isActive: true,
  });

  const pushed = await runSync({remote, userId: primary.userId, database: a.db});
  check('pushed all eight rows', pushed.pushed === 8, `pushed ${pushed.pushed}`);
  check('outbox drained', (await a.db.outbox.count()) === 0);
  check('userId stamped locally', (await a.db.accounts.get(cash.id))?.userId === primary.userId);
  check(
    'stamping did not re-dirty the row',
    (await a.db.accounts.get(cash.id))?.updatedAt === cash.updatedAt,
  );

  // ---- Device B: pull it all back ---------------------------------------
  console.log('\npull: a second device sees everything');
  const b = device('b');
  await b.db.open();
  const pulledB = await runSync({remote, userId: primary.userId, database: b.db});
  check('pulled all eight rows', pulledB.pulled === 8, `pulled ${pulledB.pulled}`);
  check('applied all eight', pulledB.applied === 8);

  const lunchB = await b.db.transactions.get(lunch.id);
  check('millisecond precision survived', lunchB?.date === lunch.date,
    `${String(lunchB?.date)} vs ${String(lunch.date)}`);
  check('amount survived', lunchB?.amount === 349.75);
  check('text[] survived', JSON.stringify(lunchB?.tags) === '["work","reimbursable"]');
  check('null column stayed null', lunchB?.toAccountId === null);
  const exceptionB = (await b.db.plannedExceptions.toArray())[0];
  check('jsonb blob survived',
    JSON.stringify(exceptionB?.overrides) === '{"amount":16000,"description":"Went up"}');
  const debtB = await b.db.debts.get(debt.id);
  check('nullable timestamp survived', debtB?.dueDate === Date.UTC(2026, 9, 1));
  check('boolean survived', debtB?.isCleared === false);

  console.log('\npull: a second cycle is quiet');
  const quiet = await runSync({remote, userId: primary.userId, database: b.db});
  check('cursor stopped it re-reading', quiet.pulled === 0, `pulled ${quiet.pulled}`);

  // ---- The trigger: an older edit must not win --------------------------
  console.log('\nreject_stale_write: the older offline edit loses');
  await a.accounts.update(cash.id, {name: 'Edited on A'});
  await new Promise((r) => setTimeout(r, 5));
  await b.accounts.update(cash.id, {name: 'Edited on B (later)'});

  // B reconnects first, so the *newer* edit reaches the server first and the
  // older one arrives last — the case an unconditional upsert gets wrong.
  await runSync({remote, userId: primary.userId, database: b.db});
  await runSync({remote, userId: primary.userId, database: a.db});

  const {data: serverRow} = await primary.client
    .from('accounts').select('name').eq('id', cash.id).single();
  check('server kept the newer edit', serverRow?.name === 'Edited on B (later)',
    `server has ${JSON.stringify(serverRow?.name)}`);
  check('device A took the newer edit',
    (await a.db.accounts.get(cash.id))?.name === 'Edited on B (later)',
    `A has ${JSON.stringify((await a.db.accounts.get(cash.id))?.name)}`);

  await runSync({remote, userId: primary.userId, database: b.db});
  check('device B unchanged, so both converged',
    (await b.db.accounts.get(cash.id))?.name === 'Edited on B (later)');

  // ---- Soft delete replicates -------------------------------------------
  console.log('\nsoft delete replicates as a field');
  await b.accounts.softDelete(cash.id);
  await runSync({remote, userId: primary.userId, database: b.db});
  await runSync({remote, userId: primary.userId, database: a.db});
  check('delete arrived on A', (await a.db.accounts.get(cash.id))?.deletedAt !== null);
  check('row still present, not removed', (await a.db.accounts.count()) === 1);

  // ---- Paging across a tie ----------------------------------------------
  console.log('\nkeyset paging across rows sharing one updatedAt');
  const many = await a.categories.createMany(
    Array.from({length: 12}, (_, i) => ({
      name: `Bulk ${i}`, icon: 'tag', colorHex: '#888888',
      kind: 'EXPENSE' as const, displayOrder: i + 10, isDefault: false,
    })),
  );
  const stamps = new Set(many.map((row) => row.updatedAt));
  check('createMany really does tie their timestamps', stamps.size === 1,
    `${stamps.size} distinct`);
  await runSync({remote, userId: primary.userId, database: a.db});

  const c = device('c');
  await c.db.open();
  const pagedIn = await runSync({remote, userId: primary.userId, database: c.db, pageSize: 5});
  check('paging skipped nothing', (await c.db.categories.count()) === 13,
    `${await c.db.categories.count()} categories, pulled ${pagedIn.pulled}`);

  // ---- RLS ---------------------------------------------------------------
  console.log('\nRLS: another account sees nothing');
  const intruder = await signIn(INTRUDER);
  const {data: leaked, error: leakError} = await intruder.client.from('accounts').select('*');
  check('select returns no rows', (leaked?.length ?? -1) === 0,
    leakError ? leakError.message : `${String(leaked?.length)} rows visible`);

  const {error: writeError} = await intruder.client.from('accounts').upsert([{
    id: cash.id, user_id: primary.userId, created_at: new Date().toISOString(),
    updated_at: new Date(Date.now() + 60_000).toISOString(), deleted_at: null,
    name: 'Stolen', opening_balance: 0, color_hex: '#000000', icon: 'wallet',
    currency: 'BDT', include_in_balance: true, display_order: 0,
  }]);
  check('writing someone else\'s row is rejected', writeError !== null,
    writeError ? '' : 'the upsert succeeded');

  const {data: stillMine} = await primary.client
    .from('accounts').select('name').eq('id', cash.id).single();
  check('the row is untouched', stillMine?.name === 'Edited on B (later)');

  // RLS filtering is not an error condition: with no policy for `anon` the
  // rows simply are not there, so PostgREST answers 200 with an empty array.
  // Asserting on the error would pass for the wrong reason the day a policy
  // was widened, so this asserts on the rows.
  const {data: anonRows, error: anonError} = await createClient(URL, KEY)
    .from('accounts').select('*');
  check('a signed-out client sees no rows', (anonRows?.length ?? -1) === 0,
    anonError ? anonError.message : `${String(anonRows?.length)} rows visible`);

  const {error: anonWriteError} = await createClient(URL, KEY).from('accounts').insert([{
    id: '00000000-0000-4000-8000-00000000dead', user_id: primary.userId,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    deleted_at: null, name: 'Anon', opening_balance: 0, color_hex: '#000000',
    icon: 'wallet', currency: 'BDT', include_in_balance: true, display_order: 0,
  }]);
  check('a signed-out client cannot write', anonWriteError !== null,
    anonWriteError ? '' : 'the anonymous insert succeeded');

  a.db.close();
  b.db.close();
  c.db.close();

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} CHECK(S) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error('\nThrew:', error);
  process.exit(1);
});
