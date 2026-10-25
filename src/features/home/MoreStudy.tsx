// "Biraz daha çalış" (board HomeDone): once the word study is done, three ways to keep going
// without breaking the plan: extra new cards today, a practice round, tomorrow's cards now.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { addExtraNew, logError, type MoreStudyOverview } from '@/data';
import { extraNewSteps, practiceHref } from '@/features/extra/links';
import { cn, Spinner, toast } from '@/ui';
import { HomeIcon, type HomeIconName } from './homeIcons';
import { WORD_STUDY_HREF } from './TodayHero';

export const AHEAD_HREF = '/study?mode=word&queue=ahead';

function RowIcon({ name, tone }: { name: HomeIconName; tone: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', tone)}
    >
      <HomeIcon name={name} size={20} />
    </span>
  );
}

const rowClass =
  'flex min-h-17 items-center gap-3 rounded-2xl bg-surface p-3.5 text-fg transition-colors duration-(--duration-micro)';

/** The practice round to offer: the hard words first, then the recent ones. */
function practiceSource(more: MoreStudyOverview): 'hard' | 'recent' | null {
  if (more.practice.hard > 0) return 'hard';
  if (more.practice.recent > 0) return 'recent';
  return null;
}

export function MoreStudy({ more }: { more: MoreStudyOverview }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<number | null>(null);
  const steps = extraNewSteps(more.newWaiting);
  const source = practiceSource(more);
  if (steps.length === 0 && !source && more.aheadCount === 0) return null;

  const add = async (n: number) => {
    setBusy(n);
    try {
      await addExtraNew(n);
      await navigate(WORD_STUDY_HREF);
    } catch (e) {
      void logError(e, 'home:addExtraNew');
      toast({ title: t('more.addFailed'), tone: 'danger' });
      setBusy(null);
    }
  };

  return (
    <section
      aria-labelledby="more-study-title"
      className="flex flex-col gap-3 rounded-[20px] bg-accent px-4 pt-4.5 pb-4 text-accent-fg"
      data-testid="more-study"
    >
      <div className="flex flex-col gap-0.5 px-1">
        <h2 id="more-study-title" className="font-serif text-[1.3125rem] font-semibold">
          {t('more.title')}
        </h2>
        <p className="text-sm text-hero-muted">{t('today.moreBody')}</p>
      </div>

      {steps.length > 0 && (
        <div className={rowClass}>
          <RowIcon name="addCards" tone="bg-accent-soft text-accent-text" />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[0.9375rem] font-semibold">{t('today.moreNewTitle')}</span>
            <span className="text-[0.8125rem] text-fg-muted">
              {t('today.moreNewBody', { count: more.newWaiting })}
            </span>
          </span>
          <div className="flex shrink-0 gap-1.5">
            {steps.map((n, i) => {
              const primary = i === steps.length - 1;
              return (
                <button
                  key={n}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void add(n)}
                  aria-label={t('more.newAdd', { count: n })}
                  className={cn(
                    'inline-flex h-11 min-w-13 items-center justify-center rounded-xl px-2 text-[0.9375rem] font-semibold',
                    'transition-colors duration-(--duration-micro) disabled:opacity-60',
                    primary
                      ? 'bg-accent text-accent-fg hover:bg-accent-hover'
                      : 'border border-border bg-surface text-accent-text hover:bg-hover',
                  )}
                >
                  {busy === n ? <Spinner size={16} /> : `+${n}`}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {source && (
        <Link
          to={practiceHref({ source, size: 10, tag: null })}
          className={cn(rowClass, 'hover:bg-surface-hover')}
        >
          <RowIcon name="loop" tone="bg-success-soft text-success-text" />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[0.9375rem] font-semibold">{t('more.practiceTitle')}</span>
            <span className="text-[0.8125rem] text-fg-muted">{t('today.morePracticeBody')}</span>
          </span>
          <HomeIcon name="chevron" size={18} strokeWidth={1.8} className="text-fg-subtle" />
        </Link>
      )}

      {more.aheadCount > 0 && (
        <Link to={AHEAD_HREF} className={cn(rowClass, 'hover:bg-surface-hover')}>
          <RowIcon name="ahead" tone="bg-warn-soft text-warn-text" />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[0.9375rem] font-semibold">{t('today.moreAheadTitle')}</span>
            <span className="text-[0.8125rem] text-fg-muted">
              {t('today.moreAheadBody', { count: more.aheadCount })}
            </span>
          </span>
          <HomeIcon name="chevron" size={18} strokeWidth={1.8} className="text-fg-subtle" />
        </Link>
      )}
    </section>
  );
}
