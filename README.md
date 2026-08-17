# Finance Tracker

An offline-first personal finance tracker — accounts, transactions, recurring
payments, debts, budgets, and analytics — built to run as a web app, an Android
app, and a desktop app from one codebase.

> **Status: in development.** The data layer and domain logic are complete and
> tested; the UI is being built. See [PROGRESS.md](PROGRESS.md) for the full
> roadmap and current state.

## Why

This replaces an Android-only Kotlin app whose transactions and debts could not
be edited after entry — only deleted and re-created. The rewrite fixes that,
adds per-category budgets and real analytics, and runs on more than one device.

## Stack

| | |
|---|---|
| UI | [Astryx](https://astryx.atmeta.com) + React 19 + TypeScript |
| Build | Vite 8, Tailwind v4 |
| Animation | [Motion](https://motion.dev) |
| Storage | Dexie (IndexedDB), offline-first |
| Sync | Supabase — opt-in; the app works fully logged-out |
| Charts | visx |
| Packaging | Capacitor (Android), Tauri (desktop) |

## Design notes

Two decisions are worth calling out, because they are what make the app
correct rather than merely working:

**Balances are derived, never stored.** Accounts hold an opening balance; the
current balance is a pure function of the ledger. A stored, incrementally
mutated balance drifts permanently the moment any write fails — and gives no
way to notice.

**Recurring transactions are rules, not pointers.** A rule generates an indexed
sequence of occurrences, so a single occurrence can be skipped or corrected
("this occurrence only" / "this and all future") without disturbing the series.

## Development

```bash
npm install
npm run dev      # http://localhost:5173
npm test
npm run build
```

## Licence

MIT
