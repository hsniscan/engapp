import type { IconName } from './icon-paths';

/** A tab of the bottom bar / side rail: a link to a section of the app. */
export interface NavLinkItem {
  kind: 'link';
  to: string;
  /** i18n key under nav.* */
  labelKey: 'nav.home' | 'nav.decks' | 'nav.progress' | 'nav.profile';
  icon: IconName;
  end?: boolean;
  /** Other path prefixes that belong to this tab (e.g. /library under "Desteler"). */
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
 * The five places of the redesign: Bugün · Desteler · (+) · İlerleme · Profil.
 * Settings live under Profil; the word list ("Tüm kelimelerim") and the add flows under Desteler.
 */
export const navItems: NavItem[] = [
  { kind: 'link', to: '/', labelKey: 'nav.home', icon: 'home', end: true },
  {
    kind: 'link',
    to: '/decks',
    labelKey: 'nav.decks',
    icon: 'cards',
    also: ['/library', '/add', '/import'],
  },
  { kind: 'add', labelKey: 'nav.add', icon: 'plus' },
  { kind: 'link', to: '/progress', labelKey: 'nav.progress', icon: 'chart' },
  {
    kind: 'link',
    to: '/profile',
    labelKey: 'nav.profile',
    icon: 'user',
    also: ['/settings'],
  },
];
