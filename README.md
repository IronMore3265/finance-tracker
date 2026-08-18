# Finance Tracker

An offline-first personal finance tracker — accounts, transactions, recurring
payments, debts, budgets, and analytics — built to run as a web app, an Android
app, and a desktop app from one codebase.

> **Status: in development.** Every screen is built, cloud sync works, the
> importer that moves data off the old Android app is verified against the real
> export, and both native shells are wired up — the Android app builds to an
> APK today. What is left is polish, and running the packaged builds on real
> hardware. See [PROGRESS.md](PROGRESS.md) for the full roadmap and current
> state.

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
| Sync | Supabase — opt-in; the app works fully logged-out. Needs `.env`, see [.env.example](.env.example) |
| Charts | visx |
| Migration | SheetJS, lazy-loaded — reads the old Android app's `.xls` export |
| Packaging | Capacitor (Android), Tauri (desktop) |

## Design notes

Two decisions are worth calling out, because they are what make the app
correct rather than merely working:

**Balances are derived, never stored.** Accounts hold an opening balance; the
current balance is a pure function of the ledger. A stored, incrementally
mutated balance drifts permanently the moment any write fails — and gives no
way to notice.

It also decides how migration works: the old app exported a *current* balance,
so the importer solves for the opening balance that reproduces it from the
ledger, rather than copying a number that would then be counted twice.

**Recurring transactions are rules, not pointers.** A rule generates an indexed
sequence of occurrences, so a single occurrence can be skipped or corrected
("this occurrence only" / "this and all future") without disturbing the series.

## Development

```bash
npm install
npm run dev      # http://localhost:5173
npm test
npm run build

npm run test:import   # reconcile the old app's export against its own report
```

## Running it as an app

One web build (`dist/`) is the payload for all three targets; the shells add
only what a web page cannot do for itself — a real file dialog, a working
system back button.

```bash
# Android — needs the Android SDK and a JDK
npm run android:sync              # build the web app and copy it into android/
npm run android:run               # the same, then install on a connected device
cd android && ./gradlew assembleDebug   # or just produce app-debug.apk

# Desktop — needs the Rust toolchain (https://rustup.rs) and, on Windows,
# the Visual Studio C++ build tools
npm run tauri:dev
npm run tauri:build
```

`android/` and `src-tauri/` are committed: they are scaffolded once and then
carry real settings, so regenerating them is not a substitute for keeping them.
Their build output is not committed.

## Licence

MIT
