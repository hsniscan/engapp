// /kesfet, "Keşfet" (v0.5.1, ADR 0057): a page that flows on its own. On "Hepsi" a feed of
// what there is to find today (the text left unfinished first, then a daily mix of texts,
// decks and words, then the shelves); the chips narrow it to Okuma (the feed's reading cards,
// then Metinlerim and the whole graded library), Desteler (every suggested deck) or Kelimeler
// (word of the day, false friend of the day, new words at the user's level). The filter is in
// the URL (?f=okuma|desteler|kelimeler) so each can be linked; old /kitaplik and
// /decks?tab=discover|reading redirect here.
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { arrangeFeed, FEED_FILTERS, type FeedFilter, parseFeedFilter } from '@/domain/discoverFeed';
import { BankMissing, DeckCatalog } from '@/features/decks/DeckCatalog';
import { cn, Skeleton } from '@/ui';
import { FeedCard, MissingNote } from './FeedCards';
import { filterHref } from './links';
import { useDiscoverFeed } from './useDiscoverFeed';

const ReadingTab = lazy(() =>
  import('@/features/reader/ReadingTab').then((m) => ({ default: m.ReadingTab })),
);

export function DiscoverPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const filter = parseFeedFilter(params.get('f'));
  const data = useDiscoverFeed(filter);
  const level = data.bank?.level ?? 'B1';
  const feed = data.items ? arrangeFeed(data.items, { filter, day: data.day, dropCovered: true }) : undefined;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-3.5 pb-10 md:pt-8">
      <header className="flex flex-col gap-1 px-1 pb-3">
        <h1 className="font-serif text-[30px] leading-tight font-semibold text-fg">{t('discover.title')}</h1>
        <p className="text-[0.9375rem] text-fg-muted">{t('discover.lead')}</p>
      </header>

      <nav aria-label={t('discover.filters')} className="-mx-4 mb-5">
        <ul className="flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {FEED_FILTERS.map((f) => (
            <li key={f}>
              <FilterLink filter={f} current={filter === f} />
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex flex-col gap-4">
        {feed === undefined ? (
          <FeedSkeleton />
        ) : (
          feed.map((item) => <FeedCard key={item.key} item={item} level={level} idx={data.bank?.idx} />)
        )}

        {filter === 'okuma' && (
          <Suspense fallback={<Skeleton lines={6} />}>
            <div className={cn(feed && feed.length > 0 && 'pt-4')}>
              <ReadingTab />
            </div>
          </Suspense>
        )}

        {filter === 'desteler' && (
          <DeckCatalog data={data.bank} ffNotes={data.falseFriends} download={data.download} onRetry={data.retry} />
        )}

        {filter === 'kelimeler' && feed && feed.length === 0 && data.bank && (
          <BankMissing download={data.download} onRetry={data.retry} />
        )}

        {filter === 'hepsi' && feed && data.missing && <MissingNote onRetry={data.retry} />}

        {filter === 'hepsi' && feed && feed.length === 0 && !data.missing && (
          <p className="rounded-[18px] border border-border bg-surface px-4 py-4 text-[0.9375rem] text-fg-muted">
            {t('discover.empty')}
          </p>
        )}
      </div>
    </div>
  );
}

function FilterLink({ filter, current }: { filter: FeedFilter; current: boolean }) {
  const { t } = useTranslation();
  return (
    <Link
      to={filterHref(filter)}
      replace
      aria-current={current ? 'page' : undefined}
      className={cn(
        'inline-flex h-11 shrink-0 items-center rounded-full border px-3.5 text-sm whitespace-nowrap transition-colors',
        current
          ? 'border-fg bg-fg font-semibold text-fg-inverse'
          : 'border-border bg-surface text-fg hover:border-border-strong',
      )}
    >
      {t(`discover.filter.${filter}`)}
    </Link>
  );
}

function FeedSkeleton() {
  const { t } = useTranslation();
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <span className="sr-only">{t('discover.loading')}</span>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-36 w-full rounded-[20px]" />
      ))}
    </div>
  );
}
