// "Önümüzdeki 30 gün": expected reviews per day as bars, the daily capacity as a dashed line.
// Hand-rolled SVG in the stats screen's style; the text summary and the day list carry the
// same information for screen readers (docs/decisions/0021).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorkloadView } from '@/data';
import { formatDayLong, formatDayMonth } from '@/features/stats/format';
import { cn, Skeleton, Surface } from '@/ui';
import { useWorkload } from './useWorkload';

const W = 600;
const H = 180;
const PAD_L = 30;
const PAD_B = 22;
const PAD_T = 8;

export function WorkloadSection() {
  const { t } = useTranslation();
  const view = useWorkload();
  return (
    <Surface as="section" aria-labelledby="workload-title" padding="lg">
      <div className="mb-4 flex flex-col gap-1">
        <h2 id="workload-title" className="font-serif text-xl font-semibold">
          {t('load.forecastTitle')}
        </h2>
        <p className="text-sm text-fg-muted">{t('load.forecastSubtitle')}</p>
      </div>
      {view ? (
        <WorkloadChart view={view} />
      ) : (
        <div aria-busy="true">
          <span className="sr-only">{t('load.forecastLoading')}</span>
          <Skeleton className="h-44 w-full" />
        </div>
      )}
    </Surface>
  );
}

export function WorkloadChart({ view }: { view: WorkloadView }) {
  const { t } = useTranslation();
  const [hover, setHover] = useState<number | null>(null);
  const counts = view.totals.map((x) => Math.round(x));
  const n = counts.length;
  const max = Math.max(view.capacity * 1.15, ...counts, 1);
  const plotW = W - PAD_L;
  const plotH = H - PAD_B - PAD_T;
  const slot = plotW / n;
  const barW = Math.max(2, slot - 3);
  const y = (v: number) => PAD_T + plotH - (v / max) * plotH;
  const capY = y(view.capacity);
  const over = counts.filter((c) => c > view.capacity).length;
  const avg = Math.round(counts.reduce((a, b) => a + b, 0) / Math.max(1, n));
  let peak = 0;
  counts.forEach((c, i) => {
    if (c > counts[peak]!) peak = i;
  });
  const dayLabel = (i: number) =>
    i === 0 ? t('load.forecastToday') : formatDayMonth(view.days[i]!);
  const shown = hover ?? peak;
  const ticks = [0, 7, 14, 21, 28].filter((i) => i < n);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-fg">
        {t('load.forecastSummary', {
          avg,
          peakDay: peak === 0 ? t('load.forecastToday') : formatDayLong(view.days[peak]!),
          peak: counts[peak],
        })}{' '}
        {over ? t('load.forecastOverDays', { count: over }) : t('load.forecastUnder')}
      </p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={t('load.forecastChartLabel')}
        onPointerLeave={() => setHover(null)}
      >
        <line
          x1={PAD_L}
          x2={W}
          y1={PAD_T + plotH}
          y2={PAD_T + plotH}
          className="stroke-border"
          strokeWidth={1}
        />
        <text
          x={PAD_L - 6}
          y={PAD_T + plotH}
          textAnchor="end"
          dominantBaseline="middle"
          className="fill-fg-muted text-[11px]"
        >
          0
        </text>
        <text
          x={PAD_L - 6}
          y={capY}
          textAnchor="end"
          dominantBaseline="middle"
          className="fill-fg-muted text-[11px]"
        >
          {view.capacity}
        </text>
        {counts.map((c, i) => {
          const x = PAD_L + i * slot + (slot - barW) / 2;
          const top = y(c);
          const h = Math.max(c > 0 ? 2 : 0, PAD_T + plotH - top);
          return (
            <g key={view.days[i]} onPointerEnter={() => setHover(i)}>
              {/* Hit target: the whole column. */}
              <rect
                x={PAD_L + i * slot}
                y={PAD_T}
                width={slot}
                height={plotH}
                className="fill-transparent"
              />
              <rect
                x={x}
                y={PAD_T + plotH - h}
                width={barW}
                height={h}
                rx={Math.min(3, barW / 2)}
                className={cn(
                  c > view.capacity ? 'fill-warn' : i === 0 ? 'fill-accent' : 'fill-accent/55',
                  hover === i && 'opacity-80',
                )}
              />
            </g>
          );
        })}
        <line
          x1={PAD_L}
          x2={W}
          y1={capY}
          y2={capY}
          className="stroke-fg"
          strokeWidth={1.5}
          strokeDasharray="5 4"
          pointerEvents="none"
        />
        {ticks.map((i) => (
          <text
            key={i}
            x={PAD_L + i * slot + slot / 2}
            y={H - 6}
            textAnchor={i === 0 ? 'start' : 'middle'}
            className="fill-fg-muted text-[11px]"
          >
            {dayLabel(i)}
          </text>
        ))}
      </svg>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm">
        <p className="tabular min-h-5 text-fg" aria-hidden="true">
          <span className="font-medium">
            {shown === 0 ? t('load.forecastToday') : formatDayLong(view.days[shown]!)}
          </span>
          <span className="text-fg-muted">
            {' '}
            · {t('stats.reviewsCount', { count: counts[shown] })}
          </span>
        </p>
        <ul
          className="flex flex-wrap items-center gap-4 text-fg-muted"
          aria-label={t('stats.legend')}
        >
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-3 rounded-[3px] bg-accent/55" />
            {t('load.forecastBars')}
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-3 rounded-[3px] bg-warn" />
            {t('load.forecastOver')}
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true" className="w-4 border-t-2 border-dashed border-fg" />
            {t('load.forecastCapacity', { cards: view.capacity, min: view.capacityMin })}
          </li>
        </ul>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-accent-text underline-offset-4 hover:underline">
          {t('load.forecastTable')}
        </summary>
        <table className="mt-2 w-full max-w-sm text-left">
          <thead>
            <tr className="text-fg-muted">
              <th scope="col" className="py-1 font-normal">
                {t('load.forecastDay')}
              </th>
              <th scope="col" className="py-1 text-right font-normal">
                {t('load.forecastCount')}
              </th>
            </tr>
          </thead>
          <tbody className="tabular">
            {counts.map((c, i) => (
              <tr key={view.days[i]} className="border-t border-border">
                <th scope="row" className="py-1 font-normal">
                  {i === 0 ? t('load.forecastToday') : formatDayLong(view.days[i]!)}
                </th>
                <td
                  className={cn(
                    'py-1 text-right',
                    c > view.capacity && 'font-semibold text-warn-text',
                  )}
                >
                  {c}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <p className="text-xs text-fg-muted">{t('load.forecastNote')}</p>
    </div>
  );
}
