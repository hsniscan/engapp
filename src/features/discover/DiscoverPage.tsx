// /kesfet, "Keşfet" (v0.5.1, ADR 0057; Çam look v0.5.2, docs/design.md §4.12): a page that
// flows on its own. On "Hepsi" a feed of what there is to find today (the text left unfinished
// first, then a daily mix of texts, decks and words, then the shelves); the chips narrow it to
// Okuma (the feed's reading cards, then Metinlerim and the whole graded library), Desteler
// (every suggested deck) or Kelimeler (word of the day, false friend of the day, new words at
// the user's level). The filter is in the URL (?f=okuma|desteler|kelimeler) so each can be
// linked; old /kitaplik and /decks?tab=discover|reading redirect here.
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { arrangeFeed, FEED_FILTERS, parseFeedFilter } from '@/domain/discoverFeed';
import { BankMissing, DeckCatalog } from '@/features/decks/DeckCatalog';
import { Chip, ChipRow, cn, EmptyState, PageFrame, Skeleton } from '@/ui';
import { FeedCard, MissingNote } from './FeedCards';
import { filterHref } from './links';
import { useDiscoverFeed } from './useDiscoverFeed';

const ReadingTab = lazy(() =>
  import('@/features/reader/ReadingTab').then((m) => ({ default: m.ReadingTab })),
);

export function DiscoverPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const filter = parseFeedFilter(params.get('f'));
  const data = useDiscoverFeed(filter);
  const level = data.bank?.level ?? 'B1';
  const feed = data.items
    ? arrangeFeed(data.items, { filter, day: data.day, dropCovered: true })
    : undefined;
  const continued = feed?.find((x) => x.kind === 'continue');
  const continueId = continued?.kind === 'continue' ? continued.text.id : null;

  return (
    <PageFrame title={t('discover.title')} description={t('discover.lead')}>
      <ChipRow label={t('discover.filters')} className="mb-6">
        {FEED_FILTERS.map((f) => (
          <Chip
            key={f}
            selected={filter === f}
            onClick={() => void navigate(filterHref(f), { replace: true })}
          >
            {t(`discover.filter.${f}`)}
          </Chip>
        ))}
      </ChipRow>

      <div className="flex flex-col gap-8">
        {feed === undefined ? (
          <FeedSkeleton />
        ) : (
          feed.length > 0 && (
            <div className="grid items-start gap-4 lg:grid-cols-2">
              {feed.map((item) => (
                <FeedCard key={item.key} item={item} level={level} continueId={continueId} />
              ))}
            </div>
          )
        )}

        {filter === 'okuma' && (
          <Suspense fallback={<Skeleton lines={6} />}>
            <div className={cn(feed && feed.length > 0 && 'pt-2')}>
              <ReadingTab />
            </div>
          </Suspense>
        )}

        {filter === 'desteler' && (
          <DeckCatalog
            data={data.bank}
            ffNotes={data.falseFriends}
            download={data.download}
            onRetry={data.retry}
          />
        )}

        {filter === 'kelimeler' && feed && feed.length === 0 && data.bank && (
          <BankMissing download={data.download} onRetry={data.retry} />
        )}

        {filter === 'hepsi' && feed && data.missing && <MissingNote onRetry={data.retry} />}

        {filter === 'hepsi' && feed && feed.length === 0 && !data.missing && (
          <EmptyState tone="card" icon="compass" title={t('discover.emptyTitle')} description={t('discover.empty')} />
        )}
      </div>
    </PageFrame>
  );
}

/** Three cards shaped like the text card (eyebrow, title, two lines, a button). */
function FeedSkeleton() {
  const { t } = useTranslation();
  return (
    <div aria-busy="true" className="grid items-start gap-4 lg:grid-cols-2">
      <span className="sr-only">{t('discover.loading')}</span>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 sm:p-5">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-6 w-3/4" />
          <Skeleton lines={2} />
          <Skeleton className="h-11 w-full rounded-control" />
        </div>
      ))}
    </div>
  );
}
