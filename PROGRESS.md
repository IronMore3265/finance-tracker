# Project state & roadmap

Handoff document. Read this first — it carries everything a fresh session needs
so the research below never has to be repeated.

**Last updated:** 2026-08-18 · Phases 0–7 complete.

---

## 1. What this is and why

A personal finance tracker replacing [nabil24024004/expense-tracker](https://github.com/nabil24024004/expense-tracker),
a **Kotlin / Jetpack Compose Android app** (Room schema v4, MVVM). Because the
source is Kotlin, this is a **ground-up rewrite in a web stack** — only the
domain model and feature set carry over.

Three problems drove the rewrite:

1. **Android-only, no sync.** Data trapped on one phone.
2. **Missing / broken features.** Root-caused, not guessed: the old
   `MainViewModel.kt` exposes `addExpense` and `deleteExpense` but **no
   `updateExpense`**, and `addDebtDue`/`deleteDebtDue` with no update either.
   Accounts and planned transactions *do* have update methods. So transactions
   and debts — the most-used entities — are literally un-editable; delete and
   re-enter is the only path. Also missing: per-category budgets (one global
   budget period only) and real analytics (a single 7-day line chart).
3. **UI/UX and performance.**

---

## 2. Locked decisions

| Area | Choice | Note |
|---|---|---|
| UI system | Astryx `0.4.3` | Meta, **pre-1.0 — expect API churn** |
| Framework | React 19 + TypeScript 7 | React 19 is a hard Astryx requirement |
| Build | Vite 8 + Tailwind v4 | Astryx needs **no** Vite/PostCSS/Babel plugin |
| Animation | Motion 13 (`motion/react`) | Astryx ships motion *tokens* only, no engine |
| Local store | Dexie 4 (IndexedDB) | Source of truth, offline-first |
| Sync | Supabase `lwcelvtqpfvssxkabvun` | Live, Postgres 17, ap-northeast-2, **8 tables + RLS** |
| Auth | Email/password, single user, RLS on `user_id` | Sync **opt-in**; app must work logged-out |
| Charts | visx + Motion | Chosen over Recharts for design control |
| Android | Capacitor 8 | |
| Desktop | Tauri 2 | Needs Rust toolchain to build; zero Rust written |
| Migration | In-app `.xls` importer, SheetJS from the CDN tarball | See §5, Phase 6 |

---

## 3. Verified Astryx facts

Hard-won; do not re-derive. Supabase's equivalents are at the end of this
section.

- **Discover, don't guess.** `npx astryx component <Name>` prints exact props.
  `npx astryx build "<idea>"`, `astryx template --list`, `astryx docs <topic>`.
  `npx astryx doctor` validates wiring (currently 6 passed / 0 warnings).
- **CSS import order is load-bearing** — see [src/styles/global.css](src/styles/global.css).
  It maps onto the layer cascade; reordering breaks theming *silently* rather
  than erroring.
- **`data-astryx-theme` on `<html>`** is required or theme CSS silently no-ops.
- **The theme names Figtree but never loads it.** Self-hosted rather than pulled
  from Google Fonts, because the app must work offline inside Capacitor/Tauri.

  **The `@font-face` rules in [global.css](src/styles/global.css) are written by
  hand on purpose — do not replace them with an `@import` of the fontsource
  package.** `@fontsource-variable/figtree` declares its family as
  `'Figtree Variable'`, which never matches the plain `Figtree` the theme asks
  for: the webfont downloads successfully and is then silently ignored in favour
  of the system fallback (Segoe UI on Windows). This cost a debugging round,
  because *every surface check still passes* — the woff2 files are bundled,
  `@font-face` blocks exist, and the string "Figtree" appears in the CSS either
  way. Declaring the family ourselves is what makes the font reachable.

  Variable (300–900 in one file, ~30KB) is used in preference to four static
  weights (~45KB) so any weight is available at any breakpoint without another
  download. The theme currently resolves to 400/500/600/700 only
  (`--font-weight-normal`/`medium`/`semibold`/`bold`), so the extra range is
  latent capability, not something the UI exercises yet — realising it needs
  typography token overrides via `defineTheme`.

  **Verify after any font change:** the built CSS must contain
  `font-family:Figtree` (2 blocks, `font-weight:300 900`) and **zero**
  occurrences of `Figtree Variable`.
- **`<Theme mode>` already handles light/dark/system.** Don't hand-roll dark
  mode; [theme-mode.tsx](src/app/theme-mode.tsx) only persists the preference.
- **Motion tokens** (read at runtime in [motion.ts](src/app/motion.ts), never hardcoded):
  `--duration-fast: 125ms`, `--duration-medium: 300ms`, `--duration-slow: 700ms`,
  `--ease-standard: cubic-bezier(0.24, 1, 0.4, 1)`.
- **Tailwind bridge**: `@astryxdesign/core/tailwind-theme.css` maps tokens onto
  utilities (`bg-surface`, `text-primary`, `rounded-lg`). Use these — never
  hand-write `bg-[var(--color-background-surface)]` or raw hex/px.
- **No raw `<div>`/`<span>` for layout** (per `AGENTS.md`). Use `Stack`, `HStack`,
  `VStack`, `Layout`. See §7 for the open tension with Motion.
- **Do NOT use `@astryxdesign/charts`.** It is canary-only and forces
  `@astryxdesign/core@canary`, destabilising the whole UI. Revisit only if it
  reaches the `latest` dist-tag.
- **SVG marks take Tailwind `fill-*` / `stroke-*` classes, never JS colour
  values.** `fill` and `stroke` are CSS properties, so
  `className="fill-success"` resolves through the token live and the charts
  re-theme on a light/dark switch with no prop, no re-render and no second
  palette. Reading the tokens into JS the way [motion.ts](src/app/motion.ts)
  reads the duration tokens would **not** work: durations are fixed for the
  life of the document, colours change the moment the user flips the theme.
  Write the class names out as literals — Tailwind discovers utilities by
  scanning source text, so a composed `` `fill-${hue}` `` is never emitted and
  the mark renders with no fill at all.
- **The `--color-<hue>-ring` / `-vivid` Tailwind aliases are not usable for
  chart marks.** `tailwind-theme.css` bridges only the `background` / `border`
  / `text` variant of each hue, and deliberately omits the `icon` one. The
  bridged `border-*` values are stepped for borders, not for marks on a
  surface: `--color-border-orange` is `#EB6E00` in light and *darker* at
  `#B34A01` in dark, which is backwards for a dark background. The `icon-*`
  tokens are the correctly stepped ones and are reachable only as raw
  `var(--color-icon-*)`. Phase 4 sidestepped this by not needing eight
  categorical hues at all — see §6.

---

### Verified Supabase facts

Same rule: hard-won, do not re-derive. All of these were confirmed against the
live project by `npm run test:sync`, not reasoned about.

- **The push must be arbitrated by the server, or two devices never converge.**
  A plain upsert is "last request in wins", which is not the same as
  "last edit wins". The device holding the *older* offline edit reconnecting
  second overwrites the newer row; it then pulls its own row back and ties, and
  the other device's cursor is already past that timestamp so it never hears
  about the overwrite. Both sides are then permanently divergent with no event
  that would fix it. The `reject_stale_write` BEFORE UPDATE trigger returns
  `null` for any row whose `updated_at` is not strictly newer, which makes the
  stale push a no-op; the pull that follows *in the same cycle* then hands that
  device the winning version. **This is load-bearing — the client-side
  `remoteWins` check alone is not enough.**
- **Pull cursors must be a keyset `(updated_at, id)`, not a timestamp.**
  `createMany` stamps a whole batch with one millisecond, so page boundaries
  landing inside a tie are the normal case. A `updated_at > last` cursor
  silently skips the remainder of the tie. PostgREST has no row constructor, so
  it is spelled out:
  `or(updated_at.gt."T",and(updated_at.eq."T",id.gt."ID"))`.
- **No foreign keys between the eight tables, on purpose.** The client
  tolerates dangling references by design (a transaction whose account was
  deleted survives and drops out of balances). Enforcing them server-side would
  reject pushes for states the app deliberately allows and make push order
  load-bearing. The only FK is `user_id -> auth.users`, which cascades.
- **No `updated_at` trigger.** The obvious Postgres reflex — stamp `now()` on
  write — would destroy the field last-write-wins compares on.
- **`timestamptz` round-trips epoch milliseconds losslessly.**
  `Date.parse(new Date(ms).toISOString())` returns `ms`, and PostgREST renders
  with a `+00:00` offset and sometimes microsecond precision, both of which
  `Date.parse` handles. Chosen over `bigint` so the dashboard is readable when
  sync misbehaves, which is the only time anyone looks.
- **Write RLS policies as `(select auth.uid()) = user_id`.** The subquery form
  is evaluated once per statement rather than once per row; a bare `auth.uid()`
  trips a performance advisory.
- **RLS filtering is not an error.** A signed-out client reading a protected
  table gets `200` and `[]`, not a failure. Assert on row count — asserting on
  `error !== null` passes for the wrong reason.
- **A hand-made `auth.users` row must have empty strings, not NULL**, in
  `confirmation_token`, `recovery_token`, `email_change_token_new`,
  `email_change_token_current`, `email_change`, `phone_change`,
  `phone_change_token` and `reauthentication_token`. GoTrue scans them into
  non-nullable Go strings, so a NULL fails every sign-in with the thoroughly
  unhelpful "Database error querying schema". Needed because Supabase rejects
  obviously fake email domains (`@example.com`) at signup, and anything it
  accepts would mail a real person.
- **Use the `sb_publishable_...` key, not the legacy anon JWT.** Both work;
  only the publishable one rotates independently.

---

## 4. Data model

Every table carries `id` (**UUIDv7**, time-sortable), `createdAt`, `updatedAt`,
`deletedAt`, `userId`. These three are what make sync addable **without a
migration** — never drop them. Full definitions: [src/db/types.ts](src/db/types.ts).

Tables: `accounts`, `categories`, `transactions`, `plannedTransactions`,
`plannedExceptions`, `debts`, `debtPayments`, `budgets`, plus device-local
`outbox` and `meta`.

### Three deliberate corrections to the old schema

1. **Balances are derived, never stored.** The old app mutated a denormalized
   `balance` per write, so any failed/partial write desynced it from the ledger
   permanently. Accounts store `openingBalance`; current balance is a pure
   function of the ledger ([balances.ts](src/domain/balances.ts)). Cannot drift;
   a bad sync merge is repaired by recomputing.
2. **Categories are a real table**, not a bare string — required for
   per-category budgets and rename/recolor/merge.
3. **`isSynced` / `sheetRow` dropped** — vestigial Google Sheets fields.

### IndexedDB constraint worth remembering

IndexedDB keys may only be number, string, Date, ArrayBuffer, or Array.
**Booleans and `null` are not valid keys** — a row holding one is *silently
omitted* from that index. So `isActive`, `isCleared`, and `deletedAt` are
deliberately unindexed and filtered in memory. Indexing `deletedAt` would have
returned only the *deleted* rows: the exact inverse of what's wanted.

---

## 5. The old app's export format

Parsed from the real file. `migration-data/` is **gitignored** — it holds real
financial data and this repo is public.

The old README claims JSON/CSV export; **it does not exist**. Only `.xls` and
`.pdf`. The `.xls` is **legacy BIFF8 / OLE2** (Apache POI HSSF).

Sheet order in the file is Accounts, Expenses, Debts & Receivables, Planned
Transactions. **The column orders below were corrected in Phase 6** — the
originals here were transcribed wrongly, and are the reason
[parse.ts](src/migration/parse.ts) addresses every column *by header name*. A
positional reader would have swapped every description with its category and
every currency with its icon, and produced an import that looked entirely
plausible.

| Sheet | Columns, in file order |
|---|---|
| Accounts | Name, Balance, ColorHex, Icon, Currency, IncludeInBalance, DisplayOrder |
| Expenses | Date, **Category, Description**, Amount, Type, Account, ToAccount, Tags |
| Debts & Receivables | Date, Person, Type, Description, Amount, Due Date, Status |
| Planned Transactions | Title, Amount, Category, Type, Account, Start Date, Interval Type, Interval N, One Time, Next Due Date, Is Active, Description |

Real values, re-read from the file in Phase 6: accounts `Cash` and `Brac Bank`
— **there is no `CAAB` account**, that string is a debt *description*;
categories `Food`, `Books`, `Gift`, `Movie`, `Transportation`, `Other` and
**`Debt Repayment`**, which the seed list does not have and the importer
therefore creates; icons `wallet`, `card_visa`; colors `#2196F3`, `#EA3B35`;
transaction types `EXPENSE`/`INCOME` only; debt types `DEBT`/`DUE`; debt status
`Pending`/`Settled`; currency is the bare symbol `৳`, not an ISO code; booleans
are the strings `True`/`False`; a missing due date is the string `N/A`; dates
are `YYYY-MM-DD HH:MM:SS` with **no timezone**, so they must be read as local
wall-clock time. **91 transactions**, 2026-06-29 → 2026-08-17, 4 debts, and a
Planned Transactions sheet that is a header with no rows under it.

**Two conventions in the data that the importer depends on:**

- **`Balance` on the Accounts sheet is a *current* balance**, not an opening
  one — it is the denormalized number the old app mutated on every write. See
  Phase 6 for what that means.
- **Settling a debt also writes a ledger row**, an EXPENSE in category `Debt
  Repayment` described `Repaid: {person} ({description})`. All three settled
  debts in the real file have one, matching on amount exactly.

**Four consequences for the importer:**

- `exceljs` **cannot** read BIFF8 (`.xlsx` only). **SheetJS is the only
  practical option.** Install from the official CDN tarball
  (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`) — **not** npm, where
  `xlsx` is abandoned at 0.18.5 with CVE-2023-30533. **Lazy-load it** so ~800kb
  stays out of the main bundle. Check `package.json`: the dependency must stay
  a `https://cdn.sheetjs.com/` URL, because "tidying" it into a semver range
  silently swaps in the vulnerable abandoned package.
- **The export has no stable IDs** — accounts and categories are referenced by
  *name*. The importer must resolve by name and be idempotent.
- The seed category list in [seed.ts](src/db/seed.ts) deliberately matches the
  export's names so import maps onto existing rows instead of duplicating.
- **The `.pdf` is a report, not a second copy of the data** — it holds no
  account, type, or tag columns. Its value is as an *independent* check on the
  `.xls`, which is what `npm run test:import` uses it for. Its own summary line
  is `Transactions Spent:`, which is expenses **and** income added together —
  an old-app quirk, reproduced rather than corrected, because the point is to
  agree with the file. No figure from the real file is quoted anywhere in this
  repo; run `npm run test:import` to see them.

---

## 6. Status

### ✅ Phase 0 — Scaffold
Vite + React 19 + TS 7 + Tailwind v4 + Astryx + Motion + Dexie. `astryx init`
run (`AGENTS.md`). Build: 524kb raw / **159kb gzip**; Figtree bundled as local woff2.

### ✅ Phase 1 — Data layer and domain logic
**88 tests passing, `tsc` clean, `astryx doctor` 6/6.**

- [src/db/types.ts](src/db/types.ts), [db.ts](src/db/db.ts), [repo.ts](src/db/repo.ts),
  [repositories.ts](src/db/repositories.ts), [seed.ts](src/db/seed.ts), [ids.ts](src/db/ids.ts)
- [src/domain/mathEval.ts](src/domain/mathEval.ts) — the `4500 / 3` amount field,
  ported from `MathEvaluator.kt`. Hand-written recursive descent; **never `eval`**.
- [src/domain/balances.ts](src/domain/balances.ts) — derived balances.
- [src/domain/recurrence.ts](src/domain/recurrence.ts) — rules → indexed
  occurrences, with SKIP/OVERRIDE exceptions and series splitting.
- [src/domain/budgets.ts](src/domain/budgets.ts) — per-category budgets,
  payroll-anchored periods.

`repo.ts` makes three things structural rather than remembered, all in one
Dexie transaction: `updatedAt` stamping, outbox enqueueing, soft deletes.

**Two intentional deviations from the old app, both tested:**
- Unclosed parens are an error. `(1+2` returned `3` in the old app; here `null`.
  Silently accepting malformed input into a *money* field is worse.
- `5 5` → `55` is **kept** (whitespace stripped before parsing), matching the old app.

**`purge()` deliberately does not enqueue.** There is no tombstone protocol, so
permanent deletion is local-only and a peer may push the row back. Only purge
rows whose soft delete has already been pushed.

### ✅ Phase 2 — Shell, navigation, route splitting
**88 tests passing, `tsc` clean, `astryx doctor` 6/6, verified in a real browser.**

- [AppFrame.tsx](src/app/AppFrame.tsx) — `AppShell` at the root route, so the
  nav, the Dexie connection and the theme survive every navigation.
- [nav.ts](src/app/nav.ts) — the twelve destinations, defined once. Drives the
  side nav, the mobile drawer and `document.title` from one list.
- [routes.tsx](src/app/routes.tsx) — every screen behind `lazy`, plus the root
  loader, `HydrateFallback` and `ErrorBoundary`.
- [Page.tsx](src/components/Page.tsx), [PhasePlaceholder.tsx](src/components/PhasePlaceholder.tsx),
  [animated.ts](src/components/animated.ts) — the wrappers §7 asks for.
- 12 route stubs in [src/pages/](src/pages/). Every one is meant to be deleted,
  not extended. Settings already carries the real colour-mode control.

**Four things worth not rediscovering:**

1. **AppShell generates the whole mobile story from the `sideNav` slot.** Below
   `md` it moves that exact node into a modal drawer and renders a compact top
   bar with the hamburger — no second nav to keep in sync, and no `TopNav`
   needed. But the drawer is **not** told that a link inside it navigated, so
   uncontrolled it sits open on top of the page the user just picked. It is
   controlled from `AppFrame` and closed on `pathname` change.
2. **`LinkProvider` at the frame root, once.** Astryx link-rendering components
   resolve through `useLinkComponent()`, which falls back to a plain `<a>` —
   a full document load that throws away the Dexie connection. One provider
   replaces it everywhere; [router-link.tsx](src/app/router-link.tsx) exists
   only because Astryx passes `href` and React Router wants `to`.
3. **Never import from the `@astryxdesign/core` barrel** (`Theme`,
   `LinkProvider`): use `/theme` and `/Link`. Measured as neutral today because
   tree-shaking currently copes, but it re-exports all 156 components and is one
   bundler change away from putting the library in the initial chunk.
4. **`initializeDatabase()` runs in the root route's `loader`**, not in
   `main.tsx`. IndexedDB genuinely fails in some real situations (Firefox
   private windows, blocked site data, a corrupt WebView profile); in the loader
   that surfaces in [RouteError.tsx](src/app/RouteError.tsx) as a message, and
   in `main.tsx` it would be an unhandled rejection behind an empty shell.

**Motion/`<div>` tension resolved, and it paid for itself.** `create(Stack)`
animates the Astryx component directly instead of wrapping it in a `motion.div`.
Import `create` from **`motion/react-m`**, never `motion` from `motion/react`:
the full proxy is eagerly wired to layout projection and drag gestures, ~110kb
this app has no use for, which lands in the initial chunk because the frame
animates route changes. `<LazyMotion features={domAnimation} strict>` in
[providers.tsx](src/app/providers.tsx) supplies the features actually used and
makes a stray `motion.div` throw rather than silently re-inflate the bundle.
Worth **46kb raw / 13kb gzip**. Phase 8's shared-element transitions need
projection — widen the feature set there, do not go back to the full proxy.

**`base: '/'` in [vite.config.ts](vite.config.ts) — do not put it back to `'./'`.**
A relative base resolves assets against the *current path*: at `/ledger/abc` the
browser requests `/ledger/assets/index.js`, gets a 404, and renders nothing.
One-segment routes work by luck, so this would have surfaced as a mystery at the
first detail route in Phase 3. The old justification ("Capacitor and Tauri load
from the filesystem") no longer holds — both serve over an origin (Capacitor
`https://localhost`, Tauri `tauri://localhost`), not `file://`.
**Confirmed in Phase 7**, from Capacitor's own source: its local server serves
`index.html` for any path whose last segment has no `.`, and that fallback is
on by default. No hash router is needed. If a packaged build ever does 404 on
its assets the fix is `createHashRouter` in [App.tsx](src/app/App.tsx), not a
relative base, which cannot work with nested paths. Web hosts need an SPA
fallback.

### ✅ Phase 3 — Feature parity + friction fixes
**126 tests passing, `tsc` clean, `astryx doctor` 6/6, build clean.**
**Not yet click-tested in a real browser** — see §7.

All seven areas built, plus category management and the Budgets screen (which
the Phase 4 note below had left implicit). Every one has full create/edit/
delete with undo.

| Screen | File | Notes |
|---|---|---|
| Dashboard | [DashboardPage.tsx](src/pages/DashboardPage.tsx) | Tiles, inline quick-add, due-next, budget bars |
| Transactions | [TransactionsPage.tsx](src/pages/TransactionsPage.tsx) | Filters, multi-select, bulk actions |
| Ledger | [LedgerPage.tsx](src/pages/LedgerPage.tsx) | One account, running balance, `/ledger/:accountId` |
| Accounts | [AccountsPage.tsx](src/pages/AccountsPage.tsx) | Derived balances, reorder |
| Planned | [PlannedPage.tsx](src/pages/PlannedPage.tsx) | Post / skip / edit-one / edit-from-here |
| Debts | [DebtsPage.tsx](src/pages/DebtsPage.tsx) | Part payments, optional ledger posting |
| Budgets | [BudgetsPage.tsx](src/pages/BudgetsPage.tsx) | Per-category, payroll-anchored periods |
| Categories | [CategoriesPage.tsx](src/pages/CategoriesPage.tsx) | Rename, recolour, reorder, **merge** |
| Trash | [TrashPage.tsx](src/pages/TrashPage.tsx) | Restore, purge, empty |
| Settings | [SettingsPage.tsx](src/pages/SettingsPage.tsx) | Theme, privacy, export/restore |

**All six friction fixes shipped.** 1 full edit · 2 per-occurrence editing ·
3 inline quick-add · 4 undo toast + Trash · 5 category merge · 6 bulk actions.

**New shared layers, in dependency order:**

- [db/commands.ts](src/db/commands.ts) — the writes that span tables and are
  only correct if they land together (merge, skip/override, series split, debt
  settlement). Each opens one Dexie transaction covering every table it touches
  and calls the repositories *inside* it, so their stamping and outbox
  behaviour is inherited rather than reimplemented. Dexie joins a nested
  transaction to its parent when the parent's scope is a superset — that is
  what makes this work. 25 tests.
- [db/queries.ts](src/db/queries.ts) — live reads. Returns `undefined` while
  loading and `[]` when genuinely empty; collapsing the two flashes "no
  transactions yet" on every mount.
- [db/backup.ts](src/db/backup.ts) — JSON export/restore, 13 tests. Carries
  real ids, unlike the old app's `.xls`, which is what makes a restore
  lossless. Soft-deleted rows are included on purpose. Rows are written with
  `bulkPut`, **not** through the repositories, so a restore preserves the
  original `updatedAt` — re-stamping would make a restored copy beat a newer
  remote row under last-write-wins.
- [platform/fs.ts](src/platform/fs.ts) — written ahead of the export button,
  as §6 warned. Native savers **register** themselves at startup rather than
  being imported, so this file builds with neither Capacitor nor Tauri
  installed. Phase 7 registers from [platform/native.ts](src/platform/native.ts)
  and left the rule in place — see that phase for why it still holds now that
  both packages are installed.
- [components/](src/components/) — `AmountInput` (a *text* input: NumberInput
  commits only valid numbers, so `4500 /` would be rejected keystroke by
  keystroke and the expression feature could not exist), `MoneyText`,
  `FormDialog`, `TransactionDialog`, `TagInput`, `EntityIcon`, `Pickers`, and
  `useUndoableDelete`.

**Six things worth not rediscovering:**

1. **`exactOptionalPropertyTypes` is on.** Passing `undefined` to an optional
   Astryx prop is a *type error*, not a no-op. Absent props must be spread
   conditionally: `{...(x !== undefined && {prop: x})}`. This shows up
   constantly; it is not a quirk of any one component.
2. **`BaseProps` omits `inputMode`** (along with `autoFocus`, `spellCheck`,
   `color` and a dozen others). Passing it compiles as an excess prop in some
   positions and is silently dropped. Check
   `node_modules/@astryxdesign/core/dist/BaseProps.d.ts` before assuming an
   HTML attribute is forwarded.
3. **`DateInput` speaks a template-literal type**, not `string`.
   [format/dates.ts](src/format/dates.ts) declares a structurally identical
   `ISODate` rather than importing Astryx's, so date handling does not depend
   on a pre-1.0 type export. All epoch↔calendar conversion is local, never
   `new Date(iso)` — that parses `YYYY-MM-DD` as **UTC** and lands on the
   previous day west of Greenwich.
4. **Dexie's typed `transaction()` overloads stop at five tables.** Beyond
   that, pass an array. The union of eight differently-typed tables also makes
   `database[name].bulkPut(...)` uncallable; narrow the *operation*, not the
   row type (see `backup.ts`).
5. **`Repository<Account>` is not a `Repository<SyncMeta>`** — `update(patch)`
   is contravariant. Trash needs a repo-by-table-name map, so
   [repositories.ts](src/db/repositories.ts) declares a narrow
   `RestorableRepository` interface instead of widening with `any`.
6. **Every amount renders through `MoneyText`**, which is what makes the
   privacy toggle a single change rather than an audit. Where an amount is
   part of a longer string ("৳420 of ৳6000") use `useMoneyFormatter()` —
   calling `formatMoney` directly compiles fine and silently defeats privacy
   mode for that one label.

**Bundle: eager JS is 747kb raw / 235kb gzip across 21 chunks**, up just 16kb
raw from Phase 2's 731kb — nine screens added, and route splitting absorbed
almost all of it. CSS is 165kb / 29kb gzip.

Colour swatches are the one place an inline `style` is correct: `colorHex` is
per-row *user data*, and neither a design token nor `xstyle` (StyleX resolves
at build time) can express a value chosen at runtime. Every *design* colour
still comes from tokens.

### ✅ Phase 4 — Analytics
**157 tests passing, `tsc` clean, `astryx doctor` 6/6, build clean.**
**Not yet click-tested in a real browser** — see §7.

Replaces the old app's single 7-day line chart. Four charts, each answering a
different question, all scoped by one range control in the page header.

| Chart | File | Form | Colour job |
|---|---|---|---|
| Where the money went | [CategoryBars.tsx](src/charts/CategoryBars.tsx) | Horizontal bars | one hue |
| Money in, money out | [CashFlowColumns.tsx](src/charts/CashFlowColumns.tsx) | Diverging columns | status pair |
| What changed | [CategoryChangeBars.tsx](src/charts/CategoryChangeBars.tsx) | Diverging bars | status pair |
| Net worth | [NetWorthArea.tsx](src/charts/NetWorthArea.tsx) | Line + area | one hue |

- [domain/analytics.ts](src/domain/analytics.ts) — every aggregation, pure,
  25 tests. The charts receive finished series and render them; no arithmetic
  happens inside a component.
- [charts/chrome.ts](src/charts/chrome.ts) — mark specs, chrome classes,
  margins, `fitBand`, `truncateLabel`, `pointerIn`. 6 tests.
- [charts/ChartFrame.tsx](src/charts/ChartFrame.tsx) — the shared frame, built
  first as this note asked: heading, legend, measured plot, table twin.

**The donut became a bar chart, on purpose.** This note asked for a donut; a
donut compares *angles*, which is the hardest comparison to make by eye and
fails precisely when two categories are close — the common case. Bars share a
baseline, so "Food is a bit more than Transport" is readable at a glance, and
they scale past six categories without the palette growing.

**Seven things worth not rediscovering:**

1. **The category charts deliberately do not encode identity in colour, and
   this is the finding that shaped the whole phase.** The obvious design —
   one hue per category, taken from each row's `colorHex` — cannot be made
   safe, and it is worth knowing *why* rather than re-attempting it. Measured
   with the data-viz validator against the real card surfaces (`#FFFFFF` /
   `#1F1F22`): across the fifteen seeded categories the worst pair separates
   by **ΔE 0.4** under simulated protanopia (Groceries olive vs Gift amber)
   and **ΔE 5.6** under *normal* vision (Freelance mint vs Education teal),
   against a floor of 15. Even a six-slice subset fails. This is not a bad
   palette that better hexes would fix — fifteen classes cannot be pairwise
   distinct, and users can set these colours to anything anyway. So bar
   length carries the magnitude, the **row label** carries identity, every
   bar is the same accent hue, and the category's own colour rides along as a
   dot beside its name. Colour is decoration that agrees with the app; it is
   never what the reader has to decode.
2. **Income/expense wear the status tokens, and direction is what makes that
   legal.** These series genuinely mean good and bad, so they take
   `--color-success` / `--color-error` rather than categorical hues. Green
   against red measures inside the CVD warn band — **ΔE 6.3** deuteranopia in
   light mode (8.4 in dark), where 6–8 is legal *only* with a second,
   non-colour channel. That channel is the layout: income grows **up** from a
   zero baseline and expense grows **down**. Direction reads identically in
   greyscale, in print, and under any colour blindness, and it is stronger
   than the legend that also ships. Do not "simplify" these into side-by-side
   grouped columns — that removes the mitigation, not just a layout choice.
3. **The seeded category colours were wrong and are now measured.** The
   comment on `ENTITY_COLORS` claimed Material's 500 shades "hold contrast on
   both the light and dark theme surfaces". They do not: **nine of fifteen**
   failed, `#FF9800` at 2.16:1 on the light card, `#3F51B5` at 2.39:1 on the
   dark one, and `#795548`/`#607D8B`/`#9E9E9E` carrying so little chroma they
   read as the same grey. Each replacement holds its hue and moves only
   lightness into OKLCH L 0.48–0.67, the band where **one** hex clears 3:1
   against **both** surfaces — the constraint that exists because a category
   stores a single colour and the app has two themes. Seeding only touches a
   database with no categories at all, so this changes a fresh install and
   leaves every existing row alone.
4. **Every chart has a table twin, and that is load-bearing rather than
   polite.** It is what makes it legitimate for a value to be reachable only
   by hovering, for a long category name to be truncated, and for a mark to
   sit below 3:1. Delete the table and three separate compromises become
   defects.
5. **`ChartFrame` sizes the `<svg>` as `plotHeight + margins`.** Sizing a
   container to the plot alone crops its own axis band and grows a tiny
   nested scrollbar inside the card. The frame also renders nothing until it
   has measured a width, so it holds the height open during load — otherwise
   every card on the screen jumps downward on mount.
6. **Pointer position comes from visx's `localPoint`, never
   `event.nativeEvent.offsetX`.** `offsetX` is specified relative to the
   *target's padding edge*, and SVG shapes have no padding box, so what
   browsers report there has historically differed between engines — the
   readout would sit correctly in one browser and be offset by a margin in
   another. `localPoint` goes through `getScreenCTM` and answers in the SVG's
   own coordinates. Wrapped as `pointerIn` in `chrome.ts`.
7. **Net worth is cumulative from the start of the ledger, not from the start
   of the range**, and its y-axis always includes zero. A range-relative
   baseline would say your savings vanished whenever you changed the filter;
   an auto-scaled axis turns a 2% wobble into a cliff, which is the most
   common way a finance chart lies to the person reading it. Sampling is
   lossless *at the points it emits* because the value is cumulative, which
   is what makes downsampling a multi-year range safe.

**Range presets are 3 / 6 / 12 months and All, calendar-month aligned, and
the shortest is deliberately three.** The cash-flow chart plots one column per
month, so a "this month" preset would render a one-column bar chart — which is
a stat tile pretending to be a chart. "This month" is the dashboard's job.

**Bundle: eager JS is 749kb raw / 237kb gzip across 24 chunks**, up 2kb raw
from Phase 3. visx and its d3 dependencies are a named `charts` vendor group
(67kb raw / 24kb gzip) reached only from the Analytics route — **if `charts`
ever appears in `index.html`'s preload list, something has imported a chart
from a screen that should not have.** CSS is 168kb / 31kb gzip.

Budgets shipped in Phase 3, so `computeAllBudgetProgress` was already rendered
on both [BudgetsPage](src/pages/BudgetsPage.tsx) and the dashboard — this phase
was charts only.

### ✅ Phase 5 — Supabase sync
Eight tables mirroring the Dexie schema in snake_case, `user_id uuid references
auth.users on delete cascade`, RLS on all four operations, and a
`(user_id, updated_at, id)` index per table matching the puller's keyset order.
Applied as three migrations: `create_sync_tables`,
`revoke_rls_auto_enable_from_api_roles` and `reject_stale_writes`.

The client side is four files under [src/sync/](src/sync/), split so that
everything with a rule behind it is testable without a network:

- [mapping.ts](src/sync/mapping.ts) — camelCase↔snake_case and epoch
  ms↔`timestamptz`. The column names are *derived* rather than declared, so
  adding a field to `types.ts` needs no edit here; only the list of which
  fields are timestamps is written by hand.
- [remote.ts](src/sync/remote.ts) — the `SyncRemote` interface and its Supabase
  implementation. The engine talks in local row terms, so this is the only
  file that knows PostgREST exists — which is also what makes the PowerSync /
  ElectricSQL escape hatch a matter of writing another implementation rather
  than rewriting the engine.
- [engine.ts](src/sync/engine.ts) — drain the outbox, then pull past the
  cursor. Push first, so the server has seen this device's edits before it is
  asked what the truth is.
- [sync-context.tsx](src/sync/sync-context.tsx) — when a cycle runs: on
  sign-in, on a local change (debounced 2s), on `online`, on tab focus, and a
  5-minute poll. One cycle at a time; a request arriving mid-cycle sets a flag
  rather than starting a race.

UI is one section on Settings ([SyncSettings.tsx](src/sync/SyncSettings.tsx)) —
sync is a setting, not a destination. It shows the pending-change count and the
real error text, because "Synced" with a queue behind it is the claim that
would cost someone data, and a generic failure message makes a wrong password,
an expired session and a dead connection indistinguishable.

**Three invariants the code depends on**, each a bug that would be hard to see:
a pull never enqueues (or a pulled row is pushed straight back, forever); an
outbox entry is cleared only if its `queuedAt` is unchanged (or an edit made
during the request is dropped); and the `userId` write-back after a push does
not touch `updatedAt` (or every successfully pushed row immediately re-queues
itself and the queue never empties).

**Derived balances need no recompute step.** Balances are a pure function of
the ledger read through `useLiveQuery`, so a `bulkPut` from the puller
re-renders them. That was on the plan as a task and turned out to be a
property the Phase 1 decision already bought.

**Two open items from §7 were closed here.** A restore now enqueues every
restored row and clears the sync cursors, so it is visible to the pusher — but
it does *not* re-stamp `updatedAt`, so a restore does not force the backup onto
the cloud. Each row competes on its merits, which is what makes restoring a
precautionary backup safe rather than a silent rollback of everyone else's
week. `enqueueOutbox` moved out of `repo.ts` to be shared rather than
reimplemented, because a second copy of the collapse logic is one `bulkPut`
away from a queue with duplicate entries.

**Verification.** 214 unit tests (52 new), including the two-devices-offline
case this plan asked for, run against an in-memory fake server. Because a fake
cannot test what the real server enforces, `npm run test:sync`
([scripts/sync-e2e.ts](scripts/sync-e2e.ts)) runs 27 checks against the live
project: a row in every one of the eight tables with every column populated,
millisecond precision, `text[]`, `jsonb`, nullable timestamps, keyset paging
across a tie, soft-delete replication, the stale-write trigger, and RLS from
both another account and a signed-out client. All pass. **The test users are
deleted afterwards** — the SQL to recreate them is in the script's header,
and `E2E_PASSWORD` goes in `.env`.

**Bundle: eager JS is 758kb raw / 241kb gzip across 24 chunks**, up 9kb raw
from Phase 4 — the provider and its context, not the SDK.
`@supabase/supabase-js` is a named `supabase` vendor group of **209kb raw /
54kb gzip that is not in the initial download at all**, because it is reached
only through `await import()` and only on a device that has signed in before
(`hasOptedIn`, a localStorage flag this app owns rather than a guess at
Supabase's storage key). **If `supabase` ever appears in `index.html`'s preload
list, something has imported the SDK statically and sync has stopped being
opt-in.** CSS is unchanged at 168kb / 31kb gzip.

### ✅ Phase 6 — Migration importer
Five files under [src/migration/](src/migration/), split so that everything
with a rule behind it is testable without a file, a parser, or a database:

- [ids.ts](src/migration/ids.ts) — the derived id, and the whole answer to
  idempotency.
- [parse.ts](src/migration/parse.ts) — sheet rows to typed rows. Pure, and
  imports no SheetJS, so its rules are tested with object literals.
- [plan.ts](src/migration/plan.ts) — the diff: what would be created, what is
  already here, what could not be taken faithfully, and what every balance
  will be afterwards. Pure.
- [apply.ts](src/migration/apply.ts) — one Dexie transaction over six tables.
- [xls.ts](src/migration/xls.ts) — the lazy `await import('xlsx')`, and the
  only file in the app that knows SheetJS exists.
- [ImportSettings.tsx](src/migration/ImportSettings.tsx) — one section on
  Settings, sitting last because it is the one thing there you do once.

**The export has no ids, so the ids are derived from the rows.** UUIDv5 over a
natural key (date, amount, type, account, category, description, tags), which
turns "have I already imported this?" from a fuzzy-matching problem into a
primary-key lookup. The alternative — matching on re-import by resemblance —
puts a rule that has to be re-tuned on every import in the path of the user's
whole financial history, and gets it wrong in both directions. Two source rows
identical in *every* column are still two real spends, so the key carries an
occurrence index. The cost is that imported rows are v5, not the v7 everything
else uses, and so do not sort by creation time; nothing depends on that,
because every row carries a real `date`.

**The importer only ever creates rows. It never edits or deletes one.** Every
row is matched first — by derived id, then by name — and a match means "leave
it alone". So a correction made to an imported transaction survives a
re-import, an account renamed afterwards keeps its new name rather than being
recreated under the old one, and a row deleted afterwards stays deleted
(matching deliberately includes soft-deleted rows: a delete that silently
undoes itself is worse than one that fails). There is no mode in which
importing loses work, which is what makes "just run it again" safe advice.

**Opening balances are solved for, not copied — and this is the part that
would have been silently wrong.** The old app's `Balance` column is a *current*
balance. Writing it into `openingBalance` would double-count the entire ledger:
an account would import at its real balance and then immediately render at
roughly twice it. Instead `openingBalance = exportedBalance − (what the
imported ledger does to it)`, so this app's derived balance lands exactly on
the number the old app displayed. On the real file that solves to zero for the
account whose entire history is in the export, and to a real opening figure for
the one that predates it; both then compute to the exported balance to the
taka. An account that
already exists here keeps its own opening balance — silently restating it would
change every balance the user has already seen — so the preview shows the two
figures side by side rather than hiding the difference.

**A settled debt gets a settlement row, linked to the ledger entry that paid
it.** Outstanding is derived from `debtPayments` rather than read off
`isCleared` (Phase 3's decision), so a settled debt with no payment would
render as fully outstanding. The old app also posts each settlement to the
ledger as `Repaid: {person} ({description})`; that row is already being
imported as an ordinary transaction — the money did leave the account — so the
payment *links* to it instead of creating a second one, and each ledger row can
be claimed by only one debt. All three settled debts in the real file link.

**Verification.** 53 new unit tests (267 total, all passing), covering the
column-order trap, the local-time trap, every loose cell type, the
opening-balance derivation checked twice — once against the plan and once by
running the app's own `computeBalances` over the rows the plan would write —
idempotency, the rename case, the delete case, and an atomicity test that
sabotages the plan mid-write and asserts the database is untouched.

Then `npm run test:import` ([scripts/import-verify.ts](scripts/import-verify.ts))
runs the real file through the real importer into a throwaway database, and
reconciles it against an authority the importer had no part in producing: the
old app's own `.pdf`. **All 14 checks pass** — 91 logged rows against 91
parsed, 4 debts against 4, the report's own spend total equal to the sum of
every parsed amount, outstanding debt and receivables both matching, both
derived balances equal to the exported ones, no settled debt left outstanding,
and a second import that writes zero rows. **No figure from the real file is
quoted here** — `migration-data/` is gitignored because it holds real financial
data, and a balance copied into a public document leaks exactly as well as the
file would. Run the script to see them. Reading the `.pdf` means decoding glyph ids from
a POI-subsetted font, which is this exporter's quirk rather than a standard, so
the decoder verifies it recovered a sentence it recognises before any figure is
trusted — an unreadable report fails the run rather than passing it silently.

**Bundle: eager JS is 757kb raw / 240kb gzip across 22 chunks** — unchanged
from Phase 5 within rounding, because none of this is on the boot path. SheetJS
is a named `sheetjs` vendor group of **481kb raw / 156kb gzip that is not in
the initial download**, reached only through `await import()` from
[xls.ts](src/migration/xls.ts) and only once a file has actually been picked.
**If `sheetjs` ever appears in `index.html`'s preload list, something has
imported it statically and every user is paying for a parser they will never
run.** CSS is unchanged at 168kb / 31kb gzip.

### ✅ Phase 7 — Packaging
**302 tests passing, `tsc` clean, `astryx doctor` 6/6, build clean, and the
Android app builds to an installable APK.** The desktop shell is complete but
**has never been compiled** — see the toolchain note at the end.

Capacitor Android and Tauri desktop, both serving the same `dist/`. There is no
platform build flag and no second entry point: one web build runs in all three
places, and the platform is answered at *runtime*.

| File | Job |
|---|---|
| [platform/host.ts](src/platform/host.ts) | Which shell is this? Reads injected globals, imports no SDK. |
| [platform/native.ts](src/platform/native.ts) | The bootstrap: detect, then `await import()` only that shell's module. |
| [platform/savers/capacitor.ts](src/platform/savers/capacitor.ts) | Android file saver. |
| [platform/savers/tauri.ts](src/platform/savers/tauri.ts) | Desktop file saver: native Save dialog, then write. |
| [platform/android-back.ts](src/platform/android-back.ts) | The system back button. |
| [capacitor.config.ts](capacitor.config.ts) · [src-tauri/](src-tauri/) | The two shells. |

**Detection is by injected global, never by importing the SDK.** Capacitor's
`native-bridge.js` defines `window.Capacitor` and Tauri v2 defines
`window.__TAURI_INTERNALS__`, both before app code runs. Asking
`@capacitor/core` "are we native?" means shipping `@capacitor/core` to every
browser to be told no. One trap worth keeping: the check is
`Capacitor.isNativePlatform() === true`, not the presence of the global —
`@capacitor/core` installs that same global *on the web* the moment anything
imports it, answering false, so a presence check is true in a plain browser tab.

**`fs.ts`'s "do not add a conditional import here" rule still holds, and it was
never about the packages being uninstalled.** They are ordinary dependencies
now. The rule is that `fs.ts` is imported by the export screen, so an import
inside it is on the boot path whether or not the branch ever runs. `native.ts`
is where the dynamic imports live, behind a function that returns immediately
on the web. Measured: **`capacitor` is 18.8kb / 6.8kb gzip and `tauri` is
4.5kb / 2.1kb gzip, both lazy**, and neither appears in `index.html`'s preload
list. Eager JS is **759kb raw / 241kb gzip across 22 chunks**, up 2kb from
Phase 6 — that 2kb is the detection and bootstrap, which is all a browser gets.

**`base: '/'` is confirmed for Android, from Capacitor's source rather than by
guessing.** `WebViewLocalServer.handleLocalRequest` serves `index.html` for any
path whose last path segment contains no `.`, and `CapConfig.html5mode`
defaults to `true`. So `/ledger/<uuid>` gets the document and
`/assets/index-*.js` gets the file. **No hash router is needed**, and the Phase
2 open question is closed. (Note the shape of the rule: a route parameter
containing a dot would be served as a missing file instead. Nothing generates
one — ids are UUIDs — but a future slug route should keep that in mind.)

**`androidScheme` is pinned to `https` in `capacitor.config.ts`, even though it
is already the default, because it is the app's origin and IndexedDB is keyed
to the origin.** Changing it later — to `http`, or to a custom hostname —
points the WebView at a different origin, and every installed copy comes up
with an empty database and no error at all. There is no migration for that. It
is also what makes the WebView a secure context, which `crypto.subtle` and the
Supabase SDK both need.

**The Android saver tries the public Documents folder first and falls back to
app-private external storage.** A backup the user cannot find is not a second
copy of anything, so `Documents/Finance Tracker/` is the destination worth
having; below Android 13 the plugin must request a storage permission that its
manifest does not declare, so that attempt can fail. Falling back means the
export always produces a file, and `location` says which one it produced. The
order is the whole point — writing the private copy first would silently give
every device the worse destination. Blobs are converted to base64 before
crossing the bridge: the plugin's `data` accepts `string | Blob`, but Blob is
web-only and on Android it arrives as an empty object and writes a **zero-byte
file rather than throwing**. `arrayBuffer()` + `btoa`, not `FileReader`, so the
conversion is testable in Node.

**The Android back button had to be fixed, and it is packaging, not polish.**
Capacitor 8's `BridgeActivity` has no `onBackPressed` at all, so the default
Activity behaviour applies and back **finishes the Activity** — closing the
whole app from any of the twelve routes. Installing `@capacitor/app` gets most
of the way (its plugin calls `webView.goBack()` when no JS listener is
attached), but at the first history entry it consumes the press and does
nothing, leaving an app you cannot back out of. The listener completes it:
navigate while there is history, exit at the first entry. Predictive back looks
like it would bypass this and does not — the plugin registers through AndroidX's
`OnBackPressedDispatcher`, which AndroidX wires to the system's
`OnBackInvokedCallback`, so it fires on both paths at targetSdk 36. Back does
**not** yet close an open dialog; that needs dialogs to own a history entry and
is a Phase 8 job.

**`android/` and `src-tauri/` are now committed — reversing a Phase 0
assumption.** The old `.gitignore` filed them under "native wrappers
(generated)". They are not: `cap add` scaffolds once, and everything after that
— the manifest, launcher icons, the signing config — lives there and survives
no regeneration. Capacitor's own `android/.gitignore` already excludes what
genuinely is output (the copied `dist/`, the generated Capacitor config, every
build directory), so what is tracked is the project itself. The keystore lines
in that file, commented out by default, are **uncommented on purpose**: this
repository is public, and a committed signing key lets anyone publish an update
as this app.

**Desktop specifics.** The window is 1200×820 with a 400×560 minimum, and
`dragDropEnabled: false` — Tauri's webview otherwise swallows HTML5 drag-and-
drop, which would break dropping a file onto the backup-restore and `.xls`
import inputs. A CSP is set (`csp: null` is the scaffold default and disables
the protection entirely); it allows `ipc: http://ipc.localhost` for Tauri's own
IPC and `https://*.supabase.co` for sync, and Tauri appends its nonces and
hashes on top at compile time.

**The one deliberate desktop limitation: exports can only be written inside
`$HOME`.** Tauri's fs scope is a compile-time allowlist and **the save dialog
does not widen it** — picking a path does not grant permission to write there,
which is easy to assume and wrong. `capabilities/default.json` allows the home
directory, covering Documents, Downloads and the desktop; a second drive is
refused with a bare `forbidden path` that reads like a bug, so `tauri.ts`
rewrites that one message into something actionable. The real fix, if it is
ever needed, is a Rust command — commands are not scope-checked, so the
dialog's own result authorises the write. That was not done here because the
Rust side cannot be compiled on this machine, and untested IPC is a worse
trade than a stated limit.

**Verification — and what it does not cover.** 35 new unit tests (302 total):
every detection case including the browser-with-Capacitor-global one, the
destination ladder and its base64 conversion, cancellation, the scope-refusal
message, and that a native module failing to load leaves the browser saver in
place instead of taking down the render. Then, on the real toolchain:
`npx cap add android`, `npx cap sync android`, and `gradlew assembleDebug`
produce a **7.6MB `app-debug.apk`**, whose contents were checked — 147 web
assets inside, `index.html` present, the entry script pointing at
`/assets/index-*.js`, and the generated `capacitor.config.json` carrying the
right appId and scheme. `npx tauri info` parses `tauri.conf.json` and reports
the CSP, dist path and both plugins.

**Nobody has run either packaged app.** There is no emulator or device
attached here (`adb devices` is empty and no AVD exists), so the APK has been
built and inspected but never launched. And the desktop build is **blocked on a
toolchain this machine does not have**: no `cargo`/`rustc`, and no MSVC C++
build tools or Windows SDK, so `npm run tauri:build` cannot run at all. Every
Rust file, `Cargo.toml`, `tauri.conf.json` and the capability set are written
and consistent, and none of it has seen a compiler. First desktop run needs
[rustup](https://rustup.rs) plus the Visual Studio C++ build tools; if the
window comes up blank, the CSP is the first thing to relax.

The launcher icons on both platforms are still the scaffold defaults — the
generic Android icon and Tauri's logo. That is Phase 8's job, along with the
splash screen and safe-area insets.

### ⬜ Phase 8 — Polish
Route/shared-element transitions, list stagger, skeletons, desktop keyboard
shortcuts, a11y pass. Astryx components are accessible by default — risk is in
custom composition.

---

## 7. Open items

- ~~**Motion vs. Astryx's "no raw `<div>`" rule.**~~ Resolved in Phase 2 —
  `create(Stack)` / `create(Card)` from [animated.ts](src/components/animated.ts).
- **Bundle.** The >500kb warning is gone, but **not for the reason Phase 2
  predicted.** Route splitting alone did not do it — `react-dom` is ~523kb of
  source on its own, so the entry was never going to fit under 500kb by moving
  pages out. What cleared it was splitting `react` / `react-router` / `dexie` /
  `lucide-react` into vendor chunks (`build.rolldownOptions.output.advancedChunks`),
  which is worth doing on its own merits — those change only on upgrades, so a
  returning user re-fetches app code and not the framework.

  Honest numbers: **eager JS is 758kb raw / 241kb gzip across 24 chunks** as of
  Phase 5, up from Phase 1's 524kb / 159kb single chunk. The growth is real work, not bloat:
  react-router (89kb) and dexie (95kb) are both newly on the boot path, plus
  AppShell/SideNav/MobileNav. Route splitting is doing its job — each page chunk
  is under 1kb.

  **The one genuinely suspicious item is `useTranslator`, 101kb / 26kb gzip**:
  Astryx's i18n, being the full ICU message-format parser plus a 71kb `en.json`,
  eagerly loaded, for a single-user single-locale app. Worth asking whether
  Astryx can precompile messages or ship a lite locale before Phase 8.
- ~~**`Transactions` vs `Ledger` was a Phase 2 judgement call.**~~ Settled in
  Phase 3, keeping both: Transactions answers "what have I spent on X?" across
  every account and owns the filters and bulk actions; Ledger answers "how did
  this account get to this number?" and owns the running balance. Different
  questions, so they stayed separate.

- **Phases 3, 4, 5 and 6 have not been click-tested in a real browser, and
  Phase 7's two packaged apps have never been launched at all.** Phase 5's
  *engine* is the best-verified thing in the repo — 27 checks against the live
  Supabase project, plus 52 unit tests — but that verification is entirely
  headless. What nobody has done is type a password into the form. Likeliest
  surprises there: the `TextInput type="password"` field, `StatusDot` inside a
  horizontal `Stack`, whether the sign-up confirmation banner appears at all
  (it depends on the project's email-confirmation setting, which was never
  changed from its default), and the first-run case where a real account signs
  in on a device that already holds seeded categories — those get pushed, which
  is correct, but nobody has watched it happen. What *was*
  verified: `tsc` clean, 157 tests, `astryx doctor` 6/6, a clean production
  build, the Figtree invariant (2 × `font-family:Figtree`, 2 ×
  `font-weight:300 900`, zero `Figtree Variable`), deep-link asset resolution
  against `npm run preview` (`/ledger/abc123` serves `/assets/...`, HTTP 200),
  and — for Phase 4 specifically — that **every chart utility class is
  actually present in the built CSS** and resolves to an Astryx token
  (`.fill-accent-bg{fill:var(--color-accent)}` and the fifteen others). That
  last check matters more than it sounds: a mistyped or composed class name
  produces a chart with no fill, which type-checks, builds, and renders an
  empty card.

  What was **not** verified: actually opening a dialog, saving a row, or
  seeing any layout. Phase 2 was verified interactively and these two were
  not, so treat the first run as a smoke test. Likeliest surprises: Phase 3's
  dialogs, the `ToggleButtonGroup` swatch strip and the mobile drawer; Phase
  4's left label column (the truncation budget is a character count, not a
  measurement, so a run of wide glyphs is the case to look at), the tooltip
  placement near the right edge of a card, and the charts at a narrow mobile
  width where the axis-label stride does the most work.

  Phase 6 adds its own version of this. Its *logic* is the best-verified thing
  in the repo after the sync engine — 53 unit tests plus 14 checks against the
  real file and the old app's own report — but every one of those runs the
  importer as a function call. Nobody has picked a file with the file picker.
  Likeliest surprises: whether `FileInput`'s `isLoading` reads sensibly while
  an 800kb chunk downloads on a slow connection; the balances `Table` at a
  narrow width, since it is the only table in the app with two numeric columns;
  and `Collapsible` holding the issues list, which is the first use of that
  component here.

- **Deleting an account orphans its transactions, quietly.** `computeBalances`
  ignores a transaction pointing at an unknown account, so the rows survive in
  the Transactions list showing "—" for the account, and drop out of every
  balance. That is the *safe* direction (no phantom balances, and restoring the
  account restores everything), but nothing warns the user first. The account
  dialog already counts the affected transactions; a confirmation using that
  count is the obvious fix, along with the same treatment for categories, which
  currently just fall back to "Uncategorised".

- ~~**Restore does not enqueue to the outbox.**~~ Closed in Phase 5, and the
  answer was both of the options it offered: a restore enqueues every row *and*
  clears the sync cursors, so the next cycle pushes everything and re-reads the
  server from the beginning. `updatedAt` is still not re-stamped, so
  last-write-wins may indeed favour the copy already in the cloud — which is
  the correct outcome, not a concession. A backup restored as a precaution
  should not silently roll back a newer copy.

- **`purge()` still does not enqueue, and a peer can push a purged row back.**
  Unchanged from Phase 3, and now with a name: there is no tombstone protocol,
  so "forget this row entirely" cannot be expressed to peers. Emptying the
  trash is local-only. The row is gone here and stays on any device that has
  not emptied its own trash, and that device will re-push it. Only purge rows
  whose soft delete has already synced, and expect a purge to be undone by a
  peer that was offline. A real fix needs a `deleted_rows` table with its own
  retention window; not worth it for one user, but worth writing down before
  someone reports it as a bug.

- **Privacy mode masks chart *numbers*, not chart *shapes*.** Axis ticks, bar
  labels and tooltips route through `useCompactMoneyFormatter` /
  `useMoneyFormatter` and render as `••••` when amounts are hidden, but the
  bars and the net-worth line still draw at their true lengths — so relative
  magnitude is still visible over someone's shoulder. That is the intended
  trade: masking the marks as well would leave four empty cards rather than a
  chart with its figures covered, and privacy mode is a shoulder-surfing
  measure rather than a redaction. Revisit only if that judgement turns out to
  be wrong in practice.

- **`categoryChanges` compares against the immediately preceding span, and
  `ALL` therefore has nothing to compare against.** The "What changed" chart
  renders an explanatory empty state on that preset rather than inventing a
  baseline. Fine as it stands; worth revisiting only if a user asks for
  year-over-year rather than period-over-period, which is a different
  comparison and would need its own range.

- **Reordering is up/down buttons, not drag-and-drop.** Accessible and fine for
  fifteen categories; Phase 8 can add dragging on top of `applyDisplayOrder`,
  which already takes a whole ordered list rather than a (from, to) pair.

- **Privacy mode is not persisted, on purpose.** A hidden state surviving a
  restart reads as data loss. It is a shoulder-surfing measure, not security —
  the numbers are still in IndexedDB and one toggle away.
- **A tie on `updatedAt` leaves both sides holding their own copy.** Both the
  client (`remoteWins`) and the server (`reject_stale_write`) require *strictly*
  newer to overwrite, so two devices editing one row in the same millisecond
  stay divergent until either is edited again. The alternative — letting a tie
  overwrite — makes the pair rewrite each other on every cycle for as long as
  they disagree, which is worse: it never settles and it burns requests. Given
  UUIDv7 ids and one human, a same-millisecond collision on the same row is not
  a thing that happens. Revisit only if it does.

- **Signing in as a different account on a device that already synced is
  refused, and there is no UI to reset.** The account stamp in `meta` exists so
  that one person's rows are never pushed into another person's account, which
  would merge two sets of finances in a direction no undo reaches. But the only
  way past it today is exporting a backup and clearing the site data by hand.
  A "reset this device" button next to the sign-in form is the obvious fix and
  was left out as scope.

- **Changes from another device arrive on a poll, not a push.** Supabase
  Realtime is not used: propagation is on sign-in, on a local change, on
  reconnect, on tab focus, and otherwise every five minutes. For one person
  moving between a phone and a desktop that is indistinguishable from instant,
  and a websocket held open costs battery on the platform (Capacitor) where it
  would matter most. Still worth revisiting once the Android build has actually
  been lived with on a phone.

- **`npm run test:sync` needs two auth users that no longer exist.** They are
  deliberately deleted after each run rather than left behind: a live auth
  system holding two accounts with a shared known password is not a thing to
  leave sitting on a project about to hold real financial data. Recreating them
  is one SQL statement, copied into the script's header comment. The cost is
  that the script is not runnable straight from a clone, which is the right
  trade for a script that clears an account before it starts.

- **There is no "undo this import".** Nothing records which rows a given import
  created, so backing one out means finding them by hand. It is *possible* —
  every imported row's id is a UUIDv5 under a fixed namespace, so they are
  identifiable — but there is no UI and no batch record. Mitigated by the
  import being purely additive and previewed in full beforehand, and by
  Settings sitting one section above a working backup/restore pair. Worth a
  batch stamp if a second import source ever appears; not worth it for one
  migration done once.

- **The importer only adds, which cuts both ways.** A row deleted in the old
  app after an export stays here on the next import, and a row *edited* there
  imports as a second row rather than updating the first — the id is derived
  from the content, so changed content is by definition a different row. For
  transactions this is nearly moot, since the old app cannot edit them at all
  (that is the whole reason for the rewrite). For accounts it is real: renaming
  `Cash` in the old app and re-importing creates a second account, because
  account matching is by name and the name is what changed. The old app is
  meant to be retired the day this import passes, so the window in which that
  matters is the one where both are being used — which is exactly the window
  the preview exists for.

- **An imported debt is attached to no account, and a settlement may touch no
  ledger row.** The export never says which wallet a debt is against, and
  guessing would attach money to the wrong one, so `accountId` is null. For a
  settled debt the importer records a settlement so the outstanding balance
  reads zero; if the export holds no matching `Repaid:` row it links to
  nothing, so the debt clears without a corresponding ledger entry. Both are
  faithful to a source that does not carry the information, and both are
  visible: the debt shows no account, and the settlement shows no transaction.

- **Reconciliation against the `.pdf` rests on a glyph offset.** The report's
  fonts are subsetted by Apache POI, so its text is glyph ids offset from ASCII
  by a constant that is this exporter's habit rather than a standard. The
  decoder in [import-verify.ts](scripts/import-verify.ts) checks that it
  recovered a sentence it recognises before trusting any figure, and fails the
  run rather than passing silently if it cannot — but a *different* PDF writer
  would need a different decoder, not a tweak. If that ever happens, reading
  the four summary figures off the report by eye and hardcoding them is the
  proportionate fix; the checks matter, the automation of them does not.

- **Astryx pre-1.0 churn.** Keep Astryx behind wrappers in `src/components/` so
  breaking changes hit a few files, not every screen. Run
  `npx astryx upgrade --apply` after any core bump.
- **Not a risk: performance.** ~100 transactions. Skip virtualization and other
  premature optimization until the ledger is actually slow.
- **Sequencing.** Phases 0–4 gave a better app than the current one with zero
  backend risk; Phase 5 adds the backend, but opt-in, so that property survives
  for anyone who never signs in. Phase 6's verification now passes — the real
  file imports, reconciles against the old app's own report, and re-imports to
  nothing. **Keep the old app installed anyway until the importer has been run
  once from the actual UI**, because what passes today is a script: nobody has
  yet watched the file go in through the file picker. Two copies of real
  financial data beats one behind a path that has only ever been driven
  headlessly.

---

## 8. Commands

```bash
npm run dev          # Vite dev server on :5173
npm run build        # tsc -b && vite build
npm test             # vitest run  (302 passing)
npm run test:watch
npm run preview      # serve dist/ on :4173 — use this, not `dev`, to check
                     # that deep links resolve their assets
npm run test:sync    # end-to-end sync against the LIVE Supabase project.
                     # Needs two throwaway auth users and E2E_PASSWORD in
                     # .env; clears the account it signs into, so never
                     # point it at one holding real data. See the header of
                     # scripts/sync-e2e.ts.
npm run test:import  # run the real .xls through the real importer and
                     # reconcile it against the old app's own .pdf report.
                     # Needs migration-data/, which is gitignored; without it
                     # the script says so and exits 0. Writes to a throwaway
                     # fake-indexeddb, never to the app's own database.

npm run android:sync # build the web app and copy it into android/
npm run android:run  # the same, then install and launch on a connected device
npm run android:open # open the project in Android Studio
npm run tauri:dev    # desktop shell against the Vite dev server  (needs Rust)
npm run tauri:build  # bundled desktop app                        (needs Rust)

cd android && ./gradlew assembleDebug  # app-debug.apk, without a device
npx tauri info                         # parse tauri.conf.json, report toolchain

npx astryx doctor            # validate Astryx wiring
npx astryx component <Name>  # exact props — use instead of guessing
npx astryx docs layout       # read before building any page
```

Supabase project `lwcelvtqpfvssxkabvun` is reachable via the Supabase MCP
server, so migrations can be applied directly. Three are applied:
`create_sync_tables`, `revoke_rls_auto_enable_from_api_roles`,
`reject_stale_writes`.

### Environment notes

- **`.env` is required for sync and gitignored.** `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_PUBLISHABLE_KEY`; see [.env.example](.env.example). With them
  missing the app runs normally and the Settings screen reports that sync is
  not configured, which is the state every fork starts in. The publishable key
  is safe in a client bundle — every table is behind RLS — but it lives in
  `.env` so a fork points at its own project rather than silently at this one.

- **Git identity is set repo-local** (`.git/config`) to `IronMore3265` /
  `135731975+IronMore3265@users.noreply.github.com`. The noreply address keeps
  a real email out of this public repo's permanent history. Do not switch it to
  a real address.
- **PowerShell 5.1 mangles multi-line arguments** passed to native commands, so
  `git commit -m` with a multi-line message fails oddly. Write the message to a
  file and use `git commit -F <file>`.
- **Git Bash here-documents collapse a doubled backslash to a single one**,
  even when the delimiter is quoted. Writing a file through a heredoc turns a
  character class meant to read `[\\/]` into `[\/]` — which still parses, and
  matches only a forward slash. That is how two vendor-chunk patterns in
  `vite.config.ts` briefly stopped matching Windows paths, and why a Windows
  path in a test string quietly lost its separators. Write files with an editor
  tool, or assemble the backslashes with `chr(92)` rather than typing them.

- **The Android toolchain is present on this machine; the Rust one is not.**
  `ANDROID_HOME=C:\Android\sdk` with platforms 35 and 36, build-tools 35/36
  and accepted licences, plus JDK 21 at
  `C:\Program Files\Microsoft\jdk-21.0.11.10-hotspot` — enough to build an
  APK, though there is no emulator image and no AVD, so nothing can be *run*.
  There is no `cargo`, no `rustc`, and no MSVC C++ toolchain or Windows SDK, so
  the Tauri build is blocked until [rustup](https://rustup.rs) and the Visual
  Studio C++ build tools are installed.
- Commits so far go straight to `main`; there is no PR workflow set up.
