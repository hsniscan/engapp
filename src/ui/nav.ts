import type { IconName } from './icon-paths';

/** A tab of the bottom bar / side rail: a link to a section of the app. */
export interface NavLinkItem {
  kind: 'link';
  to: string;
  /** i18n key under nav.* */
  labelKey: 'nav.home' | 'nav.decks' | 'nav.discover' | 'nav.profile';
  icon: IconName;
  end?: boolean;
  /** Other path prefixes that belong to this tab (e.g. /library under "Kelimelerim"). */
  also?: string[];
}

/** The raised (+) in the middle: opens the Add sheet, never navigates. */
export interface NavActionItem {
  kind: 'add';
  labelKey: 'nav.add';
  icon: IconName;
}

export type NavItem = NavLinkItem | NavActionItem;

/** True when `pathname` is one of the item's extra sections (`also`), or below one. */
export function navAlsoActive(item: NavLinkItem, pathname: string): boolean {
  return (item.also ?? []).some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** The tab that owns `pathname`: its own path (exactly, for `end`), below it, or an `also` section. */
export function isNavActive(item: NavLinkItem, pathname: string): boolean {
  const own = item.end
    ? pathname === item.to
    : pathname === item.to || pathname.startsWith(`${item.to}/`);
  return own || navAlsoActive(item, pathname);
}

/**
 * The five places (v0.5.1, ADR 0057): Bugün · Kelimelerim · (+) · Keşfet · Profil.
 * Kelimelerim holds what is the user's own (decks, every word, the word bank to pick from);
 * Keşfet is the feed of what there is to find (texts, suggested decks, words of the day);
 * İlerleme lives at the top of Profil, settings under it. /add belongs to no tab: it is the
 * (+) sheet's own flow.
 */
export const navItems: NavItem[] = [
  { kind: 'link', to: '/', labelKey: 'nav.home', icon: 'home', end: true },
  {
    kind: 'link',
    to: '/decks',
    labelKey: 'nav.decks',
    icon: 'cards',
    also: ['/library'],
  },
  { kind: 'add', labelKey: 'nav.add', icon: 'plus' },
  {
    kind: 'link',
    to: '/kesfet',
    labelKey: 'nav.discover',
    icon: 'compass',
    also: ['/kitaplik', '/oku'],
  },
  {
    kind: 'link',
    to: '/profile',
    labelKey: 'nav.profile',
    icon: 'user',
    also: ['/settings', '/progress'],
  },
];
