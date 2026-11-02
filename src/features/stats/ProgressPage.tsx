// /progress, "İlerleme" (v0.5.2 design 4.15). Three tabs:
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
import {
  buttonClasses,
  Card,
  cn,
  Icon,
  ListGroup,
  ListRow,
  PageFrame,
  SectionHeader,
  Skeleton,
  StatRow,
  StatTile,
  Tabs,
} from '@/ui';
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
    <PageFrame
      width="wide"
      title={t('stats.overview.title')}
      back={{ to: '/profile', label: t('settings.index.back') }}
    >
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
              <div className="mt-6 flex flex-col gap-8">
                <ProgressPanel />
                <LeechStatsSection />
              </div>
            ),
          },
          { value: 'report', label: t('stats.tabReport'), content: <ReportPanel /> },
        ]}
      />
    </PageFrame>
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
      // A report waiting for its comment is shown on the report tab too (B7).
      Promise.all([db.weekly_reports.count(), db.report_drafts.count()]).then(([a, b]) => a + b),
    ]);
    return { weeks, streak, hard, basics: activityBasics(activity, streak.today), reports };
  }, []);

  if (!data) {
    return (
      <div className="mt-6 flex flex-col gap-4" aria-busy="true">
        <Card padding="lg">
          <Skeleton lines={4} />
        </Card>
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
      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-2 lg:items-start">
        <FirstStepsCard unlocks={unlocks} />
        <Continuity weeks={data.weeks} streak={data.streak} />
        {/* Goals are set here only; a link with ?edit=goals must work on day one too. */}
        {editGoals && <GoalsSection />}
      </div>
    );
  }

  const recall = unlocks.find((u) => u.key === 'recall')!;
  return (
    <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-2 lg:items-start">
      <StagesSection />
      <VocabTile measureRow />
      <Continuity weeks={data.weeks} streak={data.streak} className="lg:col-span-2" />
      <GoalsSection />
      <WorkloadSection />
      <section aria-label={t('stats.overview.practiceLabel')} className="lg:col-span-2">
        <div className="grid grid-cols-2 gap-3 lg:gap-4">
          <HardTile count={data.hard} />
          <RecallTile
            rate={recall.open ? data.streak.retentionRate : null}
            remaining={recall.remaining}
          />
        </div>
      </section>
      {data.reports > 0 ? (
        <div className="lg:col-span-2">
          <ListGroup>
            <ListRow
              onClick={onReport}
              leadingIcon="calendar"
              title={t('stats.overview.reportLink')}
              description={t('stats.overview.reportHint')}
            />
          </ListGroup>
        </div>
      ) : (
        <p className="px-1 text-meta text-fg-muted lg:col-span-2" data-testid="report-locked">
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
    <Card
      as="section"
      aria-labelledby="first-steps-title"
      padding="lg"
      className="flex flex-col gap-5"
      data-testid="progress-first-steps"
    >
      <div className="flex flex-col gap-1.5">
        <h2 id="first-steps-title" className="text-title font-semibold text-fg">
          {t('stats.unlock.title')}
        </h2>
        <p className="text-ui text-fg-muted">{t('stats.unlock.body')}</p>
      </div>
      <Link to="/study" className={buttonClasses({ className: 'self-start' })}>
        {t('stats.unlock.start')}
      </Link>
      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <h3 className="text-ui font-semibold text-fg">{t('stats.unlock.listTitle')}</h3>
        <ul className="flex flex-col gap-3" aria-label={t('stats.unlock.listTitle')}>
          {unlocks.map((u) => (
            <li key={u.key} className="flex items-start gap-3 text-meta">
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full',
                  u.open ? 'bg-accent-soft text-accent-text' : 'bg-surface-sunken text-fg-subtle',
                )}
              >
                {u.open ? <Icon name="check" size={14} /> : <Icon name="clock" size={14} />}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-ui font-medium text-fg">
                  {t(`stats.unlock.items.${u.key}.name`)}
                </span>
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
    </Card>
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
  return (
    <section aria-labelledby="continuity-title" className={className}>
      <SectionHeader
        id="continuity-title"
        title={t('stats.overview.continuity')}
        description={
          s.todayActive ? t('stats.currentStreakToday') : t('stats.currentStreakPending')
        }
      />
      <div className="flex flex-col gap-3">
        <StatRow>
          <StatTile
            bare
            value={formatNumber(s.currentStreak)}
            unit={t('stats.daysUnit', { count: s.currentStreak })}
            label={t('stats.overview.streak')}
          />
          <StatTile
            bare
            value={formatNumber(s.longestStreak)}
            label={t('stats.overview.longest')}
          />
          <StatTile
            bare
            value={formatNumber(s.totalActiveDays)}
            label={t('stats.overview.activeDays')}
          />
        </StatRow>
        <Card className="flex flex-col gap-4">
          <Heatmap weeks={weeks} />
          <dl className="grid grid-cols-2 gap-3 border-t border-border pt-4 text-meta">
            <div className="flex flex-col gap-0.5">
              <dt className="text-fg-muted">{t('stats.last30')}</dt>
              <dd className="tabular text-ui font-semibold text-fg">
                {formatPercent(s.last30Ratio)}{' '}
                <span className="text-meta font-normal text-fg-muted">
                  · {t('stats.last30Detail', { count: s.last30ActiveDays })}
                </span>
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-fg-muted">{t('stats.avgTime')}</dt>
              <dd className="tabular text-ui font-semibold text-fg">
                {s.avgDailyTimeMs ? formatDuration(s.avgDailyTimeMs) : '—'}
              </dd>
            </div>
          </dl>
        </Card>
      </div>
    </section>
  );
}

/** "Zorlandıkların": cards the hard-words practice would ask now; a link only when there are any. */
function HardTile({ count }: { count: number }) {
  const { t } = useTranslation();
  const body = (
    <>
      <span className="text-meta font-semibold text-fg-muted">{t('stats.overview.hardTitle')}</span>
      <span className="tabular text-heading font-semibold text-fg">{formatNumber(count)}</span>
      <span
        className={cn(
          'mt-auto inline-flex items-center gap-1 text-meta font-semibold',
          count > 0 ? 'text-warn-text' : 'text-fg-muted',
        )}
      >
        {count > 0 ? t('stats.overview.hardPractice') : t('stats.overview.hardNone')}
        {count > 0 && <Icon name="chevron-right" size={16} />}
      </span>
    </>
  );
  const cls = 'flex min-h-32 flex-col gap-1';
  if (count === 0) {
    return (
      <Card className={cls} data-testid="hard-tile">
        {body}
      </Card>
    );
  }
  return (
    <Card
      as={Link}
      to={practiceHref({ source: 'hard', size: 10, tag: null })}
      interactive
      className={cls}
      data-testid="hard-tile"
    >
      {body}
    </Card>
  );
}

function RecallTile({ rate, remaining }: { rate: number | null; remaining: number }) {
  const { t } = useTranslation();
  return (
    <Card className="flex min-h-32 flex-col gap-1">
      <span className="text-meta font-semibold text-fg-muted">
        {t('stats.overview.recallTitle')}
      </span>
      <span className="tabular text-heading font-semibold text-fg">
        {rate === null ? '—' : formatPercent(rate)}
      </span>
      <span className="mt-auto text-meta text-fg-muted">
        {rate === null
          ? t('stats.unlock.items.recall.when', { count: Math.max(1, remaining) })
          : t('stats.overview.recallDetail')}
      </span>
    </Card>
  );
}
