// The home header: "Pazar, 25 Ekim" and a greeting by the hour. Presentation only.

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

/** "Pazar, 25 Ekim" (the calendar date, not the study day that starts at 04:00). */
export function homeDate(ms: number, timeZone?: string): string {
  const zone = timeZone ? { timeZone } : {};
  const weekday = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', ...zone }).format(ms);
  const day = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long', ...zone }).format(
    ms,
  );
  return `${weekday}, ${day}`;
}
