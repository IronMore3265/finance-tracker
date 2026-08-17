/**
 * The app's destinations, defined once.
 *
 * This list is the single source of truth for three things that must never
 * disagree: the side nav (and therefore the mobile drawer, which AppShell
 * generates from the same node), the route table in `routes.tsx`, and the
 * document title. Adding a screen means adding a row here and a lazy route.
 *
 * Icons are Lucide components rather than Astryx semantic names — the semantic
 * registry (`npx astryx docs icons`) covers UI affordances like chevrons and
 * search, not domain nouns like "wallet" or "receipt".
 */
import type {ComponentType, SVGProps} from 'react';
import {
  ArrowLeftRight,
  CalendarSync,
  ChartColumn,
  HandCoins,
  LayoutDashboard,
  ScrollText,
  Settings,
  Tags,
  Target,
  Trash2,
  Wallet,
} from 'lucide-react';

export type NavIconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export interface NavDestination {
  /** Absolute route path. Must match a route in `routes.tsx`. */
  path: string;
  /** Nav label and page `<h1>`. Also drives `document.title`. */
  label: string;
  icon: NavIconComponent;
}

export interface NavSection {
  title: string;
  items: NavDestination[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Overview',
    items: [
      {path: '/', label: 'Dashboard', icon: LayoutDashboard},
      {path: '/analytics', label: 'Analytics', icon: ChartColumn},
    ],
  },
  {
    title: 'Money',
    items: [
      {path: '/transactions', label: 'Transactions', icon: ArrowLeftRight},
      {path: '/ledger', label: 'Ledger', icon: ScrollText},
      {path: '/accounts', label: 'Accounts', icon: Wallet},
      {path: '/planned', label: 'Planned', icon: CalendarSync},
      {path: '/debts', label: 'Debts', icon: HandCoins},
      {path: '/budgets', label: 'Budgets', icon: Target},
    ],
  },
  {
    title: 'Manage',
    items: [
      {path: '/categories', label: 'Categories', icon: Tags},
      {path: '/trash', label: 'Trash', icon: Trash2},
      {path: '/settings', label: 'Settings', icon: Settings},
    ],
  },
];

export const NAV_DESTINATIONS: NavDestination[] = NAV_SECTIONS.flatMap(
  (section) => section.items,
);

/**
 * Whether `path` is the destination the current URL belongs to.
 *
 * Prefix matching is what makes a detail route (`/accounts/:id`) keep its
 * parent lit in the nav; `/` is special-cased because every path is prefixed
 * by it and it would otherwise always match.
 */
export function isDestinationActive(pathname: string, path: string): boolean {
  if (path === '/') return pathname === '/';
  return pathname === path || pathname.startsWith(`${path}/`);
}

/** The destination the current URL belongs to, or undefined for 404s. */
export function matchDestination(pathname: string): NavDestination | undefined {
  // Longest path first, so `/ledger/x` prefers `/ledger` over `/`.
  return [...NAV_DESTINATIONS]
    .sort((a, b) => b.path.length - a.path.length)
    .find((destination) => isDestinationActive(pathname, destination.path));
}
