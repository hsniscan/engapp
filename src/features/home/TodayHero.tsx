// The top of Bugün (v0.5.1, ADR 0055): the whole day in one card. A chip per study mode
// ("Kelime ✓ · Üretim 29 · Boşluk 28"), one remaining count and time estimate over all of them
// (the same numbers as the Çalış picker), and one button to the next mode that still has cards
// ("Üretime geç (29)"). When every mode is done: "Bugünlük tamam" and when the next cards come.
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { getStreakFreezeView } from '@/data';
import type { StreakSummary } from '@/domain/streak';
import type { StudyMode } from '@/domain/studyMode';
import { formatDayLong } from '@/features/stats/format';
import { modeLeft, type TodayStudy } from '@/features/review/studyModes';
import { cn, Dialog } from '@/ui';
import { HomeIcon } from './homeIcons';
import { nextDueText } from './nextDueText';
import type { NextDue } from './queries';
import { Ring } from './Ring';
import type { TodayActivity, WeekDot } from './todayQueries';

export const WORD_STUDY_HREF = '/study?mode=word';

const studyHref = (mode: StudyMode) => `/study?mode=${mode}`;

export interface HeroData {
  study: TodayStudy;
  activity: TodayActivity;
  streak: StreakSummary;
  next: NextDue | null;
  now: number;
  timezone: string;
}

export function TodayHero({ data }: { data: HeroData }) {
  return data.study.left > 0 ? <PendingHero data={data} /> : <DoneHero data={data} />;
}

/** Answers given today over the modes shown. */
function answeredToday(data: HeroData): number {
  return data.study.modes.reduce((n, m) => n + data.activity.answers[m], 0);
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

function StreakText({ streak, done }: { streak: StreakSummary; done: boolean }) {
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

/** The streak line opens a short sheet: what counts, and this month's protections. */
function StreakRow({
  streak,
  done,
  tone,
}: {
  streak: StreakSummary;
  done: boolean;
  tone: 'hero' | 'surface';
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-testid="today-streak"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={cn(
          '-mx-1.5 flex min-h-11 min-w-0 items-center gap-2 rounded-xl px-1.5 text-left',
          tone === 'hero' ? 'hover:bg-accent-fg/10' : 'hover:bg-hover',
        )}
      >
        <HomeIcon
          name="flame"
          size={18}
          strokeWidth={1.8}
          className={tone === 'hero' ? 'text-streak-flame' : 'text-warn-text'}
        />
        <StreakText streak={streak} done={done} />
        <span className="sr-only">{t('today.streakMore')}</span>
      </button>
      <StreakSheet open={open} onOpenChange={setOpen} streak={streak} />
    </>
  );
}

function StreakSheet({
  open,
  onOpenChange,
  streak,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  streak: StreakSummary;
}) {
  const { t } = useTranslation();
  const view = useLiveQuery(() => (open ? getStreakFreezeView() : undefined), [open]);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('today.streakSheet.title')}
      description={t('today.streakDays', { count: streak.currentStreak })}
    >
      <div className="flex flex-col gap-3 pb-1 text-[0.9375rem]" data-testid="streak-sheet">
        <p>{t('today.streakSheet.rule')}</p>
        <p className="text-fg-muted">
          {t('today.streakSheet.longest', {
            count: Math.max(streak.longestStreak, streak.currentStreak),
          })}
        </p>
        {view && (
          <div className="rounded-[14px] bg-surface-sunken px-3.5 py-3">
            <p className="font-semibold">{t('today.streakSheet.protectTitle')}</p>
            <p className="mt-0.5 text-fg-muted" data-testid="streak-protection">
              {t('today.streakSheet.protectLeft', { left: view.left, perMonth: view.perMonth })}
            </p>
            <p className="mt-1 text-sm text-fg-subtle">
              {t('today.streakSheet.protectRule', { perMonth: view.perMonth })}
            </p>
          </div>
        )}
        <p className="text-sm text-fg-muted">{t('today.streakSheet.practice')}</p>
      </div>
    </Dialog>
  );
}

/** "Kelime ✓ · Üretim 29 · Boşluk 28": one link per mode, the finished ones ticked. */
function ModeChips({ data, tone }: { data: HeroData; tone: 'hero' | 'surface' }) {
  const { t } = useTranslation();
  const { study, activity } = data;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={t('today.typesTitle')}>
      {study.modes.map((m) => {
        const n = modeLeft(study.counts[m]);
        const done = n === 0;
        const studied = activity.answers[m] > 0;
        return (
          <li key={m} className="flex">
            <Link
              to={studyHref(m)}
              data-testid={`study-type-${m}`}
              data-done={done || undefined}
              className={cn(
                'inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors duration-(--duration-micro)',
                tone === 'hero'
                  ? done
                    ? 'bg-[rgb(0_0_0/0.1)] text-hero-muted hover:bg-[rgb(0_0_0/0.16)]'
                    : 'bg-[rgb(0_0_0/0.2)] text-accent-fg hover:bg-[rgb(0_0_0/0.28)]'
                  : done
                    ? 'bg-surface-sunken text-fg-muted hover:bg-hover'
                    : 'bg-accent-soft text-accent-text hover:bg-hover',
              )}
            >
              {/* The name is "Kelime 2 kart" / "Üretim Bugün yok"; the eye sees "Kelime 2". */}
              <span>{t(`today.mode.${m}`)}</span>
              <span className="sr-only">
                {' '}
                {done
                  ? studied
                    ? t('today.typeDone')
                    : t('today.typeNone')
                  : t('today.chipCount', { count: n })}
              </span>
              {done ? (
                studied ? (
                  <HomeIcon name="check" size={15} strokeWidth={2.2} />
                ) : (
                  <span aria-hidden="true">–</span>
                )
              ) : (
                <span aria-hidden="true" className="tabular font-semibold">
                  {n}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function PendingHero({ data }: { data: HeroData }) {
  const { t } = useTranslation();
  const { study, activity } = data;
  const done = answeredToday(data);
  const planned = done + study.left;
  const due = study.modes.reduce((n, m) => n + study.counts[m].due, 0);
  const fresh = study.modes.reduce((n, m) => n + study.counts[m].newCount, 0);
  const next = study.next ?? 'word';
  const nextLeft = modeLeft(study.counts[next]);
  // The first mode keeps "Başla" / "Devam et"; after it, the button names the next one.
  const cta =
    next === study.modes[0]
      ? done > 0
        ? t('today.continue')
        : t('today.start')
      : t(`today.goTo.${next}`, { count: nextLeft });
  return (
    <section
      aria-labelledby="today-hero-title"
      className="flex flex-col gap-4 rounded-[20px] bg-accent px-5 pt-5.5 pb-4.5 text-accent-fg"
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
            {t('today.cardsLeft', { count: study.left })}
          </h2>
          <span data-testid="today-split" className="text-sm text-hero-muted">
            {t('today.split', { due, fresh })}
            {study.minutes > 0 && ` · ${t('today.aboutMinutes', { count: study.minutes })}`}
          </span>
        </div>
      </div>
      <ModeChips data={data} tone="hero" />
      <Link
        to={studyHref(next)}
        data-testid="start-study"
        className="flex h-13 items-center justify-center gap-2 rounded-[14px] bg-hero-action text-[1.0625rem] font-semibold text-hero-action-fg transition-opacity duration-(--duration-micro) hover:opacity-92 focus-visible:outline-hero-action"
      >
        {cta}
        <HomeIcon name="arrow" size={20} strokeWidth={1.8} />
      </Link>
      <div className="flex items-center justify-between gap-3">
        <StreakRow streak={data.streak} done={false} tone="hero" />
        <WeekDots week={activity.week} tone="hero" />
      </div>
    </section>
  );
}

function DoneHero({ data }: { data: HeroData }) {
  const { t } = useTranslation();
  const { activity } = data;
  const done = answeredToday(data);
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
      {studied && <ModeChips data={data} tone="surface" />}
      <div className="flex items-center justify-between gap-3 rounded-[14px] bg-surface-sunken px-3.5 py-2">
        <StreakRow streak={data.streak} done={data.streak.todayActive} tone="surface" />
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
