// "Kelimelerim" (v0.5.1, ADR 0057; was Desteler): only what is the user's own. Two segments,
// kept in the URL as /decks?tab=mine|bank so each can be linked and the back button leaves the
// screen instead of stepping through segments: Destelerim (every word, decks, tags, themes)
// and Kelime bankası (the leveled word list to pick words from). Suggested decks and reading
// moved to the Keşfet tab (/decks?tab=discover|reading redirect there, src/app/redirects.ts).
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { cn, Skeleton } from '@/ui';
import { DECK_TABS, type DeckTab, deckTabHref, openImportSheet, parseDeckTab } from './deckUi';
import { MineTab } from './MineTab';
import { Glyph } from './parts';

const BankTab = lazy(() =>
  import('@/features/wordbank/WordBankPage').then((m) => ({ default: m.WordBankPanel })),
);

export function DecksPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const tab = parseDeckTab(params.get('tab'));
  const labels: Record<DeckTab, string> = {
    mine: t('deckHub.tabMine'),
    bank: t('deckHub.tabBank'),
  };

  return (
    <div className="mx-auto w-full max-w-2xl pb-10">
      <header className="flex items-center justify-between pt-3.5 pr-4 pb-1 pl-5">
        <h1 className="font-serif text-[30px] leading-tight font-semibold text-fg">
          {t('deckHub.title')}
        </h1>
        <button
          type="button"
          onClick={openImportSheet}
          aria-haspopup="dialog"
          aria-label={t('deckHub.import')}
          className="flex size-11 items-center justify-center rounded-full text-fg-muted hover:bg-hover"
        >
          <Glyph name="download" size={22} />
        </button>
      </header>

      <nav
        aria-label={t('deckHub.segments')}
        className="mx-4 mt-2 grid grid-cols-2 gap-1 rounded-[14px] bg-surface-sunken p-1"
      >
        {DECK_TABS.map((key) => (
          <Link
            key={key}
            to={deckTabHref(key)}
            replace
            aria-current={tab === key ? 'page' : undefined}
            className={cn(
              'flex h-10 items-center justify-center rounded-[11px] px-2 text-center text-[0.9375rem] whitespace-nowrap',
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
            <BankTab />
          </Suspense>
        )}
      </div>
    </div>
  );
}
