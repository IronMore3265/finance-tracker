# Project state & roadmap

Handoff document. Read this first — it carries everything a fresh session needs
so the research below never has to be repeated.

**Last updated:** 2026-08-18 · Phases 0–2 complete.

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
| Sync | Supabase `lwcelvtqpfvssxkabvun` | Live, Postgres 17, ap-northeast-2, **0 tables** |
| Auth | Email/password, single user, RLS on `user_id` | Sync **opt-in**; app must work logged-out |
| Charts | visx + Motion | Chosen over Recharts for design control |
| Android | Capacitor 8 | |
| Desktop | Tauri 2 | Needs Rust toolchain to build; zero Rust written |
| Migration | In-app `.xls` importer | See §5 |

---

## 3. Verified Astryx facts

Hard-won; do not re-derive.

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

| Sheet | Columns |
|---|---|
| Expenses | Date, Description, Category, Amount, Type, Account, ToAccount, Tags |
| Accounts | Name, Balance, Currency, Icon, ColorHex, IncludeInBalance, DisplayOrder |
| Planned Transactions | Title, Amount, Category, Type, Account, Start Date, Interval Type, Interval N, One Time, Next Due Date, Is Active, Description |
| Debts & Receivables | Person, Amount, Description, Date, Due Date, Type, Status |

Real values: accounts `Cash`, `Brac Bank`, `CAAB`; categories `Food`, `Books`,
`Gift`, `Medicine`, `Movie`, `Transportation`, `Other`; icons `wallet`,
`card_visa`; colors `#2196F3`, `#EA3B35`; types `EXPENSE`/`INCOME`/`DEBT`; debt
status `Pending`/`Settled`; dates `YYYY-MM-DD HH:MM:SS`. ~100 transactions,
2026-06-29 → 2026-08-17.

**Three consequences for the importer:**

- `exceljs` **cannot** read BIFF8 (`.xlsx` only). **SheetJS is the only
  practical option.** Install from the official CDN tarball
  (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`) — **not** npm, where
  `xlsx` is abandoned at 0.18.5 with CVE-2023-30533. **Lazy-load it** so ~800kb
  stays out of the main bundle.
- **The export has no stable IDs** — accounts and categories are referenced by
  *name*. The importer must resolve by name and be idempotent.
- The seed category list in [seed.ts](src/db/seed.ts) deliberately matches the
  export's names so import maps onto existing rows instead of duplicating.

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
from the filesystem") no longer holds — both serve over a custom-protocol origin
(Capacitor `http://localhost`, Tauri `tauri://localhost`), not `file://`.
**Phase 7 must confirm this on a real device.** If a packaged build 404s on its
assets the fix is `createHashRouter` in [App.tsx](src/app/App.tsx), not a
relative base, which cannot work with nested paths. Web hosts need an SPA
fallback.

### ⬜ Phase 3 — Feature parity + friction fixes
Seven areas, each **with full edit support from the start**: Dashboard,
Accounts, Transactions, Planned, Debts, Ledger, Privacy & export. Plus category
management (add/rename/recolor/reorder/**merge**).

The friction fixes are requirements, not polish:
1. **Full edit everywhere** — the headline fix.
2. **Per-occurrence editing** of recurring items: "this occurrence only"
   (writes a `plannedExceptions` OVERRIDE) vs "this and all future"
   (`splitSeriesAt` — caps the old rule, starts a new one). Skip writes a SKIP
   exception rather than advancing a pointer. **Domain logic already done and
   tested; only UI remains.**
3. **Fast entry** — inline quick-add on the dashboard, not a modal.
4. **Undo on delete** — Toast with Undo + a Trash view. `repo.restore()` exists.
5. **Category management** including merge (reassign, then soft-delete).
6. **Bulk actions** — multi-select → delete / recategorize / retag.

### ⬜ Phase 4 — Analytics and budgets
visx + Motion in `src/charts/`. Build **one shared `ChartFrame`** (axes, grid,
tooltip, legend) before any individual chart. Donut, month-over-month bars,
cash-flow, net-worth trend. Colors from Astryx hue tokens so charts theme in
light and dark. `computeAllBudgetProgress` is ready to render.

### ⬜ Phase 5 — Supabase sync
Mirror the Dexie schema in Postgres (snake_case), `user_id uuid references
auth.users`, RLS `auth.uid() = user_id` on all four operations. Outbox worker,
pull where `updated_at > lastPulledAt`, **last-write-wins on `updatedAt`**.
Recompute derived balances after every pull. Test a row edited on two devices
while both offline. Escape hatch if hand-rolling proves fiddly: PowerSync /
ElectricSQL.

### ⬜ Phase 6 — Migration importer
Lazy-loaded SheetJS, four sheets, name-based resolution, **diff preview**,
atomic Dexie commit. Verify totals against the `.pdf`. Confirm re-import is
idempotent, not duplicated.

### ⬜ Phase 7 — Packaging
Capacitor Android + Tauri desktop, both consuming the same `dist/`.
**Write `src/platform/fs.ts` (Capacitor | Tauri | browser) BEFORE wiring export
in Phase 3**, or it gets written three times.

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

  Honest numbers: **eager JS is 731kb raw / 227kb gzip across 13 chunks**, up
  from Phase 1's 524kb / 159kb single chunk. The growth is real work, not bloat:
  react-router (89kb) and dexie (95kb) are both newly on the boot path, plus
  AppShell/SideNav/MobileNav. Route splitting is doing its job — each page chunk
  is under 1kb.

  **The one genuinely suspicious item is `useTranslator`, 101kb / 26kb gzip**:
  Astryx's i18n, being the full ICU message-format parser plus a 71kb `en.json`,
  eagerly loaded, for a single-user single-locale app. Worth asking whether
  Astryx can precompile messages or ship a lite locale before Phase 8.
- **`Transactions` vs `Ledger` was a Phase 2 judgement call.** The Phase 3 list
  names both without distinguishing them. They are currently scaffolded as:
  Transactions = the filterable list of every entry across accounts; Ledger =
  one account's register with a running balance, which is also how a suspect
  derived balance gets checked. If that is not the intent, Phase 3 should
  collapse them — it is two route stubs, not two implementations.
- **Astryx pre-1.0 churn.** Keep Astryx behind wrappers in `src/components/` so
  breaking changes hit a few files, not every screen. Run
  `npx astryx upgrade --apply` after any core bump.
- **Not a risk: performance.** ~100 transactions. Skip virtualization and other
  premature optimization until the ledger is actually slow.
- **Sequencing.** Phases 0–4 give a better app than the current one with zero
  backend risk. **Keep the old app installed until Phase 6 verification passes** —
  two copies of real financial data beats one behind unproven sync.

---

## 8. Commands

```bash
npm run dev          # Vite dev server on :5173
npm run build        # tsc -b && vite build
npm test             # vitest run  (88 passing)
npm run test:watch
npm run preview      # serve dist/ on :4173 — use this, not `dev`, to check
                     # that deep links resolve their assets

npx astryx doctor            # validate Astryx wiring
npx astryx component <Name>  # exact props — use instead of guessing
npx astryx docs layout       # read before building any page
```

Supabase project `lwcelvtqpfvssxkabvun` is reachable via the Supabase MCP
server, so migrations can be applied directly.

### Environment notes

- **Git identity is set repo-local** (`.git/config`) to `IronMore3265` /
  `135731975+IronMore3265@users.noreply.github.com`. The noreply address keeps
  a real email out of this public repo's permanent history. Do not switch it to
  a real address.
- **PowerShell 5.1 mangles multi-line arguments** passed to native commands, so
  `git commit -m` with a multi-line message fails oddly. Write the message to a
  file and use `git commit -F <file>`.
- Commits so far go straight to `main`; there is no PR workflow set up.
