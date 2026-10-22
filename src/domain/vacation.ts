// Vacation mode (v0.3 İP3, docs/decisions/0021-load-management.md). A vacation is a range of
// local days, both ends included, kept in the synced settings row (the push package reads it
// on the server too). On vacation days no new cards are opened and no reminder is sent; a day
// of a vacation without any review neither breaks nor extends the streak.
import { addDays, type DayKey, diffDays } from './day';
import type { Settings, VacationRange } from './types';

/** Longest vacation the settings accept. */
export const MAX_VACATION_DAYS = 90;
/** Earlier vacations kept for the streak. */
export const MAX_VACATION_HISTORY = 20;
/** "Review ahead before you leave" covers at most this many days. */
export const MAX_AHEAD_DAYS = 7;
/** The offer to review ahead shows from this many days before the start. */
export const AHEAD_OFFER_DAYS = 3;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

type VacationSettings = Pick<Settings, 'vacation'>;
type VacationHistorySettings = Pick<Settings, 'vacation' | 'vacation_history'>;

export function isValidRange(r: unknown): r is VacationRange {
  if (!r || typeof r !== 'object') return false;
  const { start, end } = r as Record<string, unknown>;
  return (
    typeof start === 'string' &&
    typeof end === 'string' &&
    DAY_RE.test(start) &&
    DAY_RE.test(end) &&
    start <= end &&
    diffDays(start, end) < MAX_VACATION_DAYS
  );
}

export function inRange(r: VacationRange, day: DayKey): boolean {
  return r.start <= day && day <= r.end;
}

/** The day falls inside the current vacation setting. */
export function isOnVacation(settings: VacationSettings, day: DayKey): boolean {
  const v = settings.vacation;
  return !!v && isValidRange(v) && inRange(v, day);
}

/** Current vacation and earlier ones (valid ranges only). */
export function vacationRanges(settings: Partial<VacationHistorySettings>): VacationRange[] {
  const out: VacationRange[] = [];
  for (const r of settings.vacation_history ?? []) if (isValidRange(r)) out.push(r);
  if (settings.vacation && isValidRange(settings.vacation)) out.push(settings.vacation);
  return out;
}

/** A day of any vacation, past or current: neutral for the streak when nothing was reviewed. */
export function isVacationDay(settings: Partial<VacationHistorySettings>, day: DayKey): boolean {
  return vacationRanges(settings).some((r) => inRange(r, day));
}

/**
 * Days since the latest vacation ended, counting the first day back as 1; null when no
 * vacation ended before `day` or `day` is itself a vacation day.
 */
export function daysSinceVacation(settings: Partial<VacationHistorySettings>, day: DayKey): number | null {
  let best: number | null = null;
  for (const r of vacationRanges(settings)) {
    if (inRange(r, day)) return null;
    if (r.end < day) {
      const d = diffDays(r.end, day);
      if (best === null || d < best) best = d;
    }
  }
  return best;
}

/**
 * Days to review ahead before an upcoming vacation (0: no offer). Offered from
 * AHEAD_OFFER_DAYS days before the start; covers the vacation, at most MAX_AHEAD_DAYS days
 * from today. The result is the number of days after today whose reviews may be done now.
 */
export function aheadDaysBeforeVacation(settings: VacationSettings, today: DayKey): number {
  const v = settings.vacation;
  if (!v || !isValidRange(v) || v.start <= today) return 0;
  const untilStart = diffDays(today, v.start);
  if (untilStart > AHEAD_OFFER_DAYS) return 0;
  return Math.min(MAX_AHEAD_DAYS, diffDays(today, v.end));
}

/**
 * The settings fields after choosing a new vacation (or none). A vacation that has already
 * begun moves to the history, so its days stay neutral for the streak; one that has not
 * begun is simply replaced. Pure.
 */
export function withVacation(
  settings: Partial<VacationHistorySettings>,
  next: VacationRange | null,
  today: DayKey,
): Pick<Settings, 'vacation' | 'vacation_history'> {
  let history = (settings.vacation_history ?? []).filter(isValidRange);
  const cur = settings.vacation;
  if (cur && isValidRange(cur) && cur.start <= today && !(next && next.start === cur.start)) {
    // The days already lived stay a vacation; the rest of it is dropped.
    const end = cur.end < today ? cur.end : addDays(today, -1);
    if (end >= cur.start) history = [...history, { start: cur.start, end }];
  }
  history = history.slice(-MAX_VACATION_HISTORY);
  return { vacation: next, vacation_history: history.length ? history : null };
}

/**
 * End the current vacation now: the days before today stay a vacation, today is the first
 * day back. Returns null when there is no vacation that has begun.
 */
export function endVacationEarly(
  settings: Partial<VacationHistorySettings>,
  today: DayKey,
): Pick<Settings, 'vacation' | 'vacation_history'> | null {
  const cur = settings.vacation;
  if (!cur || !isValidRange(cur) || cur.end < today) return null;
  if (cur.start > today) return withVacation(settings, null, today);
  const end = addDays(today, -1);
  if (end < cur.start) return withVacation(settings, null, today);
  return { vacation: { start: cur.start, end }, vacation_history: settings.vacation_history ?? null };
}
