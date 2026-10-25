// "Desteler" (redesign, boards DecksMine / DecksDiscover / DecksBank): one screen with three
// segments, kept in the URL as /decks?tab=mine|discover|bank so each can be linked and the
// back button leaves the screen instead of stepping through segments.
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { cn, Skeleton } from '@/ui';
import { DECK_TABS, type DeckTab, deckTabHref, parseDeckTab } from './deckUi';
import { MineTab } from './MineTab';
import { Glyph } from './parts';

const DiscoverTab = lazy(() => import('./DiscoverTab').then((m) => ({ default: m.DiscoverTab })));
const BankTab = lazy(() =>
  import('@/features/wordbank/WordBankPage').then((m) => ({ default: m.WordBankPanel })),
);

export function DecksPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const tab = parseDeckTab(params.get('tab'));
  const labels: Record<DeckTab, string> = {
    mine: t('deckHub.tabMine'),
    discover: t('deckHub.tabDiscover'),
    bank: t('deckHub.tabBank'),
  };

  return (
    <div className="mx-auto w-full max-w-2xl pb-10">
      <header className="flex items-center justify-between pt-3.5 pr-4 pb-1 pl-5">
        <h1 className="font-serif text-[30px] leading-tight font-semibold text-fg">
          {t('deckHub.title')}
        </h1>
        <Link
          to="/add"
          aria-label={t('deckHub.import')}
          className="flex size-11 items-center justify-center rounded-full text-fg-muted hover:bg-hover"
        >
          <Glyph name="download" size={22} />
        </Link>
      </header>

      <nav
        aria-label={t('deckHub.segments')}
        className="mx-4 mt-2 grid grid-cols-3 gap-1 rounded-[14px] bg-surface-sunken p-1"
      >
        {DECK_TABS.map((key) => (
          <Link
            key={key}
            to={deckTabHref(key)}
            replace
            aria-current={tab === key ? 'page' : undefined}
            className={cn(
              'flex h-10 items-center justify-center rounded-[11px] px-1 text-center text-sm leading-tight',
              tab === key
                ? 'bg-surface-raised font-semibold text-fg shadow-[0_1px_2px_rgb(31_29_26/0.12)]'
                : 'text-fg-muted hover:text-fg',
            )}
          >
            {labels[key]}
          </Link>
        ))}
      </nav>

      <div className="px-4 pt-4">
        {tab === 'mine' ? (
          <MineTab />
        ) : (
          <Suspense fallback={<Skeleton lines={6} />}>
            {tab === 'discover' ? <DiscoverTab /> : <BankTab />}
          </Suspense>
        )}
      </div>
    </div>
  );
}
