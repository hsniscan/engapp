import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useOutlet } from 'react-router';
import { cn } from './cn';
import { Icon } from './Icon';
import { isNavActive, type NavLinkItem } from './nav';
import { SideRail, TabBar } from './TabBar';
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
        <SideRail
          isActive={isActive}
          onAdd={onAdd}
          addOpen={addOpen}
          addSection={addSection}
          syncSlot={syncSlot}
        />
      )}

      {immersive && !ownTopBar && (
        <header className="safe-top sticky top-0 z-20 border-b border-border bg-canvas">
          <div className="mx-auto flex h-14 items-center gap-2 px-2 sm:px-4">
            <Tooltip content={exit?.label ?? t('review.endSession')}>
              <Link
                to={exit?.to ?? '/'}
                aria-label={exit?.label ?? t('review.endSession')}
                className="inline-flex size-11 items-center justify-center rounded-full text-fg-muted hover:bg-hover hover:text-fg"
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
        <TabBar isActive={isActive} onAdd={onAdd} addOpen={addOpen} addSection={addSection} />
      )}
    </div>
  );
}
