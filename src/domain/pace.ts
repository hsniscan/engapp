// Answer pace (v0.5.3 B6, docs/decisions/0071): a right answer that took very long for this
// user and this format suggests Zor instead of İyi (an honest rating gives a truer interval).
// Pure: the data layer passes in recent answers (data/pace.ts).
//
// The threshold is SLOW_FACTOR × the user's median time of recent passing answers (Good or
// Easy) of that card type, never under SLOW_FLOOR_MS. With fewer than MIN_SAMPLES answers of a
// type, a default median stands in. Stored durations run from showing the card to the rating
// button; the session compares the time to the check (or the flip), which is shorter, so the
// rule errs towards "not slow".
import type { CardType, RatingValue } from './types';

export const SLOW_FACTOR = 2;
export const SLOW_FLOOR_MS = 8_000;
/** Durations are capped at 60 s; a threshold at or above the cap would never fire. */
export const SLOW_CEIL_MS = 45_000;
export const MIN_SAMPLES = 20;

/** Median answer time (ms) per type when the user has too few answers of it. */
export const DEFAULT_MEDIAN_MS: Record<CardType, number> = {
  recognition: 5_000,
  cloze: 7_000,
  image: 7_000,
  production: 9_000,
  dictation: 11_000,
};

export interface PaceSample {
  card_type: CardType;
  rating: RatingValue;
  duration_ms: number;
}

export type SlowThresholds = Record<CardType, number>;

export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Per card type: the answer time (ms) above which a right answer counts as slow. */
export function slowThresholds(samples: Iterable<PaceSample>): SlowThresholds {
  const by: Record<CardType, number[]> = { recognition: [], cloze: [], image: [], production: [], dictation: [] };
  for (const s of samples) {
    if (s.rating < 3 || !(s.duration_ms > 0) || s.duration_ms >= 60_000) continue;
    by[s.card_type]?.push(s.duration_ms);
  }
  const out = {} as SlowThresholds;
  for (const t of Object.keys(by) as CardType[]) {
    const m = by[t].length >= MIN_SAMPLES ? median(by[t])! : DEFAULT_MEDIAN_MS[t];
    out[t] = Math.min(SLOW_CEIL_MS, Math.max(SLOW_FLOOR_MS, Math.round(SLOW_FACTOR * m)));
  }
  return out;
}

/** The answer (time to the check or the flip) was slow for this card type. */
export function isSlowAnswer(elapsedMs: number | null | undefined, type: CardType, t: SlowThresholds | null | undefined): boolean {
  if (elapsedMs == null || !t) return false;
  return elapsedMs > t[type];
}
