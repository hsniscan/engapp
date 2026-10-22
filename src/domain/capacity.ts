// Daily capacity (v0.3 İP3, docs/decisions/0021-load-management.md): the user says how many
// minutes a day they want to study at most; the app turns that into cards with the user's
// own pace, the median answer time over the last 30 days of reviews.
import type { Millis, ReviewLog, Settings } from './types';

export const DEFAULT_CAPACITY_MIN = 20;
export const CAPACITY_MIN_LIMITS = { min: 5, max: 180 } as const;
/** Pace before there is enough history. */
export const FALLBACK_SEC_PER_CARD = 10;
/** Fewer answers than this in the window: use the fallback pace. */
export const MIN_PACE_SAMPLES = 20;
export const PACE_WINDOW_DAYS = 30;
/** Bounds for the measured pace, so one odd day cannot make the capacity absurd. */
const SEC_PER_CARD_BOUNDS = { min: 3, max: 60 } as const;
const DAY_MS = 86_400_000;

type PaceLog = Pick<ReviewLog, 'id' | 'reviewed_at' | 'duration_ms' | 'undo_of'>;

/** The capacity setting in minutes (default 20, clamped to 5–180). */
export function capacityMinutes(settings: Pick<Settings, 'daily_capacity_min'>): number {
  const v = settings.daily_capacity_min;
  if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_CAPACITY_MIN;
  return Math.min(CAPACITY_MIN_LIMITS.max, Math.max(CAPACITY_MIN_LIMITS.min, Math.round(v)));
}

/**
 * Seconds per answer: the median `duration_ms` of the answers in the last 30 days before
 * `now` (undo rows and the answers they cancel left out). `now` defaults to the newest log.
 */
export function secondsPerCard(logs: Iterable<PaceLog>, now?: Millis): number {
  const list = [...logs];
  const cancelled = new Set<string>();
  for (const l of list) if (l.undo_of !== null) cancelled.add(l.undo_of);
  let ref = now;
  if (ref === undefined) {
    ref = -Infinity;
    for (const l of list) if (l.reviewed_at > ref) ref = l.reviewed_at;
  }
  const from = ref - PACE_WINDOW_DAYS * DAY_MS;
  const durations: number[] = [];
  for (const l of list) {
    if (l.undo_of !== null || cancelled.has(l.id)) continue;
    if (l.reviewed_at < from || l.reviewed_at > ref) continue;
    if (!(l.duration_ms > 0)) continue;
    durations.push(l.duration_ms);
  }
  if (durations.length < MIN_PACE_SAMPLES) return FALLBACK_SEC_PER_CARD;
  durations.sort((a, b) => a - b);
  const mid = durations.length >> 1;
  const median = durations.length % 2 ? durations[mid]! : (durations[mid - 1]! + durations[mid]!) / 2;
  return Math.min(SEC_PER_CARD_BOUNDS.max, Math.max(SEC_PER_CARD_BOUNDS.min, median / 1000));
}

/** Cards a day that fit the capacity: floor(minutes · 60 / seconds per card), at least 1. */
export function capacityCards(
  settings: Pick<Settings, 'daily_capacity_min'>,
  logs: Iterable<PaceLog>,
  now?: Millis,
): number {
  return cardsForMinutes(capacityMinutes(settings), secondsPerCard(logs, now));
}

export function cardsForMinutes(minutes: number, secPerCard: number): number {
  return Math.max(1, Math.floor((minutes * 60) / secPerCard));
}

/** Minutes the given number of cards takes at this pace (rounded up). */
export function minutesForCards(cards: number, secPerCard: number): number {
  return Math.ceil((cards * secPerCard) / 60);
}
