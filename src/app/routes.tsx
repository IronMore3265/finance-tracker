/**
 * The route table.
 *
 * Every screen is code-split. The object form of `lazy` is used rather than
 * `lazy: () => import(...)` so the page can keep its own descriptive export
 * name instead of being renamed to React Router's magic `Component` export —
 * pages stay ordinary, importable components (which matters for tests), and
 * the split point stays visible at the call site.
 *
 * Splitting here is what clears the >500kb chunk warning from Phase 0: the
 * initial download becomes the frame plus one page, not the whole app.
 *
 * Paths must stay in step with `nav.ts`, which drives the side nav and the
 * document title from the same set of destinations.
 */
import type {RouteObject} from 'react-router';
import {initializeDatabase} from '../db/seed';
import {AppFrame} from './AppFrame';
import {BootFallback} from './BootFallback';
import {RouteError} from './RouteError';

export const routes: RouteObject[] = [
  {
    path: '/',
    Component: AppFrame,
    // The database is opened and seeded here rather than in `main.tsx` so that
    // a failure to open IndexedDB lands in `RouteError` as a real message,
    // instead of rejecting an unhandled promise behind an empty shell.
    loader: async () => {
      await initializeDatabase();
      return null;
    },
    HydrateFallback: BootFallback,
    ErrorBoundary: RouteError,
    children: [
      {
        index: true,
        lazy: {
          Component: async () => (await import('../pages/DashboardPage')).DashboardPage,
        },
      },
      {
        path: 'analytics',
        lazy: {
          Component: async () => (await import('../pages/AnalyticsPage')).AnalyticsPage,
        },
      },
      {
        path: 'transactions',
        lazy: {
          Component: async () =>
            (await import('../pages/TransactionsPage')).TransactionsPage,
        },
      },
      {
        path: 'ledger',
        lazy: {
          Component: async () => (await import('../pages/LedgerPage')).LedgerPage,
        },
      },
      {
        // The same screen, with an account chosen. Deep-linkable, so "open
        // ledger" from an account row is a real URL rather than local state,
        // and the browser's back button works.
        path: 'ledger/:accountId',
        lazy: {
          Component: async () => (await import('../pages/LedgerPage')).LedgerPage,
        },
      },
      {
        path: 'accounts',
        lazy: {
          Component: async () => (await import('../pages/AccountsPage')).AccountsPage,
        },
      },
      {
        path: 'planned',
        lazy: {
          Component: async () => (await import('../pages/PlannedPage')).PlannedPage,
        },
      },
      {
        path: 'debts',
        lazy: {
          Component: async () => (await import('../pages/DebtsPage')).DebtsPage,
        },
      },
      {
        path: 'budgets',
        lazy: {
          Component: async () => (await import('../pages/BudgetsPage')).BudgetsPage,
        },
      },
      {
        path: 'categories',
        lazy: {
          Component: async () =>
            (await import('../pages/CategoriesPage')).CategoriesPage,
        },
      },
      {
        path: 'trash',
        lazy: {
          Component: async () => (await import('../pages/TrashPage')).TrashPage,
        },
      },
      {
        path: 'settings',
        lazy: {
          Component: async () => (await import('../pages/SettingsPage')).SettingsPage,
        },
      },
      {
        path: '*',
        lazy: {
          Component: async () => (await import('../pages/NotFoundPage')).NotFoundPage,
        },
      },
    ],
  },
];
