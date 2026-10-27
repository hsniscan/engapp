// /progress, "İlerleme" (redesign; was /stats "İstatistik"). Three tabs:
//   Genel          words by stage, estimated vocabulary + level path, continuity (streak,
//                  heatmap), goals, the next 30 days, struggling words, recall, weekly report link
//   Gelişim        (?tab=gelisim) recognition–production gap, retention by group, 12-week series,
//                  and the full struggling-words list
//   Haftalık rapor (?tab=rapor)
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { db, getHardPracticeCount, getHeatmap, getStreakSummary } from '@/data';
import {
  activityBasics,
  isProgressBeginner,
  progressUnlocks,
  type UnlockInfo,
} from '@/domain/progressView';
import type { HeatmapCell, StreakSummary } from '@/domain/streak';
import { practiceHref } from '@/features/extra/links';
import { LeechStatsSection } from '@/features/leech';
import { VocabTile } from '@/features/leveltest/VocabTile';
import { WorkloadSection } from '@/features/load/WorkloadChart';
import { GoalsSection } from '@/features/report/GoalsSection';
import { REPORT_TAB_PARAM } from '@/features/report/links';
import { ReportPanel } from '@/features/report/ReportPanel';
import { buttonClasses, cn, Icon, Page, Skeleton, Surface, Tabs } from '@/ui';
import { formatDuration, formatNumber, formatPercent } from './format';
import { Heatmap } from './Heatmap';
import { ProgressPanel } from './ProgressPanel';
import { StagesSection } from './StagesSection';

export const PROGRESS_TAB_PARAM = 'gelisim';
export { REPORT_TAB_PARAM };
const TAB_BY_PARAM: Record<string, 'progress' | 'report'> = {
  [PROGRESS_TAB_PARAM]: 'progress',
  [REPORT_TAB_PARAM]: 'report',
};

export function ProgressPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useSearchParams();
  const tab = TAB_BY_PARAM[search.get('tab') ?? ''] ?? 'general';
  const setTab = (v: string) =>
    setSearch(
      v === 'progress'
        ? { tab: PROGRESS_TAB_PARAM }
        : v === 'report'
          ? { tab: REPORT_TAB_PARAM }
          : {},
      { replace: true },
    );

  return (
    <Page title={t('stats.overview.title')} width="wide" className="pt-5">
      <Tabs
        label={t('stats.overview.tabsLabel')}
        value={tab}
        onValueChange={setTab}
        items={[
          {
            value: 'general',
            label: t('stats.overview.tabGeneral'),
            content: <General onReport={() => setTab('report')} />,
          },
          {
            value: 'progress',
            label: t('stats.tabProgress'),
            content: (
              <div className="flex flex-col gap-5">
                <ProgressPanel />
                <LeechStatsSection />
              </div>
            ),
          },
          { value: 'report', label: t('stats.tabReport'), content: <ReportPanel /> },
        ]}
      />
    </Page>
  );
}

function General({ onReport }: { onReport: () => void }) {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const editGoals = search.get('edit') === 'goals';
  const data = useLiveQuery(async () => {
    const [weeks, streak, hard, activity, reports] = await Promise.all([
      getHeatmap(),
      getStreakSummary(),
      getHardPracticeCount(Date.now()),
      db.daily_activity.toArray(),
      db.weekly_reports.count(),
    ]);
    return { weeks, streak, hard, basics: activityBasics(activity, streak.today), reports };
  }, []);

  if (!data) {
    return (
      <div className="mt-5 flex flex-col gap-4">
        <Surface padding="lg" aria-busy="true">
          <Skeleton className="h-40 w-full" />
        </Surface>
      </div>
    );
  }

  const unlocks = progressUnlocks({
    totalAnswers: data.basics.totalAnswers,
    last30Answers: data.basics.last30Answers,
    // The Gelişim tab counts each direction itself; here only "when" is said.
    recognitionAnswers: 0,
    productionAnswers: 0,
    hasReport: data.reports > 0,
  });

  // Progressive İlerleme (v0.5.1): a new user sees one card and the calendar, not a wall of 0s.
  if (isProgressBeginner(data.basics.totalAnswers)) {
    return (
      <div className="mt-5 flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-5">
        <FirstStepsCard unlocks={unlocks} />
        <Continuity weeks={data.weeks} streak={data.streak} />
        {/* Goals are set here only; a link with ?edit=goals must work on day one too. */}
        {editGoals && <GoalsSection />}
      </div>
    );
  }

  const recall = unlocks.find((u) => u.key === 'recall')!;
  return (
    <div className="mt-5 flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-5">
      <StagesSection />
      <VocabTile />
      <Continuity weeks={data.weeks} streak={data.streak} className="lg:col-span-2" />
      <GoalsSection />
      <WorkloadSection />
      <div className="grid grid-cols-2 gap-3 lg:col-span-2 lg:gap-5">
        <HardTile count={data.hard} />
        <RecallTile
          rate={recall.open ? data.streak.retentionRate : null}
          remaining={recall.remaining}
        />
      </div>
      {data.reports > 0 ? (
        <button
          type="button"
          onClick={onReport}
          className="flex min-h-[3.75rem] items-center gap-3.5 rounded-card border border-border bg-surface px-4 py-3 text-left text-fg hover:bg-surface-hover lg:col-span-2"
        >
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[0.9375rem] font-semibold">{t('stats.overview.reportLink')}</span>
            <span className="text-[0.8125rem] text-fg-muted">{t('stats.overview.reportHint')}</span>
          </span>
          <Icon name="chevron-right" size={18} className="shrink-0 text-fg-subtle" />
        </button>
      ) : (
        <p className="px-1 text-sm text-fg-muted lg:col-span-2" data-testid="report-locked">
          {t('stats.unlock.reportLater')}
        </p>
      )}
    </div>
  );
}

/** The one card a new user sees: start studying, and what opens when. */
function FirstStepsCard({ unlocks }: { unlocks: UnlockInfo[] }) {
  const { t } = useTranslation();
  return (
    <Surface
      as="section"
      aria-labelledby="first-steps-title"
      padding="none"
      className="flex flex-col gap-4 p-5 sm:p-6"
      data-testid="progress-first-steps"
    >
      <div className="flex flex-col gap-1.5">
        <h2 id="first-steps-title" className="font-serif text-[1.375rem] font-semibold text-fg">
          {t('stats.unlock.title')}
        </h2>
        <p className="text-[0.9375rem] text-fg-muted">{t('stats.unlock.body')}</p>
      </div>
      <Link to="/study" className={buttonClasses({ className: 'self-start' })}>
        {t('stats.unlock.start')}
      </Link>
      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <h3 className="text-sm font-semibold text-fg">{t('stats.unlock.listTitle')}</h3>
        <ul className="flex flex-col gap-2.5" aria-label={t('stats.unlock.listTitle')}>
          {unlocks.map((u) => (
            <li key={u.key} className="flex items-start gap-2.5 text-sm">
              {u.open ? (
                <Icon name="check" size={16} className="mt-0.5 shrink-0 text-success-text" />
              ) : (
                <span
                  aria-hidden="true"
                  className="mt-[0.3125rem] ml-[0.1875rem] size-2.5 shrink-0 rounded-full border-[1.5px] border-fg-subtle"
                />
              )}
              <span className="flex min-w-0 flex-col">
                <span className="font-medium text-fg">{t(`stats.unlock.items.${u.key}.name`)}</span>
                <span className="text-fg-muted">
                  {u.open
                    ? t('stats.unlock.open')
                    : t(`stats.unlock.items.${u.key}.when`, { count: u.remaining })}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Surface>
  );
}

function Continuity({
  weeks,
  streak: s,
  className,
}: {
  weeks: HeatmapCell[][];
  streak: StreakSummary;
  className?: string;
}) {
  const { t } = useTranslation();
  const stats = [
    { key: 'streak', label: t('stats.overview.streak'), value: s.currentStreak, unit: true },
    { key: 'longest', label: t('stats.overview.longest'), value: s.longestStreak },
    { key: 'active', label: t('stats.overview.activeDays'), value: s.totalActiveDays },
  ];
  return (
    <Surface
      as="section"
      aria-labelledby="continuity-title"
      padding="none"
      className={cn('flex flex-col gap-4 p-5 sm:p-6', className)}
    >
      <h2 id="continuity-title" className="font-serif text-[1.1875rem] font-semibold">
        {t('stats.overview.continuity')}
      </h2>
      <dl className="grid grid-cols-[1.3fr_1fr_1fr] gap-3">
        {stats.map((m, i) => (
          <div
            key={m.key}
            className={cn('flex min-w-0 flex-col gap-1', i > 0 && 'border-l border-border pl-3')}
          >
            <dt className="text-[0.8125rem] text-fg-muted">{m.label}</dt>
            <dd className="tabular font-serif text-[2rem] leading-none font-semibold text-fg">
              {formatNumber(m.value)}
              {m.unit && (
                <span className="ml-1 font-serif text-base font-normal text-fg-muted">
                  {t('stats.daysUnit', { count: m.value })}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-fg-muted">
        {s.todayActive ? t('stats.currentStreakToday') : t('stats.currentStreakPending')}
      </p>
      <Heatmap weeks={weeks} />
      <dl className="grid grid-cols-2 gap-3 border-t border-border pt-4 text-sm">
        <div className="flex flex-col">
          <dt className="text-fg-muted">{t('stats.last30')}</dt>
          <dd className="tabular font-semibold text-fg">
            {formatPercent(s.last30Ratio)}{' '}
            <span className="font-normal text-fg-muted">
              · {t('stats.last30Detail', { count: s.last30ActiveDays })}
            </span>
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-fg-muted">{t('stats.avgTime')}</dt>
          <dd className="tabular font-semibold text-fg">
            {s.avgDailyTimeMs ? formatDuration(s.avgDailyTimeMs) : '—'}
          </dd>
        </div>
      </dl>
    </Surface>
  );
}

/** "Zorlandıkların": cards the hard-words practice would ask now; a link only when there are any. */
function HardTile({ count }: { count: number }) {
  const { t } = useTranslation();
  const body = (
    <>
      <span className="text-[0.8125rem] font-semibold">{t('stats.overview.hardTitle')}</span>
      <span className="tabular font-serif text-[2rem] leading-none font-semibold">
        {formatNumber(count)}
      </span>
      <span className="mt-auto inline-flex items-center gap-1 text-sm font-semibold">
        {count > 0 ? t('stats.overview.hardPractice') : t('stats.overview.hardNone')}
        {count > 0 && <Icon name="chevron-right" size={16} />}
      </span>
    </>
  );
  const base = 'flex min-h-32 flex-col gap-1 rounded-card border p-4 sm:p-5';
  if (count === 0) {
    return (
      <div className={cn(base, 'border-border bg-surface text-fg')} data-testid="hard-tile">
        {body}
      </div>
    );
  }
  return (
    <Link
      to={practiceHref({ source: 'hard', size: 10, tag: null })}
      className={cn(base, 'border-warn-soft bg-warn-soft text-warn-text hover:brightness-[0.98]')}
      data-testid="hard-tile"
    >
      {body}
    </Link>
  );
}

function RecallTile({ rate, remaining }: { rate: number | null; remaining: number }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-32 flex-col gap-1 rounded-card border border-border bg-surface p-4 sm:p-5">
      <span className="text-[0.8125rem] font-semibold text-fg-muted">
        {t('stats.overview.recallTitle')}
      </span>
      <span className="tabular font-serif text-[2rem] leading-none font-semibold text-fg">
        {rate === null ? '—' : formatPercent(rate)}
      </span>
      <span className="mt-auto text-[0.8125rem] text-fg-muted">
        {rate === null
          ? t('stats.unlock.items.recall.when', { count: Math.max(1, remaining) })
          : t('stats.overview.recallDetail')}
      </span>
    </div>
  );
}
