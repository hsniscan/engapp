import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Logo } from './brand/Logo';
import { cn } from './cn';
import { Icon } from './Icon';
import { navItems, type NavLinkItem } from './nav';
import type { ReactNode } from 'react';

export interface TabBarProps {
  isActive: (item: NavLinkItem) => boolean;
  onAdd?: () => void;
  addOpen?: boolean;
  addSection?: boolean;
}

/**
 * Phone tab bar (< 768 px): five equal slots, 64 px + safe area, hairline top, no raised FAB.
 * The (+) is a calm tonal pill in the middle slot with its "Ekle" label, the same height as
 * its neighbours — it never competes with a screen's primary button (review O-4).
 */
export function TabBar({ isActive, onAdd, addOpen, addSection }: TabBarProps) {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t('nav.primary')}
      className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-border bg-canvas/95 backdrop-blur-md md:hidden"
    >
      <ul className="mx-auto grid h-(--nav-height) max-w-md grid-cols-5">
        {navItems.map((item) =>
          item.kind === 'add' ? (
            <li key="add" className="flex">
              <button
                type="button"
                onClick={onAdd}
                aria-label={t('nav.addLong')}
                aria-haspopup="dialog"
                aria-expanded={addOpen ?? false}
                aria-current={addSection ? 'page' : undefined}
                data-testid="nav-add"
                className="group flex flex-1 flex-col items-center justify-center gap-1 text-caption font-semibold text-accent-text focus-visible:outline-offset-[-4px]"
              >
                <span
                  className={cn(
                    'flex h-8 w-14 items-center justify-center rounded-full bg-accent-soft transition-[background-color,transform] duration-(--duration-micro) group-active:scale-95',
                    (addSection || addOpen) && 'bg-accent text-accent-fg',
                  )}
                >
                  <Icon name={item.icon} size={22} strokeWidth={2} />
                </span>
                <span aria-hidden="true">{t(item.labelKey)}</span>
              </button>
            </li>
          ) : (
            <li key={item.to} className="flex">
              <Link
                to={item.to}
                aria-current={isActive(item) ? 'page' : undefined}
                className={cn(
                  'flex flex-1 flex-col items-center justify-center gap-1 text-caption',
                  'transition-colors duration-(--duration-micro) focus-visible:outline-offset-[-4px]',
                  isActive(item) ? 'font-semibold text-fg' : 'font-medium text-fg-muted',
                )}
              >
                <span
                  className={cn(
                    'flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-(--duration-micro)',
                    isActive(item) && 'bg-selected',
                  )}
                >
                  <Icon name={item.icon} size={22} strokeWidth={isActive(item) ? 2 : 1.6} />
                </span>
                <span>{t(item.labelKey)}</span>
              </Link>
            </li>
          ),
        )}
      </ul>
    </nav>
  );
}

export interface SideRailProps extends TabBarProps {
  syncSlot?: ReactNode;
}

/**
 * ≥768 px: an 88 px icon rail; ≥1024 px a 240 px labelled sidebar. "Ekle" is the first item,
 * a tonal button (not ink-black), then the four places.
 */
export function SideRail({ isActive, onAdd, addOpen, addSection, syncSlot }: SideRailProps) {
  const { t } = useTranslation();
  const add = navItems.find((i) => i.kind === 'add');
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-22 flex-col border-r border-border bg-canvas md:flex lg:w-60">
      <Link
        to="/"
        className="mx-auto mt-5 mb-5 flex h-11 items-center rounded-control px-1 lg:mx-4 lg:px-2"
      >
        <span className="lg:hidden">
          <Logo size={32} wordmark={false} />
        </span>
        <span className="hidden lg:inline-flex">
          <Logo size={28} />
        </span>
      </Link>
      <nav aria-label={t('nav.primary')} className="flex-1">
        <ul className="flex flex-col gap-1 px-3">
          {add && (
            <li className="mb-3">
              <button
                type="button"
                onClick={onAdd}
                aria-haspopup="dialog"
                aria-expanded={addOpen ?? false}
                aria-current={addSection ? 'page' : undefined}
                className={cn(
                  'flex min-h-14 w-full flex-col items-center justify-center gap-1 rounded-control bg-accent-soft px-2 text-caption font-semibold text-accent-text',
                  'lg:min-h-11 lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:text-ui',
                  'transition-colors duration-(--duration-micro) hover:bg-selected',
                  addSection && 'bg-accent text-accent-fg hover:bg-accent-hover',
                )}
              >
                <Icon name={add.icon} size={22} strokeWidth={2} />
                <span>{t(add.labelKey)}</span>
              </button>
            </li>
          )}
          {navItems.map((item) =>
            item.kind === 'add' ? null : (
              <li key={item.to}>
                <Link
                  to={item.to}
                  aria-current={isActive(item) ? 'page' : undefined}
                  className={cn(
                    'group flex min-h-14 flex-col items-center justify-center gap-1 rounded-control px-2 text-caption font-medium',
                    'lg:min-h-11 lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:text-ui',
                    'transition-colors duration-(--duration-micro)',
                    isActive(item)
                      ? 'bg-selected font-semibold text-fg'
                      : 'text-fg-muted hover:bg-hover hover:text-fg',
                  )}
                >
                  <Icon name={item.icon} size={22} strokeWidth={isActive(item) ? 2 : 1.6} />
                  <span>{t(item.labelKey)}</span>
                </Link>
              </li>
            ),
          )}
        </ul>
      </nav>
      {syncSlot && (
        <div className="flex justify-center px-3 pb-5 lg:justify-start lg:px-4">{syncSlot}</div>
      )}
    </aside>
  );
}
