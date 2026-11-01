import { useTranslation } from 'react-i18next';
import { cn } from './cn';

export interface BarDatum {
  /** Short axis label ("Pzt", "3"). */
  label: string;
  value: number;
  /** Full label for the screen-reader table ("3 Kasım Pazartesi"). */
  longLabel?: string;
  /** Draw this bar in the strong colour (e.g. today); others use the muted step. */
  highlight?: boolean;
}

export interface BarChartProps {
  data: BarDatum[];
  /** Accessible summary sentence (the chart is role="img"). */
  label: string;
  /**
   * The scale's floor: bars are scaled to max(largest value, minScale), never to a distant
   * capacity — so a week of 3s is still a readable chart (review O-6).
   */
  minScale?: number;
  /** A reference value drawn as a dashed line with a label, only if it fits the scale. */
  reference?: { value: number; label: string };
  /** Chart height in px (default 120). */
  height?: number;
  /** Show every n-th axis label (default: all when ≤ 14 bars, else every 5th). */
  labelEvery?: number;
  /** All bars strong (no highlight logic). */
  solid?: boolean;
  className?: string;
}

/**
 * Vertical bar chart with visible bars: non-zero values are at least 4 px, zero is a 2 px
 * stub, bars are rounded on top, the grid is a single baseline. Includes a visually hidden
 * table of the values.
 */
export function BarChart({
  data,
  label,
  minScale = 4,
  reference,
  height = 120,
  labelEvery,
  solid,
  className,
}: BarChartProps) {
  const { t } = useTranslation();
  const peak = Math.max(minScale, ...data.map((d) => d.value));
  const every = labelEvery ?? (data.length <= 14 ? 1 : 5);
  const refFits = reference && reference.value <= peak;
  return (
    <figure className={cn('flex flex-col gap-2', className)}>
      <div role="img" aria-label={label} className="relative" style={{ height }}>
        {refFits && (
          <div
            aria-hidden="true"
            className="absolute inset-x-0 border-t border-dashed border-border-strong/60"
            style={{ bottom: `${(reference.value / peak) * 100}%` }}
          >
            <span className="absolute -top-5 right-0 text-caption text-fg-muted">
              {reference.label}
            </span>
          </div>
        )}
        <div className="absolute inset-0 flex items-end gap-[3px] border-b border-border">
          {data.map((d, i) => {
            const h = d.value > 0 ? Math.max(4, (d.value / peak) * height) : 2;
            return (
              <span
                key={i}
                aria-hidden="true"
                className={cn(
                  'min-w-0 flex-1 rounded-t-xs',
                  d.value === 0
                    ? 'bg-border'
                    : solid || d.highlight
                      ? 'bg-chart-bar'
                      : 'bg-chart-bar-muted',
                )}
                style={{ height: h }}
              />
            );
          })}
        </div>
      </div>
      <div aria-hidden="true" className="flex gap-[3px]">
        {data.map((d, i) => (
          <span
            key={i}
            className={cn(
              'min-w-0 flex-1 overflow-visible text-center text-caption whitespace-nowrap',
              d.highlight ? 'font-semibold text-fg' : 'text-fg-muted',
            )}
          >
            {i % every === 0 ? d.label : ''}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">{t('ui.chart.day')}</th>
            <th scope="col">{t('ui.chart.value')}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d, i) => (
            <tr key={i}>
              <th scope="row">{d.longLabel ?? d.label}</th>
              <td>{d.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export type HeatLevel = 'empty' | 'active' | 'completed';

export interface HeatStripProps {
  /** Oldest first. */
  days: { level: HeatLevel; label: string }[];
  /** Accessible summary ("Son 7 günün 5'inde çalıştın"). */
  label: string;
  /** 'strip' = one row (week); 'grid' = 7 rows, weeks as columns (heatmap). */
  layout?: 'strip' | 'grid';
  className?: string;
}

const heatBg: Record<HeatLevel, string> = {
  empty: 'bg-heat-empty',
  active: 'bg-heat-active',
  completed: 'bg-heat-completed',
};

/** "Studied day" squares. ONE encoding everywhere: heat-completed = goal met that day. */
export function HeatStrip({ days, label, layout = 'strip', className }: HeatStripProps) {
  return (
    <div
      role="img"
      aria-label={label}
      className={cn(
        layout === 'strip'
          ? 'flex gap-1.5'
          : 'grid w-fit grid-flow-col grid-rows-7 gap-[3px]',
        className,
      )}
    >
      {days.map((d, i) => (
        <span
          key={i}
          title={d.label}
          className={cn(
            heatBg[d.level],
            layout === 'strip' ? 'h-2.5 flex-1 rounded-full' : 'size-3.5 rounded-xs',
          )}
        />
      ))}
    </div>
  );
}
