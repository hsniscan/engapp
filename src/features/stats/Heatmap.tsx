import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { HeatmapCell } from '@/domain/streak';
import { cn } from '@/ui';
import { formatDayLong, formatMonthShort, formatWeekdayShort } from './format';
import { heatLabel } from './heatLabel';

const heatBg = ['bg-heat-empty', 'bg-heat-active', 'bg-heat-completed'] as const;
const COLS = (weeks: number) => ({
  gridTemplateColumns: `2.25rem repeat(${weeks}, minmax(0, 1fr))`,
});

export interface HeatmapProps {
  /** weeks[w][d], Monday first, ending with the current week (from getHeatmap). */
  weeks: HeatmapCell[][];
}

/**
 * Calendar heatmap as an ARIA grid: rows are weekdays, columns are weeks. One cell is in the
 * tab order (roving tabindex); arrow keys, Home/End and PageUp/PageDown move between days.
 * Every cell has a full text label, and the focused/hovered day is described below in words.
 */
export function Heatmap({ weeks }: HeatmapProps) {
  const { t } = useTranslation();
  const flat = weeks.flat();
  const todayIndex = Math.max(
    0,
    flat.findLastIndex((c) => !c.future),
  );
  const [active, setActive] = useState(todayIndex);
  const [hover, setHover] = useState<number | null>(null);
  const refs = useRef(new Map<number, HTMLDivElement>());
  const scroller = useRef<HTMLDivElement>(null);
  // On narrow screens the calendar scrolls; start at the most recent weeks.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);
  const n = weeks.length;

  const shown = flat[hover ?? active];

  function move(to: number) {
    // Days after today are not part of the navigation.
    const next = to > todayIndex ? active : Math.max(0, to);
    setActive(next);
    refs.current.get(next)?.focus();
  }

  function onKey(e: KeyboardEvent) {
    const w = Math.floor(active / 7);
    const d = active % 7;
    const keys: Record<string, number> = {
      ArrowRight: active + 7,
      ArrowLeft: active - 7,
      ArrowDown: d < 6 ? active + 1 : active,
      ArrowUp: d > 0 ? active - 1 : active,
      Home: w * 7,
      End: Math.min(todayIndex, w * 7 + 6),
      PageUp: active - 28,
      PageDown: active + 28,
    };
    if (e.ctrlKey && e.key === 'Home') keys.Home = 0;
    if (e.ctrlKey && e.key === 'End') keys.End = todayIndex;
    const to = keys[e.key];
    if (to === undefined) return;
    e.preventDefault();
    move(to);
  }

  // Month labels: at the first column whose Monday starts a new month.
  const months = weeks.map((week, w) => {
    const first = week[0]!.date;
    const prev = w > 0 ? weeks[w - 1]![0]!.date : null;
    return !prev || first.slice(0, 7) !== prev.slice(0, 7) ? formatMonthShort(first) : null;
  });
  // The first column's label would collide with a month that starts one or two weeks later.
  if (months[1] || months[2]) months[0] = null;

  return (
    <div className="flex flex-col gap-3">
      <div ref={scroller} className="-mx-2 overflow-x-auto px-2 pt-0.5 pb-2 [scrollbar-width:thin]">
        <div className="w-full max-w-[46rem] min-w-[26rem]">
          <div
            aria-hidden="true"
            className="mb-1.5 grid gap-[3px] text-xs text-fg-muted"
            style={COLS(n)}
          >
            <span />
            {months.map((m, w) => (
              <span key={w} className="overflow-visible whitespace-nowrap">
                {m}
              </span>
            ))}
          </div>
          <div
            role="grid"
            aria-label={t('stats.heatmapLabel')}
            aria-describedby="heatmap-help"
            onKeyDown={onKey}
            className="flex flex-col gap-[3px]"
          >
            {Array.from({ length: 7 }, (_, d) => (
              <div role="row" key={d} className="grid gap-[3px]" style={COLS(n)}>
                <span role="rowheader" className="self-center text-xs leading-none text-fg-muted">
                  <span aria-hidden="true">
                    {d % 2 === 0 ? formatWeekdayShort(weeks[0]![d]!.date) : ''}
                  </span>
                  <span className="sr-only">{formatWeekdayShort(weeks[0]![d]!.date)}</span>
                </span>
                {weeks.map((week, w) => {
                  const i = w * 7 + d;
                  const cell = week[d]!;
                  const isToday = i === todayIndex;
                  return (
                    <div
                      key={cell.date}
                      role="gridcell"
                      ref={(el) => {
                        if (el) refs.current.set(i, el);
                        else refs.current.delete(i);
                      }}
                      tabIndex={cell.future ? undefined : i === active ? 0 : -1}
                      aria-label={heatLabel(t, cell) + (isToday ? `, ${t('stats.today')}` : '')}
                      aria-selected={i === active}
                      aria-disabled={cell.future || undefined}
                      onFocus={() => setActive(i)}
                      onClick={() => !cell.future && move(i)}
                      onPointerEnter={() => !cell.future && setHover(i)}
                      onPointerLeave={() => setHover(null)}
                      className={cn(
                        'aspect-square rounded-[3px] focus-visible:outline-offset-1',
                        cell.future ? 'border border-dashed border-border' : heatBg[cell.level],
                        isToday && 'outline-2 outline-offset-1 outline-fg',
                      )}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <p className="tabular min-h-5 text-sm text-fg" aria-hidden="true">
          {shown && (
            <>
              <span className="font-medium">{formatDayLong(shown.date)}</span>
              <span className="text-fg-muted">
                {' · '}
                {shown.level === 0
                  ? t('stats.noReviews')
                  : t('stats.reviewsCount', { count: shown.reviews }) +
                    (shown.level === 2 ? ` · ${t('stats.legendCompleted')}` : '')}
              </span>
            </>
          )}
        </p>
        <ul
          className="flex items-center gap-4 text-sm text-fg-muted"
          aria-label={t('stats.legend')}
        >
          {(['legendEmpty', 'legendActive', 'legendCompleted'] as const).map((k, level) => (
            <li key={k} className="flex items-center gap-1.5">
              <span aria-hidden="true" className={cn('size-3 rounded-[3px]', heatBg[level])} />
              {t(`stats.${k}`)}
            </li>
          ))}
        </ul>
      </div>
      <p id="heatmap-help" className="sr-only">
        {t('stats.keyboardHint')}
      </p>
    </div>
  );
}
