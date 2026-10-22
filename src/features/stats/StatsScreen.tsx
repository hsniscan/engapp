import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { getHeatmap, getStreakSummary } from '@/data';
import { VocabTile } from '@/features/leveltest/VocabTile';
import type { HeatmapCell, StreakSummary } from '@/domain/streak';
import { cn, Page, Skeleton, Surface, Tabs } from '@/ui';
import { formatDuration, formatNumber, formatPercent } from './format';
import { Heatmap } from './Heatmap';
import { ProgressPanel } from './ProgressPanel';

/** ?tab=gelisim opens the progress tab (v0.3 İP5); other values open the continuity tab. */
export const PROGRESS_TAB_PARAM = 'gelisim';

export function StatsScreen() {
  const { t } = useTranslation();
  const data = useLiveQuery(async () => {
    const [weeks, streak] = await Promise.all([getHeatmap(), getStreakSummary()]);
    return { weeks, streak };
  }, []);

  const [search, setSearch] = useSearchParams();
  const tab = search.get('tab') === PROGRESS_TAB_PARAM ? 'progress' : 'continuity';

  const continuity = !data ? (
    <div aria-busy="true" className="flex flex-col gap-5">
      <Surface padding="lg">
        <Skeleton className="h-40 w-full max-w-[46rem]" />
      </Surface>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Surface key={i} padding="md">
            <Skeleton lines={2} />
          </Surface>
        ))}
      </div>
    </div>
  ) : (
    <StatsBody weeks={data.weeks} streak={data.streak} />
  );

  return (
    <Page title={t('stats.title')} description={t('stats.description')} width="wide">
      <Tabs
        label={t('stats.tabsLabel')}
        value={tab}
        onValueChange={(v) =>
          setSearch(v === 'progress' ? { tab: PROGRESS_TAB_PARAM } : {}, { replace: true })
        }
        items={[
          { value: 'continuity', label: t('stats.tabContinuity'), content: continuity },
          { value: 'progress', label: t('stats.tabProgress'), content: <ProgressPanel /> },
        ]}
      />
    </Page>
  );
}

function StatsBody({ weeks, streak: s }: { weeks: HeatmapCell[][]; streak: StreakSummary }) {
  const { t } = useTranslation();
  const flat = weeks.flat().filter((c) => !c.future);
  const active = flat.filter((c) => c.level > 0).length;
  const completed = flat.filter((c) => c.level === 2).length;

  const metrics: { label: string; value: string; detail: string; hero?: boolean }[] = [
    {
      label: t('stats.currentStreak'),
      value: formatNumber(s.currentStreak),
      detail: s.todayActive ? t('stats.currentStreakToday') : t('stats.currentStreakPending'),
      hero: true,
    },
    {
      label: t('stats.longestStreak'),
      value: formatNumber(s.longestStreak),
      detail: t('stats.daysUnit', { count: s.longestStreak }),
    },
    {
      label: t('stats.totalActiveDays'),
      value: formatNumber(s.totalActiveDays),
      detail: t('stats.totalActiveDetail'),
    },
    {
      label: t('stats.last30'),
      value: formatPercent(s.last30Ratio),
      detail: t('stats.last30Detail', { count: s.last30ActiveDays }),
    },
    {
      label: t('stats.avgTime'),
      value: s.avgDailyTimeMs ? formatDuration(s.avgDailyTimeMs) : '—',
      detail: t('stats.avgTimeDetail'),
    },
    {
      label: t('stats.retention'),
      value: s.retentionRate === null ? '—' : formatPercent(s.retentionRate),
      detail: s.retentionRate === null ? t('stats.retentionNone') : t('stats.retentionDetail'),
    },
    {
      label: t('stats.learned'),
      value: formatNumber(s.learnedCards),
      detail: t('stats.learnedDetail'),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <VocabTile wide />
      <Surface as="section" aria-labelledby="heatmap-title" padding="lg">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="heatmap-title" className="font-serif text-xl font-semibold">
            {t('stats.heatmapTitle')}
          </h2>
          <p className="text-sm text-fg-muted">{t('stats.summaryLine', { active, completed })}</p>
        </div>
        <Heatmap weeks={weeks} />
      </Surface>

      <section aria-labelledby="metrics-title">
        <h2 id="metrics-title" className="sr-only">
          {t('stats.metricsTitle')}
        </h2>
        <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-5">
          {metrics.map((m) => (
            <Surface
              key={m.label}
              padding="none"
              className={cn('flex flex-col p-5', m.hero && 'col-span-2')}
            >
              <dt className={cn('text-sm text-fg-muted', m.hero && 'font-medium text-fg')}>
                {m.label}
              </dt>
              <dd className="contents">
                <span
                  className={cn(
                    'tabular mt-1 font-serif leading-tight font-semibold tracking-[-0.01em]',
                    m.hero ? 'text-5xl' : 'text-3xl',
                  )}
                >
                  {m.value}
                  {m.hero && (
                    <span className="ml-2 font-serif text-2xl font-normal text-fg-muted">
                      {t('stats.daysUnit', { count: s.currentStreak })}
                    </span>
                  )}
                </span>
                <span className="mt-1 text-xs text-fg-muted">{m.detail}</span>
              </dd>
            </Surface>
          ))}
        </dl>
      </section>
    </div>
  );
}
