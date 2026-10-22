import { useEffect, type ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { Link } from 'react-router';
import { Logo, buttonClasses } from '@/ui';

/**
 * Frame of the public pages (/gizlilik, /privacy, /hesap-sil): no app navigation, readable
 * without an account and without the local database. "Back to the app" is a full page load,
 * so the app shell starts from scratch (auth linking, sync) after a page that may have
 * started a session on its own.
 */
export function PublicLayout({
  t,
  lang,
  children,
}: {
  t: TFunction;
  lang: 'tr' | 'en';
  children: ReactNode;
}) {
  useEffect(() => {
    const prev = document.documentElement.lang;
    document.documentElement.lang = lang;
    return () => {
      document.documentElement.lang = prev;
    };
  }, [lang]);

  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-fg">
      <header className="safe-top border-b border-border">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <a href="/" className="rounded-control">
            <Logo size={28} />
          </a>
          <a href="/" className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
            {t('legal.toApp')}
          </a>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 pt-8 pb-14 sm:px-6 md:pt-12">
        {children}
      </main>
      <footer className="border-t border-border">
        <nav
          aria-label={t('legal.footerNav')}
          className="mx-auto flex w-full max-w-3xl flex-wrap gap-x-6 gap-y-2 px-4 py-5 text-sm sm:px-6"
        >
          <Link to="/gizlilik" className="text-fg-muted hover:text-fg">
            {t('legal.privacyLink')}
          </Link>
          <Link to="/privacy" className="text-fg-muted hover:text-fg">
            {t('legal.privacyEnLink')}
          </Link>
          <Link to="/hesap-sil" className="text-fg-muted hover:text-fg">
            {t('legal.deleteLink')}
          </Link>
        </nav>
      </footer>
    </div>
  );
}
