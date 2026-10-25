// The top of Bugün: today's word study (board Main: the filled card with the ring and
// "Devam et"; board HomeDone: "Bugünlük tamam" and when the next cards come).
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { StreakSummary } from '@/domain/streak';
import { formatDayLong } from '@/features/stats/format';
import type { StudyModeCount } from '@/features/review/studyModes';
import { cn } from '@/ui';
import { HomeIcon } from './homeIcons';
import { nextDueText } from './nextDueText';
import type { NextDue } from './queries';
import { Ring } from './Ring';
import type { TodayActivity, WeekDot } from './todayQueries';

export const WORD_STUDY_HREF = '/study?mode=word';

export interface HeroData {
  word: StudyModeCount;
  activity: TodayActivity;
  streak: StreakSummary;
  next: NextDue | null;
  now: number;
  timezone: string;
}

export function TodayHero({ data }: { data: HeroData }) {
  const remaining = data.word.due + data.word.newCount;
  return remaining > 0 ? <PendingHero data={data} /> : <DoneHero data={data} />;
}

function WeekDots({ week, tone }: { week: WeekDot[]; tone: 'hero' | 'surface' }) {
  const { t } = useTranslation();
  const active = week.filter((d) => d.active).length;
  return (
    <ol aria-label={t('today.weekDots', { count: active })} className="flex shrink-0 gap-[5px]">
      {week.map((d) => (
        <li
          key={d.date}
          aria-label={`${formatDayLong(d.date)}: ${d.active ? t('today.dayActive') : t('today.dayIdle')}`}
          className={cn(
            'size-[9px] rounded-full border-[1.5px]',
            tone === 'hero' ? 'border-hero-ring' : 'border-accent',
            d.active && (tone === 'hero' ? 'bg-hero-ring' : 'bg-accent'),
            d.future && 'opacity-45',
          )}
        />
      ))}
    </ol>
  );
}

function StreakLine({ streak, done }: { streak: StreakSummary; done: boolean }) {
  const { t } = useTranslation();
  if (streak.currentStreak === 0) return <span className="text-sm">{t('today.streakStart')}</span>;
  return (
    <span className="text-sm">
      <strong className="font-semibold">
        {t('today.streakDays', { count: streak.currentStreak })}
      </strong>{' '}
      <span className="whitespace-nowrap">
        {done
          ? t('today.streakGoesOn')
          : t('today.streakLongest', {
              count: Math.max(streak.longestStreak, streak.currentStreak),
            })}
      </span>
    </span>
  );
}

function PendingHero({ data }: { data: HeroData }) {
  const { t } = useTranslation();
  const { word, activity } = data;
  const remaining = word.due + word.newCount;
  const done = activity.answers.word;
  const planned = done + remaining;
  return (
    <section
      aria-labelledby="today-hero-title"
      className="flex flex-col gap-4.5 rounded-[20px] bg-accent px-5 pt-5.5 pb-4.5 text-accent-fg"
      data-testid="today-hero"
    >
      <div className="flex items-center gap-4.5">
        <div
          className="relative flex size-23 shrink-0 flex-col items-center justify-center"
          role="img"
          aria-label={t('today.ringLabel', { done, total: planned })}
        >
          <Ring
            ratio={planned ? done / planned : 0}
            size={92}
            stroke={7}
            trackClass="stroke-accent-fg/22"
            fillClass="stroke-hero-ring"
            className="absolute inset-0"
          />
          <span
            aria-hidden="true"
            className="tabular font-serif text-[1.625rem] leading-none font-semibold"
          >
            {done}
          </span>
          <span aria-hidden="true" className="tabular text-xs text-hero-muted">
            / {planned}
          </span>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[0.8125rem] tracking-[0.04em] text-hero-muted uppercase">
            {t('today.heroCaption')}
          </span>
          <h2 id="today-hero-title" className="font-serif text-2xl leading-tight font-normal">
            {t('today.cardsLeft', { count: remaining })}
          </h2>
          <span className="text-sm text-hero-muted">
            {t('today.split', { due: word.due, fresh: word.newCount })}
            {word.estMinutes > 0 && ` · ${t('today.aboutMinutes', { count: word.estMinutes })}`}
          </span>
        </div>
      </div>
      <Link
        to={WORD_STUDY_HREF}
        className="flex h-13 items-center justify-center gap-2 rounded-[14px] bg-hero-action text-[1.0625rem] font-semibold text-hero-action-fg transition-opacity duration-(--duration-micro) hover:opacity-92 focus-visible:outline-hero-action"
      >
        {done > 0 ? t('today.continue') : t('today.start')}
        <HomeIcon name="arrow" size={20} strokeWidth={1.8} />
      </Link>
      <div className="flex items-center justify-between gap-3 pt-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <HomeIcon name="flame" size={18} strokeWidth={1.8} className="text-streak-flame" />
          <StreakLine streak={data.streak} done={false} />
        </div>
        <WeekDots week={activity.week} tone="hero" />
      </div>
    </section>
  );
}

function DoneHero({ data }: { data: HeroData }) {
  const { t } = useTranslation();
  const { activity } = data;
  const done = activity.answers.word;
  const studied = done > 0;
  return (
    <section
      aria-labelledby="today-hero-title"
      className="flex flex-col gap-4 rounded-[20px] border border-border bg-surface px-5 pt-5.5 pb-4.5"
      data-testid="today-hero-done"
    >
      <div className="flex items-center gap-4.5">
        <div
          aria-hidden="true"
          className="flex size-23 shrink-0 flex-col items-center justify-center rounded-full border-7 border-accent"
        >
          <HomeIcon name="check" size={22} strokeWidth={2} className="text-accent-text" />
          {studied && (
            <span className="tabular mt-0.5 text-xs text-fg-muted">
              {done} / {done}
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[0.8125rem] font-semibold tracking-[0.04em] text-success-text uppercase">
            {t('today.heroCaption')}
          </span>
          <h2
            id="today-hero-title"
            className="font-serif text-[1.625rem] leading-tight font-semibold"
          >
            {studied ? t('today.doneTitle') : t('today.nothingTitle')}
          </h2>
          <span className="text-sm text-fg-muted">
            {studied
              ? t('today.doneSplit', {
                  reviewed: activity.word.reviewed,
                  fresh: activity.word.fresh,
                })
              : t('today.nothingBody')}
          </span>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 rounded-[14px] bg-surface-sunken px-3.5 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <HomeIcon name="flame" size={18} strokeWidth={1.8} className="text-warn-text" />
          <StreakLine streak={data.streak} done={data.streak.todayActive} />
        </div>
        <WeekDots week={activity.week} tone="surface" />
      </div>
      {data.next && (
        <p className="flex items-center gap-2 text-sm text-fg-muted" role="status">
          <HomeIcon name="calendar" size={18} className="text-fg-subtle" />
          <span>{nextDueText(t, data.next, data.now, data.timezone)}</span>
        </p>
      )}
    </section>
  );
}
