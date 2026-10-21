import type { IconName } from './icon-paths';

export interface NavItem {
  to: string;
  /** i18n key under nav.* */
  labelKey: 'nav.home' | 'nav.add' | 'nav.library' | 'nav.stats';
  icon: IconName;
  end?: boolean;
  /** Other path prefixes that belong to this tab (e.g. /decks under "Kartlar"). */
  also?: string[];
}

/** True when `pathname` is one of the item's extra sections (`also`), or below one. */
export function navAlsoActive(item: NavItem, pathname: string): boolean {
  return (item.also ?? []).some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export const navItems: NavItem[] = [
  { to: '/', labelKey: 'nav.home', icon: 'home', end: true },
  { to: '/add', labelKey: 'nav.add', icon: 'plus' },
  { to: '/library', labelKey: 'nav.library', icon: 'cards', also: ['/decks'] },
  { to: '/stats', labelKey: 'nav.stats', icon: 'chart' },
];
