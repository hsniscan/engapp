import { useLiveQuery } from 'dexie-react-hooks';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { HeatmapCell } from '@/domain/streak';
import {
  formatDayLong,
  formatDuration,
  formatNumber,
  formatPercent,
  formatWeekdayShort,
} from '@/features/stats/format';
import { LevelChangeLine, LevelTestOffer } from '@/features/leveltest/LevelHomeNotes';
import { VocabTile } from '@/features/leveltest/VocabTile';
import { LoadNotes } from '@/features/load/LoadNotes';
import { heatLabel } from '@/features/stats/heatLabel';
import { buttonClasses, cn, Icon, Page, Skeleton, Surface } from '@/ui';
import { InterestsPrompt } from '@/features/profile/InterestsPrompt';
import { FsrsOptOffer } from '@/features/fsrs/FsrsOptOffer';
import { ReportHomeNote } from '@/features/report/ReportHomeNote';
import { nextDueText } from './nextDueText';
import { getHomeDashboard, type ForecastDay, type HomeDashboard } from './queries';

export function HomeScreen() {
  const { t } = useTranslation();
  const data = useLiveQuery(() => getHomeDashboard(), []);
  const description = data ? formatDayLong(data.summary.streak.today) : ' ';

  if (data && !data.hasCards) return <HomeEmpty />;

  return (
    <Page title={t('home.title')} description={description} width="wide">
      {data ? <Dashboard data={data} /> : <DashboardSkeleton />}
    </Page>
  );
}

/** Phone: one column in priority order. ≥1024 px: today + activity on the left, figures on the right. */
function Dashboard({ data }: { data: HomeDashboard }) {
  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start lg:gap-5">
      <div className="contents lg:col-span-2 lg:flex lg:flex-col lg:gap-5 empty:hidden">
        <LevelChangeLine className="order-0 lg:order-none" />
        <LevelTestOffer className="order-0 lg:order-none" />
        <LoadNotes className="order-0 lg:order-none" />
        <FsrsOptOffer className="order-0 lg:order-none" />
        <ReportHomeNote className="order-0 lg:order-none" />
      </div>
      <div className="contents lg:flex lg:flex-col lg:gap-5">
        <TodayCard data={data} className="order-2 lg:order-none" />
        <InterestsPrompt className="order-2 lg:order-none" />
        <ActivityStrip cells={data.strip} className="order-4 lg:order-none" />
        <RecentWords data={data} className="order-7 lg:order-none" />
      </div>
      <div className="contents lg:flex lg:flex-col lg:gap-5">
        <StreakHero data={data} className="order-1 lg:order-none" />
        <VocabTile className="order-3 lg:order-none" />
        <Forecast days={data.forecast} className="order-5 lg:order-none" />
        <MiniMetrics data={data} className="order-6 lg:order-none" />
      </div>
    </div>
  );
}

function SectionTitle({
  children,
  id,
  action,
}: {
  children: ReactNode;
  id?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-3">
      <h2 id={id} className="font-serif text-lg font-semibold text-fg">
        {children}
      </h2>
      {action}
    </div>
  );
}

function StreakHero({ data, className }: { data: HomeDashboard; className?: string }) {
  const { t } = useTranslation();
  const s = data.summary.streak;
  const caption = s.todayActive
    ? t('home.streakTodayDone')
    : s.currentStreak > 0
      ? t('home.streakTodayPending')
      : t('home.streakStart');
  return (
    <Surface
      as="section"
      aria-labelledby="streak-title"
      padding="none"
      className={cn('p-5 sm:p-6', className)}
    >
      <h2 id="streak-title" className="sr-only">
        {t('home.streakTitle')}
      </h2>
      <div className="flex items-end gap-4">
        <div className="flex items-baseline gap-2">
          <span className="tabular font-serif text-6xl leading-[0.9] font-semibold tracking-[-0.02em] text-fg">
            {s.currentStreak}
          </span>
          <span className="font-serif text-xl text-fg">
            {t('home.streakUnit', { count: s.currentStreak })}
          </span>
        </div>
        <span
          className={cn(
            'mb-1 ml-auto inline-flex size-9 items-center justify-center rounded-full',
            s.todayActive
              ? 'bg-success-soft text-success-text'
              : 'border border-border text-fg-subtle',
          )}
          aria-hidden="true"
        >
          <Icon name="check" size={18} strokeWidth={s.todayActive ? 2 : 1.6} />
        </span>
      </div>
      <p className="mt-2 text-sm text-fg-muted">
        <span className="font-medium text-fg">{t('home.streakTitle')}</span> · {caption}
      </p>
      <dl className="mt-5 grid grid-cols-2 border-t border-border pt-4">
        <div className="flex flex-col gap-0.5">
          <dt className="text-sm text-fg-muted">{t('home.longest')}</dt>
          <dd className="tabular font-serif text-2xl font-semibold">
            {s.longestStreak}{' '}
            <span className="text-base font-normal text-fg-muted">
              {t('home.days', { count: s.longestStreak })}
            </span>
          </dd>
        </div>
        <div className="flex flex-col gap-0.5 border-l border-border pl-4">
          <dt className="text-sm text-fg-muted">{t('home.totalActive')}</dt>
          <dd className="tabular font-serif text-2xl font-semibold">
            {formatNumber(s.totalActiveDays)}{' '}
            <span className="text-base font-normal text-fg-muted">
              {t('home.days', { count: s.totalActiveDays })}
            </span>
          </dd>
        </div>
      </dl>
    </Surface>
  );
}

function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const pct = total > 0 ? Math.min(1, done / total) : 1;
  return (
    <svg
      viewBox="0 0 100 100"
      className="size-26 shrink-0 -rotate-90 sm:size-28"
      aria-hidden="true"
    >
      <circle cx="50" cy="50" r={r} fill="none" strokeWidth="8" className="stroke-surface-sunken" />
      <circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        className={cn(
          'transition-[stroke-dashoffset] duration-(--duration-large) ease-standard motion-reduce:transition-none',
          pct >= 1 ? 'stroke-success' : 'stroke-accent',
          pct === 0 && 'opacity-0',
        )}
      />
    </svg>
  );
}

function TodayCard({ data, className }: { data: HomeDashboard; className?: string }) {
  const { t } = useTranslation();
  const { summary } = data;
  const remaining = summary.queue.total;
  const due = summary.queue.review + summary.queue.learning;
  const finished = remaining === 0;
  const pct = summary.plannedToday
    ? Math.round((summary.doneToday / summary.plannedToday) * 100)
    : 100;

  return (
    <Surface
      as="section"
      aria-labelledby="today-title"
      padding="none"
      className={cn('p-5 sm:p-6', className)}
    >
      <h2 id="today-title" className="sr-only">
        {t('home.todayTitle')}
      </h2>
      <div className="flex items-center gap-4 sm:gap-6">
        <div
          className="relative"
          role="img"
          aria-label={t('home.progressValue', {
            done: summary.doneToday,
            total: summary.plannedToday,
          })}
        >
          <ProgressRing done={summary.doneToday} total={summary.plannedToday} />
          <div
            className="absolute inset-0 flex flex-col items-center justify-center"
            aria-hidden="true"
          >
            {finished ? (
              <Icon name="check" size={28} strokeWidth={2} className="text-success-text" />
            ) : (
              <>
                <span className="tabular font-serif text-2xl leading-none font-semibold">
                  {formatPercent(pct / 100)}
                </span>
                <span className="tabular mt-1 text-xs text-fg-muted">
                  {summary.doneToday}/{summary.plannedToday}
                </span>
              </>
            )}
          </div>
        </div>

        {finished ? (
          <div className="flex min-w-0 flex-col gap-1">
            <p className="font-serif text-xl font-semibold text-fg sm:text-2xl">
              {t('home.doneTitle')}
            </p>
            <p className="text-[0.9375rem] text-fg-muted">
              {summary.doneToday > 0
                ? t('home.doneBody', { count: summary.doneToday })
                : t('home.doneNothing')}
            </p>
          </div>
        ) : (
          <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-3">
            <div className="flex flex-col">
              <dt className="text-sm whitespace-nowrap text-fg-muted">{t('home.due')}</dt>
              <dd className="tabular font-serif text-4xl leading-tight font-semibold">{due}</dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-sm whitespace-nowrap text-fg-muted">{t('home.new')}</dt>
              <dd className="tabular font-serif text-4xl leading-tight font-semibold">
                {summary.queue.new}
              </dd>
            </div>
            <div className="col-span-2 text-sm text-fg-muted">
              <dt className="sr-only">{t('home.estimate')}</dt>
              <dd>
                {t('home.estimateValue', {
                  time: formatDuration(Math.max(60_000, remaining * data.msPerCard)),
                })}
              </dd>
            </div>
          </dl>
        )}
      </div>

      <div className="mt-6 flex flex-col gap-2">
        {finished ? (
          <>
            <Link to="/more" className={buttonClasses({ size: 'lg', fullWidth: true })}>
              {t('home.moreStudy')}
              <Icon name="chevron-right" size={20} />
            </Link>
            <p className="text-center text-sm text-fg-muted" role="status">
              {nextDueText(t, data.next, data.now, data.timezone)}
            </p>
          </>
        ) : (
          <Link to="/review" className={buttonClasses({ size: 'lg', fullWidth: true })}>
            {t('home.startReview')}
            <Icon name="chevron-right" size={20} />
          </Link>
        )}
        <Link to="/add" className={buttonClasses({ variant: 'ghost', fullWidth: true })}>
          <Icon name="plus" size={18} />
          {t('home.addCard')}
        </Link>
      </div>
    </Surface>
  );
}

const heatBg = ['bg-heat-empty', 'bg-heat-active', 'bg-heat-completed'] as const;

function ActivityStrip({ cells, className }: { cells: HeatmapCell[]; className?: string }) {
  const { t } = useTranslation();
  const active = cells.filter((c) => c.level > 0).length;
  return (
    <Surface
      as="section"
      aria-labelledby="strip-title"
      padding="none"
      className={cn('p-5 sm:p-6', className)}
    >
      <SectionTitle
        id="strip-title"
        action={
          <Link
            to="/stats"
            className="text-sm font-medium text-accent-text underline-offset-4 hover:underline"
          >
            {t('home.seeStats')}
          </Link>
        }
      >
        {t('home.last14')}
      </SectionTitle>
      <ol
        className="grid grid-cols-14 gap-1 sm:gap-1.5"
        aria-label={t('home.stripLabel', { active })}
      >
        {cells.map((c, i) => {
          const isToday = i === cells.length - 1;
          return (
            <li key={c.date} className="flex flex-col items-center gap-1.5">
              <span
                role="img"
                aria-label={heatLabel(t, c) + (isToday ? `, ${t('stats.today')}` : '')}
                className={cn(
                  'aspect-square w-full max-w-8 rounded-[4px]',
                  heatBg[c.level],
                  isToday && 'outline-2 outline-offset-2 outline-fg',
                )}
              />
              <span
                aria-hidden="true"
                className={cn(
                  'text-[0.6875rem] leading-none',
                  isToday ? 'font-semibold text-fg' : 'text-fg-subtle',
                )}
              >
                {Number(c.date.slice(8))}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-4 text-sm text-fg-muted">
        {t('home.stripSummary', { active, total: cells.length })}
      </p>
    </Surface>
  );
}

function Forecast({ days, className }: { days: ForecastDay[]; className?: string }) {
  const { t } = useTranslation();
  const max = Math.max(1, ...days.map((d) => d.count));
  return (
    <Surface
      as="section"
      aria-labelledby="forecast-title"
      padding="none"
      className={cn('p-5 sm:p-6', className)}
    >
      <SectionTitle id="forecast-title">{t('home.forecast')}</SectionTitle>
      <ul className="flex h-32 items-end gap-2">
        {days.map((d) => {
          const label = d.today ? t('home.forecastToday') : formatWeekdayShort(d.date);
          return (
            <li
              key={d.date}
              className="flex h-full flex-1 flex-col items-center justify-end gap-1.5"
              aria-label={t('home.forecastItem', {
                day: d.today ? label : formatDayLong(d.date),
                count: d.count,
              })}
            >
              <span aria-hidden="true" className="tabular text-xs text-fg-muted">
                {d.count}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  'w-full max-w-9 rounded-t-[4px]',
                  d.today ? 'bg-accent' : 'bg-border-strong/45',
                )}
                style={{ height: `${d.count ? Math.max(6, (d.count / max) * 100) : 3}%` }}
              />
              <span
                aria-hidden="true"
                className={cn('text-xs', d.today ? 'font-semibold text-fg' : 'text-fg-muted')}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ul>
    </Surface>
  );
}

function MiniMetrics({ data, className }: { data: HomeDashboard; className?: string }) {
  const { t } = useTranslation();
  const s = data.summary.streak;
  const items = [
    {
      label: t('home.learned'),
      value: formatNumber(s.learnedCards),
      detail: t('home.learnedDetail'),
    },
    {
      label: t('home.retention'),
      value: s.retentionRate === null ? '—' : formatPercent(s.retentionRate),
      detail: t('home.retentionDetail'),
    },
  ];
  return (
    <section
      aria-label={t('home.metrics')}
      className={cn('grid grid-cols-2 gap-4 lg:gap-5', className)}
    >
      {items.map((m) => (
        <Surface key={m.label} padding="none" className="flex flex-col gap-1 p-5">
          <span className="text-sm text-fg-muted">{m.label}</span>
          <span className="tabular font-serif text-3xl leading-tight font-semibold">{m.value}</span>
          <span className="text-xs text-fg-subtle">{m.detail}</span>
        </Surface>
      ))}
    </section>
  );
}

function RecentWords({ data, className }: { data: HomeDashboard; className?: string }) {
  const { t } = useTranslation();
  return (
    <Surface
      as="section"
      aria-labelledby="recent-title"
      padding="none"
      className={cn('p-5 sm:p-6', className)}
    >
      <SectionTitle
        id="recent-title"
        action={
          <Link
            to="/library"
            className="text-sm font-medium text-accent-text underline-offset-4 hover:underline"
          >
            {t('home.seeAll')}
          </Link>
        }
      >
        {t('home.recent')}
      </SectionTitle>
      <ul className="-mx-2 flex flex-col">
        {data.recent.map((n) => (
          <li key={n.id}>
            <Link
              to={`/library?note=${encodeURIComponent(n.id)}`}
              className="flex min-h-11 items-baseline gap-3 rounded-control px-2 py-2 hover:bg-hover"
            >
              <span lang="en" className="shrink-0 font-serif text-lg font-semibold text-fg">
                {n.term}
              </span>
              <span className="min-w-0 truncate text-[0.9375rem] text-fg-muted">{n.meaning}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Surface>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4 lg:grid lg:grid-cols-[7fr_5fr] lg:gap-5">
      <Surface padding="lg" className="flex flex-col gap-6">
        <div className="flex items-center gap-6">
          <Skeleton className="size-28 rounded-full" />
          <Skeleton lines={3} className="flex-1" />
        </div>
        <Skeleton className="h-14 rounded-control" />
      </Surface>
      <Surface padding="lg">
        <Skeleton className="h-14 w-32" />
        <Skeleton lines={2} className="mt-6" />
      </Surface>
    </div>
  );
}

function HomeEmpty() {
  const { t } = useTranslation();
  const steps = [t('home.emptyStep1'), t('home.emptyStep2'), t('home.emptyStep3')];
  return (
    <Page title={t('home.emptyTitle')} description={t('home.emptyBody')}>
      <Surface padding="lg" className="flex flex-col gap-8">
        <ol className="flex flex-col gap-5">
          {steps.map((s, i) => (
            <li key={s} className="flex items-start gap-4">
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-full font-serif text-lg font-semibold',
                  i === 0 ? 'bg-accent text-accent-fg' : 'border border-border text-fg-muted',
                )}
              >
                {i + 1}
              </span>
              <p className="pt-1.5 text-[0.9375rem] text-fg">{s}</p>
            </li>
          ))}
        </ol>
        <Link to="/add" className={buttonClasses({ size: 'lg', fullWidth: true })}>
          <Icon name="plus" size={20} />
          {t('home.emptyAction')}
        </Link>
      </Surface>
      <LevelTestOffer className="mt-4" />
    </Page>
  );
}
