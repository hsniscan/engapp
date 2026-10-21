import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, useLocation, useMatch, useOutlet } from 'react-router';
import { Logo } from './brand/Logo';
import { cn } from './cn';
import { Icon } from './Icon';
import { navAlsoActive, navItems } from './nav';
import { Tooltip } from './Tooltip';

export interface AppShellProps {
  /** Sync status indicator for the top bar (e.g. <SyncStatus />). */
  syncSlot?: ReactNode;
  /**
   * Immersive pages (the review session) hide the navigation and show a slim bar with a
   * close link instead. Feature routes opt in through their route `handle`.
   */
  immersive?: boolean;
  /** Override the routed content (used by tests/the gallery); defaults to the router outlet. */
  children?: ReactNode;
}

/**
 * Application frame. Phones: top bar (logo, sync, settings) + bottom tab bar.
 * ≥768 px: left rail; ≥1024 px: the rail widens to a labelled sidebar.
 */
export function AppShell({ syncSlot, immersive = false, children }: AppShellProps) {
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

  // Tooltip's trigger merges classNames as strings, so NavLink's function form can't be used here.
  const settingsActive = useMatch('/settings') !== null;
  const settingsLink = (
    <Tooltip content={t('nav.settings')}>
      <Link
        to="/settings"
        aria-label={t('nav.settings')}
        aria-current={settingsActive ? 'page' : undefined}
        className={cn(
          'inline-flex size-11 items-center justify-center rounded-control transition-colors duration-(--duration-micro)',
          settingsActive ? 'bg-selected text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
        )}
      >
        <Icon name="settings" size={22} />
      </Link>
    </Tooltip>
  );

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
            className="mx-auto mt-5 mb-8 flex h-11 items-center rounded-control px-1 lg:mx-4 lg:px-2"
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
              {navItems.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={({ isActive: routeActive }) => {
                      const isActive = routeActive || navAlsoActive(item, location.pathname);
                      return cn(
                        'group flex min-h-14 flex-col items-center justify-center gap-1 rounded-control px-2 text-xs font-medium',
                        'lg:min-h-11 lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:text-[0.9375rem]',
                        'transition-colors duration-(--duration-micro)',
                        isActive
                          ? 'bg-selected text-fg'
                          : 'text-fg-muted hover:bg-hover hover:text-fg',
                      );
                    }}
                  >
                    <Icon name={item.icon} size={22} />
                    <span>{t(item.labelKey)}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
      )}

      <header className="safe-top sticky top-0 z-20 border-b border-border bg-canvas">
        <div className="mx-auto flex h-14 items-center gap-2 px-2 sm:px-4">
          {immersive ? (
            <Tooltip content={t('review.endSession')}>
              <Link
                to="/"
                aria-label={t('review.endSession')}
                className="inline-flex size-11 items-center justify-center rounded-control text-fg-muted hover:bg-hover hover:text-fg"
              >
                <Icon name="x" size={22} />
              </Link>
            </Tooltip>
          ) : (
            <Link to="/" className="flex h-11 items-center rounded-control px-2 md:hidden">
              <Logo size={26} />
            </Link>
          )}
          <div className="ml-auto flex items-center gap-1">
            {syncSlot}
            {!immersive && settingsLink}
          </div>
        </div>
      </header>

      <main
        id="main"
        ref={mainRef}
        tabIndex={-1}
        className={cn(
          'outline-none',
          !immersive && 'pb-[calc(var(--nav-height)+env(safe-area-inset-bottom))] md:pb-0',
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
          className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-border bg-canvas md:hidden"
        >
          <ul className="mx-auto grid h-(--nav-height) max-w-md grid-cols-4">
            {navItems.map((item) => (
              <li key={item.to} className="flex">
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive: routeActive }) =>
                    cn(
                      'relative flex flex-1 flex-col items-center justify-center gap-1 text-[0.75rem] font-medium',
                      'transition-colors duration-(--duration-micro) focus-visible:outline-offset-[-4px]',
                      routeActive || navAlsoActive(item, location.pathname)
                        ? 'text-fg'
                        : 'text-fg-muted',
                    )
                  }
                >
                  {({ isActive: routeActive }) => {
                    const isActive = routeActive || navAlsoActive(item, location.pathname);
                    return (
                      <>
                        <span
                          aria-hidden="true"
                          className={cn(
                            'absolute top-0 h-0.5 w-8 rounded-b-full bg-accent transition-opacity duration-(--duration-micro)',
                            isActive ? 'opacity-100' : 'opacity-0',
                          )}
                        />
                        <Icon name={item.icon} size={24} strokeWidth={isActive ? 1.8 : 1.6} />
                        <span>{t(item.labelKey)}</span>
                      </>
                    );
                  }}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
