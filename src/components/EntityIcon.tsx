/**
 * Category and account glyphs.
 *
 * Categories store a Lucide icon *name* (`'shopping-bag'`) rather than a
 * component, because the name is data — it round-trips through the database,
 * the export file, and eventually Supabase. Resolving a name to a component
 * therefore needs a registry, and this is it.
 *
 * The registry is an explicit list rather than a dynamic
 * `import('lucide-react')[toPascalCase(name)]`, for two reasons. A dynamic
 * property lookup on the barrel defeats tree-shaking and pulls all ~1500
 * Lucide icons into the bundle. And an unknown name would resolve to
 * `undefined` and crash at render, whereas here it falls back visibly.
 *
 * Colours are applied with an inline `style`, which is the one case the
 * project's "no raw hex" rule does not cover: `colorHex` is user data, chosen
 * per row at runtime. A design token cannot express it and `xstyle` cannot
 * either — StyleX resolves at build time. Every *design* colour in the app
 * still comes from tokens.
 */
import {Icon} from '@astryxdesign/core/Icon';
import {
  Banknote,
  Book,
  Briefcase,
  Bus,
  Car,
  CircleEllipsis,
  CreditCard,
  Dumbbell,
  Film,
  Fuel,
  Gamepad2,
  Gift,
  GraduationCap,
  Handshake,
  HeartPulse,
  Home,
  Landmark,
  Laptop,
  PawPrint,
  PiggyBank,
  Pill,
  Plane,
  Receipt,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Utensils,
  Wallet,
  Wifi,
  Wrench,
} from 'lucide-react';
import type {AccountIcon} from '../db/types';
import type {NavIconComponent} from '../app/nav';

/**
 * The icons offered in the category picker, keyed by the kebab-case name
 * stored on the row. Seed categories (seed.ts) all appear here.
 */
export const CATEGORY_ICONS: Record<string, NavIconComponent> = {
  utensils: Utensils,
  'shopping-cart': ShoppingCart,
  'shopping-bag': ShoppingBag,
  car: Car,
  bus: Bus,
  fuel: Fuel,
  home: Home,
  receipt: Receipt,
  wifi: Wifi,
  smartphone: Smartphone,
  book: Book,
  'graduation-cap': GraduationCap,
  pill: Pill,
  'heart-pulse': HeartPulse,
  dumbbell: Dumbbell,
  film: Film,
  gamepad: Gamepad2,
  gift: Gift,
  plane: Plane,
  shirt: Shirt,
  'paw-print': PawPrint,
  wrench: Wrench,
  banknote: Banknote,
  laptop: Laptop,
  briefcase: Briefcase,
  handshake: Handshake,
  'circle-ellipsis': CircleEllipsis,
};

export const CATEGORY_ICON_NAMES = Object.keys(CATEGORY_ICONS);

/** Account icons are a closed union in the schema, so this map is total. */
const ACCOUNT_ICONS: Record<AccountIcon, NavIconComponent> = {
  wallet: Wallet,
  bank: Landmark,
  card: CreditCard,
  savings: PiggyBank,
};

export const ACCOUNT_ICON_NAMES = Object.keys(ACCOUNT_ICONS) as AccountIcon[];

export interface EntityIconProps {
  /** Kebab-case Lucide name for a category, or an AccountIcon. */
  name: string;
  /** The row's `colorHex`. Omit to inherit the surrounding text colour. */
  color?: string;
  size?: 'xsm' | 'sm' | 'md' | 'lg';
  /**
   * Accessible name. Omit when adjacent text already names the thing —
   * a category row that reads "Food" does not also need "Food icon".
   */
  label?: string;
}

export function EntityIcon({name, color, size = 'md', label}: EntityIconProps) {
  const component =
    CATEGORY_ICONS[name] ?? ACCOUNT_ICONS[name as AccountIcon] ?? CircleEllipsis;

  return (
    <Icon
      icon={component}
      size={size}
      {...(label !== undefined && {label})}
      // `color` is per-row user data; see the note at the top of this file.
      {...(color !== undefined && {style: {color}})}
    />
  );
}

/**
 * The colours offered when creating a category or account.
 *
 * Starts from the palette the seed data already uses, so a fresh database and
 * a user-created row look like they belong to the same app. Material's 500
 * shades: they were the old app's palette, and they hold contrast on both the
 * light and dark theme surfaces.
 */
export const ENTITY_COLORS = [
  '#EA3B35',
  '#E91E63',
  '#9C27B0',
  '#3F51B5',
  '#2196F3',
  '#00BCD4',
  '#009688',
  '#4CAF50',
  '#8BC34A',
  '#FF9800',
  '#795548',
  '#607D8B',
  '#F44336',
  '#9E9E9E',
] as const;
