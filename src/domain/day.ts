// Local-day arithmetic. A "day" runs from day_start_hour (default 04:00) local time to the
// same wall-clock hour the next calendar day, so a review at 03:59 belongs to the day before.
// Wall-clock values come from Intl in the user's IANA zone; calendar math is done on
// YYYY-MM-DD keys via Date.UTC, so DST changes never shift a key.
import type { Millis } from './types';

export type DayKey = string; // YYYY-MM-DD

export interface DayConfig {
  timezone: string;
  day_start_hour: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export interface WallClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function wallClock(ms: Millis, tz: string): WallClock {
  const parts = formatter(tz).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const p = parts.find((x) => x.type === type);
    return p ? Number(p.value) : 0;
  };
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
}

/** Offset of `tz` at instant `ms` (local wall clock minus UTC), in ms. */
export function tzOffsetMs(ms: Millis, tz: string): number {
  const w = wallClock(ms, tz);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - (ms - (((ms % 1000) + 1000) % 1000));
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

function keyFromUtcDate(d: Date): DayKey {
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function parseDayKey(key: DayKey): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) throw new Error(`Invalid day key: ${key}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function keyToUtcMidnight(key: DayKey): number {
  const { year, month, day } = parseDayKey(key);
  return Date.UTC(year, month - 1, day);
}

export function addDays(key: DayKey, n: number): DayKey {
  return keyFromUtcDate(new Date(keyToUtcMidnight(key) + n * 86_400_000));
}

/** Whole days from `a` to `b` (b - a). */
export function diffDays(a: DayKey, b: DayKey): number {
  return Math.round((keyToUtcMidnight(b) - keyToUtcMidnight(a)) / 86_400_000);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayMon0(key: DayKey): number {
  return (new Date(keyToUtcMidnight(key)).getUTCDay() + 6) % 7;
}

/** The local day an instant belongs to. */
export function dayKeyOf(ms: Millis, cfg: DayConfig): DayKey {
  const w = wallClock(ms, cfg.timezone);
  const key = `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`;
  return w.hour < cfg.day_start_hour ? addDays(key, -1) : key;
}

/** UTC instant of the given local wall-clock time; DST gaps resolve forward. */
export function zonedTimeToUtc(key: DayKey, hour: number, tz: string): Millis {
  const { year, month, day } = parseDayKey(key);
  const wall = Date.UTC(year, month - 1, day, hour);
  const t1 = wall - tzOffsetMs(wall, tz);
  const t2 = wall - tzOffsetMs(t1, tz);
  const matches = (t: number): boolean => {
    const w = wallClock(t, tz);
    return w.year === year && w.month === month && w.day === day && w.hour === hour;
  };
  if (matches(t2)) return t2;
  if (matches(t1)) return t1;
  // The wall time falls into a DST gap: the later candidate is the first instant after it.
  return Math.max(t1, t2);
}

/** First instant of a local day. */
export function dayStartMs(key: DayKey, cfg: DayConfig): Millis {
  return zonedTimeToUtc(key, cfg.day_start_hour, cfg.timezone);
}

/** First instant of the following day (exclusive end). */
export function dayEndMs(key: DayKey, cfg: DayConfig): Millis {
  return dayStartMs(addDays(key, 1), cfg);
}

export interface DayBounds {
  key: DayKey;
  start: Millis;
  end: Millis;
}

export function dayBounds(ms: Millis, cfg: DayConfig): DayBounds {
  const key = dayKeyOf(ms, cfg);
  return { key, start: dayStartMs(key, cfg), end: dayEndMs(key, cfg) };
}

/** Inclusive list of keys from `from` to `to`. */
export function dayRange(from: DayKey, to: DayKey): DayKey[] {
  const out: DayKey[] = [];
  for (let k = from; k <= to; k = addDays(k, 1)) out.push(k);
  return out;
}
