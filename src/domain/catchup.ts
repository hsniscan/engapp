// Catch-up mode and the new-card ramp (v0.3 İP3, docs/decisions/0021-load-management.md).
//
// Catch-up never touches FSRS: it only limits and orders today's queue. When the reviews due
// at the start of the day exceed the daily capacity, today's queue holds at most `capacity`
// reviews (minus the ones already answered today), the most overdue relative to their
// interval first, and no new cards. New cards come back gradually: 0 on a catch-up day and on
// the first day back from a vacation, half the daily limit on the next day, then the full limit.
//
// Everything here is a pure function of today's facts; nothing is stored, so every device that
// has the same cards and logs builds the same queue.
import type { Millis } from './types';

const DAY_MS = 86_400_000;

/** Share of the daily new-card limit allowed today. */
export type NewCardFactor = 0 | 0.5 | 1;

export type LoadMode =
  /** Nothing special today. */
  | 'normal'
  /** Backlog above capacity: capped reviews, no new cards. */
  | 'catchup'
  /** On vacation: no new cards. */
  | 'vacation'
  /** First days after a vacation or a catch-up: new cards ramp up. */
  | 'ramp';

export interface LoadFacts {
  /** Cards a day that fit the capacity (domain/capacity.ts). */
  capacity: number;
  /** settings.catchup_auto (absent = on). */
  catchupAuto: boolean;
  /** Reviews due at the start of today (Review-state cards due before today's end). */
  backlogToday: number;
  /** The same count for yesterday (null when unknown). */
  backlogYesterday: number | null;
  /** Answers given today to cards that were in state Review. */
  reviewsDoneToday: number;
  onVacationToday: boolean;
  /** Days since the latest vacation ended (1 = today is the first day back), or null. */
  daysSinceVacation: number | null;
}

export interface LoadPlan {
  mode: LoadMode;
  /** Most reviews still allowed in today's queue; null = no cap. */
  reviewCap: number | null;
  newFactor: NewCardFactor;
}

/** Days after a vacation during which catch-up switches itself on even when turned off. */
export const RETURN_DAYS = 3;

export function isCatchupDay(backlog: number, capacity: number): boolean {
  return backlog > capacity;
}

/** Today's limits. Pure. */
export function planLoad(f: LoadFacts): LoadPlan {
  if (f.onVacationToday) return { mode: 'vacation', reviewCap: null, newFactor: 0 };
  const returning = f.daysSinceVacation !== null && f.daysSinceVacation <= RETURN_DAYS;
  const catchupOn = f.catchupAuto || returning;
  if (catchupOn && isCatchupDay(f.backlogToday, f.capacity)) {
    return { mode: 'catchup', reviewCap: Math.max(0, f.capacity - f.reviewsDoneToday), newFactor: 0 };
  }
  // Ramp: 0 on the first day back from a vacation, ½ on the day after a paused day.
  if (f.daysSinceVacation === 1) return { mode: 'ramp', reviewCap: null, newFactor: 0 };
  if (f.daysSinceVacation === 2) return { mode: 'ramp', reviewCap: null, newFactor: 0.5 };
  if (catchupOn && f.backlogYesterday !== null && isCatchupDay(f.backlogYesterday, f.capacity)) {
    return { mode: 'ramp', reviewCap: null, newFactor: 0.5 };
  }
  return { mode: 'normal', reviewCap: null, newFactor: 1 };
}

/** The daily new-card limit after the ramp: 0, half (rounded up) or all. */
export function rampedNewLimit(limit: number, factor: NewCardFactor): number {
  if (factor === 0) return 0;
  if (factor === 1) return limit;
  return Math.ceil(limit * factor);
}

/**
 * How overdue a review is relative to its interval: (now − due) / max(scheduled_days, 1),
 * in days per day of interval. A card 10 days late on a 5-day interval (2) comes before one
 * 10 days late on a 100-day interval (0.1): it is the one most likely forgotten.
 */
export function relativeOverdueness(card: { due: Millis; scheduled_days?: number }, now: Millis): number {
  return (now - card.due) / DAY_MS / Math.max(1, card.scheduled_days ?? 1);
}

/**
 * Days until the backlog is cleared at `capacity` reviews a day (today = day 1), given the
 * reviews that fall due on each following day (`arrivals[0]` = tomorrow). null: not within
 * the horizon (arrivals.length + 1 days).
 */
export function estimateCatchupDays(
  backlogToday: number,
  capacity: number,
  arrivals: readonly number[],
): number | null {
  if (capacity <= 0) return null;
  let left = backlogToday;
  for (let day = 0; day <= arrivals.length; day++) {
    if (day > 0) left += arrivals[day - 1]!;
    left -= capacity;
    if (left <= 0) return day + 1;
  }
  return null;
}
