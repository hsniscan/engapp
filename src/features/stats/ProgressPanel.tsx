// "Gelişim" tab of the stats screen (v0.3 İP5): the recognition–production gap with a
// practice round over the biggest gaps, retention by category and the 12-week series.
// Every number comes from domain/retention.ts via data/progress.ts.
import { useLiveQuery } from 'dexie-react-hooks';
import type { TFunction } from 'i18next';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { loadLevelData, levelDataNow, logError } from '@/data';
import { getProgressView, type ProgressView } from '@/data/progress';
import {
  type GroupRetention,
  RETENTION_DIMENSIONS,
  type RetentionDimension,
  type RetentionStat,
} from '@/domain/retention';
import { practiceHref } from '@/features/extra/links';
import { buttonClasses, Select, Skeleton, Surface, Tooltip } from '@/ui';
import { formatPercent } from './format';
import { groupLabel } from './groupLabel';
import { LearnedChart, RetentionBar, RetentionLineChart, SeriesTable } from './ProgressCharts';

export function ProgressPanel() {
  const { t } = useTranslation();
  // Word levels need the client level file; the view is rebuilt once it is loaded.
  const [levelsReady, setLevelsReady] = useState(() => levelDataNow() !== null);
  useEffect(() => {
    if (levelsReady) return;
    let alive = true;
    loadLevelData()
      .then(() => alive && setLevelsReady(true))
      .catch((e: unknown) => void logError(e, 'progress:levels'));
    return () => {
      alive = false;
    };
  }, [levelsReady]);
  const view = useLiveQuery(() => getProgressView(Date.now()), [levelsReady]);

  if (!view) {
    return (
      <div aria-busy="true" className="flex flex-col gap-5">
        <span className="sr-only">{t('progress.loading')}</span>
        {Array.from({ length: 3 }, (_, i) => (
          <Surface key={i} padding="lg">
            <Skeleton lines={4} />
          </Surface>
        ))}
      </div>
    );
  }

  const { report } = view;
  const nothing =
    report.overall.n === 0 && report.series.every((p) => p.n === 0 && p.learnedTotal === 0);
  return (
    <div className="flex flex-col gap-5">
      {nothing ? (
        <Surface padding="lg">
          <p className="text-[0.9375rem] text-fg">{t('progress.empty')}</p>
        </Surface>
      ) : (
        <>
          <GapSection view={view} />
          <GroupsSection view={view} />
          <SeriesSection view={view} />
        </>
      )}
      <p className="text-xs text-fg-muted">{t('progress.rule')}</p>
    </div>
  );
}

function rateText(t: TFunction, s: RetentionStat): string {
  return s.enough && s.rate !== null ? formatPercent(s.rate) : t('progress.fewData');
}

function GapSection({ view }: { view: ProgressView }) {
  const { t } = useTranslation();
  const { gap } = view.report;
  const ids = view.gapNoteIds;
  const directions = [
    { key: 'recognition', label: t('progress.gap.recognition'), stat: gap.recognition },
    { key: 'production', label: t('progress.gap.production'), stat: gap.production },
  ] as const;
  return (
    <Surface as="section" aria-labelledby="gap-title" padding="lg">
      <h2 id="gap-title" className="font-serif text-xl font-semibold">
        {t('progress.gap.title')}
      </h2>
      <dl className="mt-4 grid grid-cols-2 gap-4">
        {directions.map((d) => (
          <div key={d.key} className="flex min-w-0 flex-col">
            <dt className="text-sm text-fg-muted">{d.label}</dt>
            <dd className="contents">
              <span
                className={
                  d.stat.enough
                    ? 'tabular mt-1 font-serif text-3xl leading-tight font-semibold'
                    : 'mt-1 font-serif text-xl leading-tight text-fg-muted'
                }
              >
                {rateText(t, d.stat)}
              </span>
              <span className="mt-1 text-xs text-fg-muted">
                {t('progress.answers', { count: d.stat.n })}
              </span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-[0.9375rem] text-fg">
        {gap.gap !== null
          ? t('progress.gap.sentence', {
              rec: formatPercent(gap.recognition.rate!),
              prod: formatPercent(gap.production.rate!),
            })
          : t('progress.gap.sentenceFew')}
      </p>
      {ids.length > 0 ? (
        <div className="mt-4 flex flex-col items-start gap-3">
          <p className="text-sm text-fg-muted">
            {t('progress.gap.practiceHint')}{' '}
            <span lang="en" className="text-fg">
              {view.gapTerms.filter(Boolean).join(', ')}
              {ids.length > view.gapTerms.length ? '…' : ''}
            </span>
          </p>
          <Link
            to={practiceHref({
              source: 'list',
              size: ids.length > 10 ? 20 : 10,
              tag: null,
              notes: ids,
            })}
            className={buttonClasses({
              className: 'h-auto min-h-11 py-2 text-center whitespace-normal',
            })}
          >
            {t('progress.gap.practice', { count: ids.length })}
          </Link>
        </div>
      ) : (
        <p className="mt-3 text-sm text-fg-muted">{t('progress.gap.noList')}</p>
      )}
    </Surface>
  );
}

function GroupsSection({ view }: { view: ProgressView }) {
  const { t } = useTranslation();
  const [dimension, setDimension] = useState<RetentionDimension>('term_type');
  const { report } = view;
  const groups = report.groups[dimension];
  const label = (g: GroupRetention) => groupLabel(t, g, view.sourceTitles);
  const dimLabel = t(`progress.groups.dimensions.${dimension}`);
  return (
    <Surface as="section" aria-labelledby="groups-title" padding="lg">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="groups-title" className="font-serif text-xl font-semibold">
          {t('progress.groups.title')}
        </h2>
        <p className="text-sm text-fg-muted">
          {t('progress.groups.overall')}:{' '}
          <span className="tabular text-fg">{rateText(t, report.overall)}</span>
          {' · '}
          {t('progress.answers', { count: report.overall.n })}
        </p>
      </div>
      <p className="mt-1 text-sm text-fg-muted">{t('progress.groups.subtitle')}</p>
      <p className="mt-4 text-[0.9375rem] text-fg">
        {report.weakest
          ? t('progress.groups.weakest', {
              group: `${label(report.weakest)} (${t(`progress.groups.dimensions.${report.weakest.dimension}`).toLocaleLowerCase('tr')})`,
              rate: formatPercent(report.weakest.rate!),
            })
          : t('progress.groups.noWeakest')}
      </p>
      <Select
        className="mt-4 max-w-72"
        label={t('progress.groups.dimension')}
        value={dimension}
        onValueChange={(v) => setDimension(v as RetentionDimension)}
        options={RETENTION_DIMENSIONS.map((d) => ({
          value: d,
          label: t(`progress.groups.dimensions.${d}`),
        }))}
      />
      {groups.length === 0 ? (
        <p className="mt-4 text-sm text-fg-muted">{t('progress.groups.empty')}</p>
      ) : (
        <ul
          className="mt-4 flex flex-col gap-1"
          aria-label={t('progress.groups.listLabel', { dimension: dimLabel })}
        >
          {groups.map((g) => {
            const name = label(g);
            const answers = t('progress.answers', { count: g.n });
            const interval =
              g.enough && g.ci
                ? t('progress.groups.interval', {
                    low: formatPercent(g.ci.low),
                    high: formatPercent(g.ci.high),
                  })
                : null;
            const row = (
              <li
                key={g.key}
                tabIndex={0}
                aria-label={
                  g.enough && g.ci
                    ? t('progress.groups.row', {
                        label: name,
                        rate: formatPercent(g.rate!),
                        answers,
                        low: formatPercent(g.ci.low),
                        high: formatPercent(g.ci.high),
                      })
                    : t('progress.groups.rowFew', { label: name, answers })
                }
                className="flex flex-col gap-1.5 rounded-control px-2 py-2 hover:bg-hover"
              >
                <div aria-hidden="true" className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-[0.9375rem] text-fg">{name}</span>
                  <span className="tabular shrink-0 text-sm">
                    <span className={g.enough ? 'font-medium text-fg' : 'text-fg-muted'}>
                      {rateText(t, g)}
                    </span>
                    <span className="text-fg-muted"> · {answers}</span>
                  </span>
                </div>
                <RetentionBar stat={g} />
              </li>
            );
            return interval ? (
              <Tooltip key={g.key} content={interval} side="top">
                {row}
              </Tooltip>
            ) : (
              row
            );
          })}
        </ul>
      )}
    </Surface>
  );
}

function SeriesSection({ view }: { view: ProgressView }) {
  const { t } = useTranslation();
  const { series } = view.report;
  const total = series.at(-1)?.learnedTotal ?? 0;
  return (
    <Surface as="section" aria-labelledby="series-title" padding="lg">
      <h2 id="series-title" className="font-serif text-xl font-semibold">
        {t('progress.series.title')}
      </h2>
      <div className="mt-4 grid gap-8 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <h3 className="font-medium">{t('progress.series.learnedTitle')}</h3>
            <span className="tabular text-sm text-fg-muted">
              {t('progress.series.learnedTotal', { count: total })}
            </span>
          </div>
          <p className="text-xs text-fg-muted">{t('progress.series.learnedHint')}</p>
          <LearnedChart series={series} />
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="font-medium">{t('progress.series.retentionTitle')}</h3>
          <p className="text-xs text-fg-muted">{t('progress.series.retentionHint')}</p>
          <RetentionLineChart series={series} />
        </div>
      </div>
      <div className="mt-4">
        <SeriesTable series={series} />
      </div>
    </Surface>
  );
}
