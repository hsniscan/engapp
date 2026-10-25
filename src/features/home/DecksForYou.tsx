// "Senin için desteler" (board Main): ready-made decks that suit the user, scrolled sideways.
// Phrasal verbs and topic decks have no data yet: they show as "Yakında", without numbers.
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { formatNumber } from '@/features/stats/format';
import { cn } from '@/ui';
import { HOME_FREQ_SIZE, type HomeDeck } from './todayQueries';

const cardClass =
  'flex w-50 shrink-0 snap-start flex-col gap-2.5 rounded-[18px] border border-border bg-surface p-4 text-fg';

export function DecksForYou({ decks }: { decks: HomeDeck[] }) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="decks-for-you-title" className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between px-1 pt-1">
        <h2 id="decks-for-you-title" className="font-serif text-[1.1875rem] font-semibold">
          {t('today.decksTitle')}
        </h2>
        <Link to="/decks?tab=discover" className="text-sm text-accent-text hover:underline">
          {t('today.decksDiscover')}
        </Link>
      </div>
      <ul className="-mr-4 flex snap-x gap-3 overflow-x-auto pr-4 pb-1 [scrollbar-width:none] md:mr-0 md:pr-0">
        {decks.map((d) => {
          const title =
            d.kind === 'freq'
              ? t('today.deckFreq', { count: HOME_FREQ_SIZE })
              : t('today.deckLevelVerbs', { level: d.level });
          const pct = d.have !== null && d.size ? d.have / d.size : null;
          return (
            <li key={d.key} className="flex">
              <Link
                to={`/decks/suggested/${d.key}`}
                className={cn(
                  cardClass,
                  'transition-colors duration-(--duration-micro) hover:border-border-strong',
                )}
                data-testid={`home-deck-${d.key}`}
              >
                <span
                  className={cn(
                    'self-start rounded-md px-2 py-0.5 text-xs font-semibold',
                    d.kind === 'freq'
                      ? 'bg-accent-soft text-accent-text'
                      : 'bg-success-soft text-success-text',
                  )}
                >
                  {d.kind === 'freq' ? t('today.deckBadgeFreq') : t('today.deckBadgeLevel')}
                </span>
                <span className="font-serif text-[1.1875rem] leading-tight font-semibold">
                  {title}
                </span>
                {pct !== null && (
                  <span
                    aria-hidden="true"
                    className="h-1.5 overflow-hidden rounded-[3px] bg-surface-sunken"
                  >
                    <span
                      className="block h-full bg-accent"
                      style={{ width: `${Math.round(pct * 100)}%` }}
                    />
                  </span>
                )}
                <span className="mt-auto text-[0.8125rem] text-fg-muted">
                  {d.have !== null && d.size !== null
                    ? t('today.deckHave', {
                        have: formatNumber(d.have),
                        size: formatNumber(d.size),
                      })
                    : t('today.deckReady')}
                </span>
              </Link>
            </li>
          );
        })}
        <li className="flex">
          <div
            className={cn(cardClass, 'border-dashed bg-transparent')}
            data-testid="home-deck-soon"
          >
            <span className="self-start rounded-md bg-surface-sunken px-2 py-0.5 text-xs font-semibold text-fg-muted">
              {t('today.deckSoon')}
            </span>
            <span className="font-serif text-[1.1875rem] leading-tight font-semibold">
              {t('today.deckPhrasal')}
            </span>
            <span className="mt-auto text-[0.8125rem] text-fg-muted">
              {t('today.deckSoonBody')}
            </span>
          </div>
        </li>
      </ul>
    </section>
  );
}
