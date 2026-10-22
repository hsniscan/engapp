// A small estimate of the daily review load (v0.3 İP4 retention helper). Steady-state
// snapshot: every studied card comes back once per interval, the interval being what the
// scheduler gives its current stability at the target retention, plus one relearning step for
// the share that is forgotten, plus the learning steps of the day's new cards. It ignores that
// stability grows over time, so it is an upper-side rough figure for comparing retention
// levels and parameter sets, not a forecast (İP3's domain/forecast.ts is the real forecast).

export const RETENTION_CHOICES = [0.85, 0.9, 0.95] as const;
/** First sight + the 1 m and 10 m learning steps (FSRS_CONFIG.learning_steps). */
export const NEW_CARD_REVIEWS = 3;
/** One relearning step (FSRS_CONFIG.relearning_steps) after a forgotten review. */
const RELEARN_REVIEWS = 1;
const MAX_INTERVAL = 36500;

/** Interval in days the scheduler gives stability `s` at retention `r` (before fuzz). */
export function intervalDays(w: readonly number[], s: number, r: number): number {
  const decay = -w[20]!;
  const factor = Math.pow(0.9, 1 / decay) - 1;
  const ivl = (s / factor) * (Math.pow(r, 1 / decay) - 1);
  return Math.min(Math.max(1, Math.round(ivl)), MAX_INTERVAL);
}

/** Expected reviews per day for cards with these stabilities (0 = never studied, skipped). */
export function expectedDailyReviews(
  stabilities: Iterable<number>,
  w: readonly number[],
  retention: number,
  newPerDay: number,
): number {
  let sum = 0;
  for (const s of stabilities) {
    if (!(s > 0)) continue;
    sum += (1 + (1 - retention) * RELEARN_REVIEWS) / intervalDays(w, s, retention);
  }
  return sum + Math.max(0, newPerDay) * NEW_CARD_REVIEWS;
}

/** Relative change from `before` to `after`, in percent (0 when before is 0). */
export function changePct(before: number, after: number): number {
  return before > 0 ? ((after - before) / before) * 100 : 0;
}
