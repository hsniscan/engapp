import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useOutlet } from 'react-router';
import { Logo } from './brand/Logo';
import { cn } from './cn';
import { Icon } from './Icon';
import { isNavActive, navItems, type NavLinkItem } from './nav';
import { Tooltip } from './Tooltip';

export interface AppShellProps {
  /** Sync status indicator (side rail on wide screens, slim bar of immersive pages). */
  syncSlot?: ReactNode;
  /**
   * Immersive pages (a study session) hide the navigation and show a slim bar with a close
   * link instead. Feature routes opt in through their route `handle`.
   */
  immersive?: boolean;
  /**
   * Immersive pages that draw their own top bar (close, progress): the shell draws none.
   */
  ownTopBar?: boolean;
  /**
   * Where the immersive bar's close (✕) link goes and what it is called. Default: home,
   * "Oturumu bitir" (review, practice, level test). One close control per screen: immersive
   * pages do not draw their own back link.
   */
  exit?: { to: string; label: string };
  /** The raised (+) of the tab bar: opens the Add sheet. */
  onAdd?: () => void;
  /** The Add sheet is open (for aria-expanded on the (+)). */
  addOpen?: boolean;
  /**
   * The current page is one of the (+) flows (/add, /makale, /import/…; route handle
   * `navSection: 'add'`): no tab is current, the (+) is marked instead.
   */
  addSection?: boolean;
  /** Override the routed content (used by tests/the gallery); defaults to the router outlet. */
  children?: ReactNode;
}

/**
 * Application frame. Phones: no top bar (every screen draws its own header) and a bottom tab
 * bar of five: Bugün · Kelimelerim · (+) · Keşfet · Profil. ≥768 px: a left rail; ≥1024 px the
 * rail widens to a labelled sidebar. The (+) opens the Add sheet, it is not a page.
 */
export function AppShell({
  syncSlot,
  immersive = false,
  ownTopBar = false,
  exit,
  onAdd,
  addOpen,
  addSection = false,
  children,
}: AppShellProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const outlet = useOutlet();
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);

  // On navigation: reset scroll and move focus to the new page, so screen readers start there.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  const content = children ?? outlet;
  const isActive = (item: NavLinkItem) => !addSection && isNavActive(item, location.pathname);

  return (
    <div className={cn('min-h-dvh bg-canvas text-fg', !immersive && 'md:pl-22 lg:pl-60')}>
      <a
        href="#main"
        className="sr-only z-50 rounded-control bg-surface-raised px-4 py-3 font-medium text-fg shadow-overlay focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        {t('nav.skipToContent')}
      </a>

      {!immersive && (
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-22 flex-col border-r border-border bg-canvas md:flex lg:w-60">
          <Link
            to="/"
            className="mx-auto mt-5 mb-6 flex h-11 items-center rounded-control px-1 lg:mx-4 lg:px-2"
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
              {navItems.map((item) =>
                item.kind === 'add' ? (
                  <li key="add" className="my-2">
                    <button
                      type="button"
                      onClick={onAdd}
                      aria-haspopup="dialog"
                      aria-expanded={addOpen ?? false}
                      aria-current={addSection ? 'page' : undefined}
                      className={cn(
                        addSection && 'ring-2 ring-accent ring-offset-2 ring-offset-canvas',
                        'flex min-h-14 w-full flex-col items-center justify-center gap-1 rounded-control bg-fg px-2 text-xs font-medium text-fg-inverse',
                        'lg:min-h-11 lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:text-[0.9375rem]',
                        'transition-opacity duration-(--duration-micro) hover:opacity-90',
                      )}
                    >
                      <Icon name={item.icon} size={22} strokeWidth={2} />
                      <span>{t(item.labelKey)}</span>
                    </button>
                  </li>
                ) : (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      aria-current={isActive(item) ? 'page' : undefined}
                      className={cn(
                        'group flex min-h-14 flex-col items-center justify-center gap-1 rounded-control px-2 text-xs font-medium',
                        'lg:min-h-11 lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:text-[0.9375rem]',
                        'transition-colors duration-(--duration-micro)',
                        isActive(item)
                          ? 'bg-selected text-fg'
                          : 'text-fg-muted hover:bg-hover hover:text-fg',
                      )}
                    >
                      <Icon name={item.icon} size={22} />
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
      )}

      {immersive && !ownTopBar && (
        <header className="safe-top sticky top-0 z-20 border-b border-border bg-canvas">
          <div className="mx-auto flex h-14 items-center gap-2 px-2 sm:px-4">
            <Tooltip content={exit?.label ?? t('review.endSession')}>
              <Link
                to={exit?.to ?? '/'}
                aria-label={exit?.label ?? t('review.endSession')}
                className="inline-flex size-11 items-center justify-center rounded-control text-fg-muted hover:bg-hover hover:text-fg"
              >
                <Icon name="x" size={22} />
              </Link>
            </Tooltip>
            <div className="ml-auto flex items-center gap-1">{syncSlot}</div>
          </div>
        </header>
      )}

      <main
        id="main"
        ref={mainRef}
        tabIndex={-1}
        className={cn(
          'outline-none',
          !immersive &&
            'safe-top pb-[calc(var(--nav-height)+env(safe-area-inset-bottom)+1.5rem)] md:pb-0',
        )}
      >
        {/* CSS-only page enter (keyed by path; no exit wait, so a switch never lags). */}
        <div key={location.pathname} className="animate-page-in">
          {content}
        </div>
      </main>

      {!immersive && (
        <nav
          aria-label={t('nav.primary')}
          className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface md:hidden"
        >
          <ul className="mx-auto grid h-(--nav-height) max-w-md grid-cols-5">
            {navItems.map((item) =>
              item.kind === 'add' ? (
                <li key="add" className="flex items-start justify-center">
                  <button
                    type="button"
                    onClick={onAdd}
                    aria-label={t('nav.addLong')}
                    aria-haspopup="dialog"
                    aria-expanded={addOpen ?? false}
                    aria-current={addSection ? 'page' : undefined}
                    data-testid="nav-add"
                    className={cn(
                      '-mt-5 flex size-14 items-center justify-center rounded-[18px] bg-fg text-fg-inverse shadow-raised transition-transform duration-(--duration-micro) active:scale-95',
                      addSection && 'ring-2 ring-accent ring-offset-2 ring-offset-surface',
                    )}
                  >
                    <Icon name={item.icon} size={26} strokeWidth={2} />
                  </button>
                </li>
              ) : (
                <li key={item.to} className="flex">
                  <Link
                    to={item.to}
                    aria-current={isActive(item) ? 'page' : undefined}
                    className={cn(
                      'relative flex flex-1 flex-col items-center justify-center gap-1 text-[0.75rem]',
                      'transition-colors duration-(--duration-micro) focus-visible:outline-offset-[-4px]',
                      isActive(item)
                        ? 'font-semibold text-accent-text'
                        : 'font-medium text-fg-muted',
                    )}
                  >
                    <Icon name={item.icon} size={24} strokeWidth={isActive(item) ? 1.8 : 1.6} />
                    <span>{t(item.labelKey)}</span>
                  </Link>
                </li>
              ),
            )}
          </ul>
        </nav>
      )}
    </div>
  );
}
