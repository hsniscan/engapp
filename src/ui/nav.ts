import type { IconName } from './icon-paths';

export interface NavItem {
  to: string;
  /** i18n key under nav.* */
  labelKey: 'nav.home' | 'nav.add' | 'nav.library' | 'nav.stats';
  icon: IconName;
  end?: boolean;
}

export const navItems: NavItem[] = [
  { to: '/', labelKey: 'nav.home', icon: 'home', end: true },
  { to: '/add', labelKey: 'nav.add', icon: 'plus' },
  { to: '/library', labelKey: 'nav.library', icon: 'cards' },
  { to: '/stats', labelKey: 'nav.stats', icon: 'chart' },
];
