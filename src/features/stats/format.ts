// Display formatting for study screens (Turkish locale). Presentation only: no business rules.
import type { DayKey } from '@/domain/day';
import i18n from '@/i18n';

const LOCALE = 'tr-TR';

function utcDate(key: DayKey): Date {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

const cache = new Map<string, Intl.DateTimeFormat>();
function fmt(opts: Intl.DateTimeFormatOptions, utc = true): Intl.DateTimeFormat {
  const k = JSON.stringify(opts) + utc;
  let f = cache.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat(LOCALE, utc ? { ...opts, timeZone: 'UTC' } : opts);
    cache.set(k, f);
  }
  return f;
}

/** "12 Ekim" */
export function formatDayMonth(key: DayKey): string {
  return fmt({ day: 'numeric', month: 'long' }).format(utcDate(key));
}

/** "12 Eki" */
export function formatDayMonthShort(key: DayKey): string {
  return fmt({ day: 'numeric', month: 'short' }).format(utcDate(key));
}

/** "12 Ekim Pazar" */
export function formatDayLong(key: DayKey): string {
  return fmt({ day: 'numeric', month: 'long', weekday: 'long' }).format(utcDate(key));
}

/** "Eki" */
export function formatMonthShort(key: DayKey): string {
  return fmt({ month: 'short' }).format(utcDate(key));
}

/** "Pzt" */
export function formatWeekdayShort(key: DayKey): string {
  return fmt({ weekday: 'short' }).format(utcDate(key));
}

/** "P" style one-letter weekday for compact strips. */
export function formatWeekdayNarrow(key: DayKey): string {
  return fmt({ weekday: 'narrow' }).format(utcDate(key));
}

/** "14:30" in the given time zone. */
export function formatClock(ms: number, timeZone?: string): string {
  return fmt(
    { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(timeZone ? { timeZone } : {}) },
    false,
  ).format(new Date(ms));
}

/** "%92" */
export function formatPercent(ratio: number): string {
  return new Intl.NumberFormat(LOCALE, { style: 'percent', maximumFractionDigits: 0 }).format(
    ratio,
  );
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat(LOCALE).format(n);
}

/** Study time: "45 sn", "8 dk", "1 sa 5 dk". */
export function formatDuration(ms: number): string {
  const t = i18n.t.bind(i18n);
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return t('time.seconds', { n: totalSec });
  const totalMin = Math.round(totalSec / 60);
  if (totalMin < 60) return t('time.minutes', { n: totalMin });
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? t('time.hoursMinutes', { h, m }) : t('time.hours', { h });
}
