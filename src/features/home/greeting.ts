// The home header: "Pazar, 25 Ekim" (the study day) and a greeting by the hour.

import { dayKeyOf, deviceTimeZone, parseDayKey } from '@/domain/day';

const LOCALE = 'tr-TR';

function hourIn(ms: number, timeZone?: string): number {
  const h = new Intl.DateTimeFormat('en-GB', {
    hour: 'numeric',
    hourCycle: 'h23',
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(ms));
  return Number(h);
}

/** Günaydın (05–11), İyi günler (12–17), İyi akşamlar (18–22), İyi geceler (23–04). */
export function greetingKey(
  ms: number,
  timeZone?: string,
): 'today.greetMorning' | 'today.greetDay' | 'today.greetEvening' | 'today.greetNight' {
  const h = hourIn(ms, timeZone);
  if (h >= 5 && h < 12) return 'today.greetMorning';
  if (h >= 12 && h < 18) return 'today.greetDay';
  if (h >= 18 && h < 23) return 'today.greetEvening';
  return 'today.greetNight';
}

/**
 * "Pazar, 25 Ekim": the study day (it starts at `dayStartHour`, 04:00 by default), the same
 * day İlerleme and the forecast call "today". At 00:13 the header still names the day before,
 * so a late-night session is not "tomorrow" on one screen and "today" on the next (2026-11-26).
 */
export function homeDate(ms: number, timeZone?: string, dayStartHour = 0): string {
  const key = dayKeyOf(ms, { timezone: timeZone ?? deviceTimeZone(), day_start_hour: dayStartHour });
  const { year, month, day } = parseDayKey(key);
  const noon = Date.UTC(year, month - 1, day, 12);
  const zone = { timeZone: 'UTC' };
  const weekday = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', ...zone }).format(noon);
  const date = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long', ...zone }).format(noon);
  return `${weekday}, ${date}`;
}
