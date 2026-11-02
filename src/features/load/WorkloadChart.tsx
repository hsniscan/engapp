// "Önümüzdeki 30 gün": expected reviews per day as bars (v0.5.2 design 4.15). The shared
// BarChart scales to the busiest day (floor: max(5, a quarter of the capacity)), so bars stay
// visible even when the capacity is far above them (review O-6); the capacity line is drawn
// only when it fits. The summary sentence, the capacity line text and the day list carry the
// same information in words (docs/decisions/0021).
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorkloadView } from '@/data';
import { formatDayLong } from '@/features/stats/format';
import { BarChart, Button, Card, cn, SectionHeader, Skeleton } from '@/ui';
import { useWorkload } from './useWorkload';

export function WorkloadSection() {
  const { t } = useTranslation();
  const view = useWorkload();
  return (
    <section aria-labelledby="workload-title">
      <SectionHeader
        id="workload-title"
        title={t('load.forecastTitle')}
        description={t('load.forecastSubtitle')}
      />
      <Card>
        {view ? (
          <WorkloadChart view={view} />
        ) : (
          <div aria-busy="true">
            <span className="sr-only">{t('load.forecastLoading')}</span>
            <Skeleton className="h-44 w-full" />
          </div>
        )}
      </Card>
    </section>
  );
}

/** Day of month for the axis ("3"), from a day key "2026-11-03". */
const dayOfMonth = (key: string) => String(Number(key.slice(8, 10)));

export function WorkloadChart({ view }: { view: WorkloadView }) {
  const { t } = useTranslation();
  const [listOpen, setListOpen] = useState(false);
  const listId = useId();
  const counts = view.totals.map((x) => Math.round(x));
  const n = counts.length;
  const over = counts.filter((c) => c > view.capacity).length;
  const avg = Math.round(counts.reduce((a, b) => a + b, 0) / Math.max(1, n));
  let peak = 0;
  counts.forEach((c, i) => {
    if (c > counts[peak]!) peak = i;
  });
  const longDay = (i: number) =>
    i === 0 ? t('load.forecastToday') : formatDayLong(view.days[i]!);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-ui text-fg">
        {t('load.forecastSummary', {
          avg,
          peakDay: longDay(peak),
          peak: counts[peak],
        })}{' '}
        {over ? t('load.forecastOverDays', { count: over }) : t('load.forecastUnder')}
      </p>
      <BarChart
        label={t('load.forecastChartLabel')}
        height={140}
        minScale={Math.max(5, Math.round(view.capacity * 0.25))}
        reference={{
          value: view.capacity,
          label: t('load.forecastCapacityShort', { cards: view.capacity }),
        }}
        labelEvery={5}
        data={counts.map((c, i) => ({
          label: dayOfMonth(view.days[i]!),
          longLabel: longDay(i),
          value: c,
          highlight: i === 0,
        }))}
      />
      <p className="flex items-center gap-2 text-meta text-fg-muted">
        <span aria-hidden="true" className="w-4 border-t-2 border-dashed border-border-strong" />
        {t('load.forecastCapacity', { cards: view.capacity, min: view.capacityMin })}
      </p>
      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <Button
          variant="ghost"
          size="sm"
          className="-mx-2 self-start text-accent-text"
          trailingIcon={listOpen ? 'chevron-up' : 'chevron-down'}
          aria-expanded={listOpen}
          aria-controls={listId}
          onClick={() => setListOpen((o) => !o)}
        >
          {t('load.forecastTable')}
        </Button>
        {listOpen && (
          <table id={listId} className="w-full text-left text-meta">
            <caption className="sr-only">{t('load.forecastTable')}</caption>
            <thead>
              <tr className="text-fg-muted">
                <th scope="col" className="py-2 font-normal">
                  {t('load.forecastDay')}
                </th>
                <th scope="col" className="py-2 text-right font-normal">
                  {t('load.forecastCount')}
                </th>
              </tr>
            </thead>
            <tbody className="tabular">
              {counts.map((c, i) => (
                <tr key={view.days[i]} className="border-t border-border">
                  <th scope="row" className="py-2.5 font-normal text-fg">
                    {longDay(i)}
                  </th>
                  <td
                    className={cn(
                      'py-2.5 text-right text-fg',
                      c > view.capacity && 'font-semibold text-warn-text',
                    )}
                  >
                    {c}
                    {c > view.capacity && (
                      <span className="sr-only"> · {t('load.forecastOver')}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-caption font-normal text-fg-muted">{t('load.forecastNote')}</p>
    </div>
  );
}
