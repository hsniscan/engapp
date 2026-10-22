// Hand-drawn charts of the progress tab ("Gelişim"). Presentation only: every number comes
// from domain/retention.ts. Marks are SVG; text (axis labels, readouts) is HTML so it stays
// readable at any width. Each chart has a text alternative (row labels, a data table).
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RetentionStat, WeekPoint } from '@/domain/retention';
import { cn } from '@/ui';
import { formatDayMonth, formatDayMonthShort, formatNumber, formatPercent } from './format';

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;

/** One horizontal retention bar with its 95 % interval as a thin whisker. */
export function RetentionBar({ stat }: { stat: RetentionStat }) {
  const show = stat.enough && stat.rate !== null;
  return (
    <svg aria-hidden="true" className="block h-3 w-full overflow-visible" focusable="false">
      <rect x="0" y="2" width="100%" height="8" rx="4" className="fill-surface-sunken" />
      {show && (
        <rect
          x="0"
          y="2"
          width={pct(Math.max(stat.rate!, 0.01))}
          height="8"
          rx="4"
          className="fill-accent"
        />
      )}
      {show && stat.ci && (
        <g className="stroke-fg" strokeWidth="1.5" strokeLinecap="round">
          <line x1={pct(stat.ci.low)} x2={pct(stat.ci.high)} y1="6" y2="6" />
          <line x1={pct(stat.ci.low)} x2={pct(stat.ci.low)} y1="3" y2="9" />
          <line x1={pct(stat.ci.high)} x2={pct(stat.ci.high)} y1="3" y2="9" />
        </g>
      )}
    </svg>
  );
}

interface FrameProps {
  label: string;
  series: WeekPoint[];
  /** Y-axis ticks from bottom to top: [value 0..1 of the chart height, text]. */
  ticks: [number, string][];
  readout: (p: WeekPoint) => string;
  children: ReactNode;
  /** Absolutely positioned HTML marks over the plot (dots). */
  overlay?: ReactNode;
}

/** Shared frame: y labels on the left, the plot, week labels below, hover readout. */
function ChartFrame({ label, series, ticks, readout, children, overlay }: FrameProps) {
  const [hover, setHover] = useState<number | null>(null);
  const n = series.length;
  const shown = series[hover ?? n - 1];
  const cols = { gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` };
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-2">
        <div aria-hidden="true" className="relative h-32 text-xs text-fg-muted tabular">
          {ticks.map(([y, text]) => (
            <span
              key={text}
              className="absolute right-0 -translate-y-1/2 leading-none"
              style={{ top: `${(1 - y) * 100}%` }}
            >
              {text}
            </span>
          ))}
        </div>
        <div className="relative h-32" role="img" aria-label={label}>
          <svg
            aria-hidden="true"
            focusable="false"
            className="absolute inset-0 h-full w-full overflow-visible"
            viewBox={`0 0 ${n * 10} 100`}
            preserveAspectRatio="none"
          >
            {ticks.map(([y, text]) => (
              <line
                key={text}
                x1="0"
                x2={n * 10}
                y1={(1 - y) * 100}
                y2={(1 - y) * 100}
                className="stroke-border"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {hover !== null && (
              <rect x={hover * 10} y="0" width="10" height="100" className="fill-hover" />
            )}
            {children}
          </svg>
          {overlay}
          <div aria-hidden="true" className="absolute inset-0 grid" style={cols}>
            {series.map((p, i) => (
              <div
                key={p.week}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
              />
            ))}
          </div>
        </div>
        <span />
        <div aria-hidden="true" className="mt-1.5 grid text-xs text-fg-muted" style={cols}>
          {series.map((p, i) => (
            <span key={p.week} className="overflow-visible text-center whitespace-nowrap">
              {(n - 1 - i) % 3 === 0 ? formatDayMonthShort(p.week) : ''}
            </span>
          ))}
        </div>
      </div>
      <p aria-hidden="true" className="tabular min-h-5 text-sm text-fg">
        {shown && readout(shown)}
      </p>
    </div>
  );
}

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const step = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= v) return m * step;
  return 10 * step;
}

export function LearnedChart({ series }: { series: WeekPoint[] }) {
  const { t } = useTranslation();
  const max = niceMax(Math.max(...series.map((p) => p.learned)));
  const weekText = (p: WeekPoint) => t('progress.series.weekOf', { date: formatDayMonth(p.week) });
  return (
    <ChartFrame
      label={t('progress.series.learnedLabel')}
      series={series}
      ticks={[
        [0, '0'],
        [0.5, formatNumber(max / 2)],
        [1, formatNumber(max)],
      ]}
      readout={(p) => t('progress.series.pointLearned', { week: weekText(p), count: p.learned })}
    >
      {series.map((p, i) => {
        const h = (p.learned / max) * 100;
        return h > 0 ? (
          <rect
            key={p.week}
            x={i * 10 + 2.5}
            y={100 - h}
            width="5"
            height={h}
            className="fill-heat-completed"
          />
        ) : null;
      })}
    </ChartFrame>
  );
}

export function RetentionLineChart({ series }: { series: WeekPoint[] }) {
  const { t } = useTranslation();
  const rates = series.filter((p) => p.enough && p.rate !== null).map((p) => p.rate!);
  // A rate is usually 70–95 %: start the axis at 50 % unless a week is lower.
  const lo = Math.min(0.5, Math.floor(Math.min(1, ...rates) * 10) / 10);
  const y = (r: number) => (r - lo) / (1 - lo);
  const weekText = (p: WeekPoint) => t('progress.series.weekOf', { date: formatDayMonth(p.week) });
  // Consecutive weeks with enough answers form one line segment.
  const segments: { i: number; r: number }[][] = [];
  let run: { i: number; r: number }[] = [];
  series.forEach((p, i) => {
    if (p.enough && p.rate !== null) run.push({ i, r: p.rate });
    else if (run.length) {
      segments.push(run);
      run = [];
    }
  });
  if (run.length) segments.push(run);
  const n = series.length;
  return (
    <ChartFrame
      label={t('progress.series.retentionLabel')}
      series={series}
      ticks={[
        [0, formatPercent(lo)],
        [0.5, formatPercent((lo + 1) / 2)],
        [1, formatPercent(1)],
      ]}
      readout={(p) =>
        p.enough && p.rate !== null
          ? t('progress.series.pointRetention', {
              week: weekText(p),
              rate: formatPercent(p.rate),
              answers: t('progress.answers', { count: p.n }),
            })
          : t('progress.series.pointFew', {
              week: weekText(p),
              answers: t('progress.answers', { count: p.n }),
            })
      }
      overlay={segments.flat().map(({ i, r }) => (
        <span
          key={i}
          aria-hidden="true"
          className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-text ring-2 ring-surface"
          style={{ left: `${((i + 0.5) / n) * 100}%`, top: `${(1 - y(r)) * 100}%` }}
        />
      ))}
    >
      {segments
        .filter((s) => s.length > 1)
        .map((s) => (
          <polyline
            key={s[0]!.i}
            points={s.map(({ i, r }) => `${i * 10 + 5},${(1 - y(r)) * 100}`).join(' ')}
            fill="none"
            className="stroke-accent-text"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
    </ChartFrame>
  );
}

/** The series as a table (text alternative for both charts). */
export function SeriesTable({ series }: { series: WeekPoint[] }) {
  const { t } = useTranslation();
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-accent-text">
        {t('progress.series.showTable')}
      </summary>
      <div className="mt-3 overflow-x-auto">
        <table className="tabular w-full text-left">
          <caption className="sr-only">{t('progress.series.title')}</caption>
          <thead className="text-fg-muted">
            <tr>
              <th scope="col" className="py-1 pr-3 font-medium">
                {t('progress.series.week')}
              </th>
              <th scope="col" className="py-1 pr-3 text-right font-medium">
                {t('progress.series.learned')}
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                {t('progress.series.retention')}
              </th>
            </tr>
          </thead>
          <tbody>
            {series.map((p) => (
              <tr key={p.week} className="border-t border-border">
                <th scope="row" className="py-1 pr-3 font-normal">
                  {formatDayMonth(p.week)}
                </th>
                <td className="py-1 pr-3 text-right">{formatNumber(p.learned)}</td>
                <td className={cn('py-1 text-right', !p.enough && 'text-fg-muted')}>
                  {p.enough && p.rate !== null ? formatPercent(p.rate) : t('progress.fewData')}
                  {' · '}
                  {t('progress.answers', { count: p.n })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
