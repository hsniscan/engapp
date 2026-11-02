// "Kelimelerim" (v0.5.1, ADR 0057; was Desteler): only what is the user's own. Two views,
// kept in the URL as /decks?tab=mine|bank so each can be linked and the back button leaves the
// screen instead of stepping through views: Destelerim (every word, decks, tags, themes) and
// Kelime Bankası (the leveled word list to pick words from). Suggested decks and reading live
// in the Keşfet tab (/decks?tab=discover|reading redirect there, src/app/redirects.ts).
// v0.5.2 "Çam" (docs/design.md §4.5): PageFrame + SegmentedControl, everything from src/ui.
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { IconButton, PageFrame, SegmentedControl, Skeleton } from '@/ui';
import { DECK_TABS, type DeckTab, deckTabHref, parseDeckTab } from './deckUi';
import { MineTab } from './MineTab';

const BankTab = lazy(() =>
  import('@/features/wordbank/WordBankPage').then((m) => ({ default: m.WordBankPanel })),
);

export function DecksPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const tab = parseDeckTab(params.get('tab'));
  const labels: Record<DeckTab, string> = {
    mine: t('deckHub.tabMine'),
    bank: t('deckHub.tabBank'),
  };

  return (
    <PageFrame
      title={t('deckHub.title')}
      actions={
        <IconButton
          icon="search"
          label={t('deckHub.mine.search')}
          onClick={() => void navigate('/library?find=1')}
        />
      }
    >
      <div className="flex flex-col gap-6">
        <SegmentedControl<DeckTab>
          legend={t('deckHub.segments')}
          hideLegend
          value={tab}
          onValueChange={(v) => void navigate(deckTabHref(v), { replace: true })}
          options={DECK_TABS.map((k) => ({ value: k, label: labels[k] }))}
          className="md:max-w-md"
        />
        {tab === 'mine' ? (
          <MineTab />
        ) : (
          <Suspense
            fallback={
              <div aria-busy="true">
                <Skeleton lines={6} />
              </div>
            }
          >
            <BankTab />
          </Suspense>
        )}
      </div>
    </PageFrame>
  );
}
