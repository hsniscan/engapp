// Continuity metrics ("Süreklilik paneli"). Everything is derived from DailyActivity
// rows, which in turn are derived from non-undone review logs (buildDailyActivity).
import { addDays, type DayConfig, type DayKey, dayEndMs, dayKeyOf, diffDays, weekdayMon0 } from './day';
import type { ReplayStep } from './recompute';
import { type Card, CardState, type DailyActivity, type Id, Rating } from './types';

export interface CardHistory {
  card: Pick<Card, 'id' | 'note_id' | 'suspended' | 'deleted_at'>;
  /** Replay steps (effective logs only), in order. */
  steps: ReplayStep[];
}

export function emptyDay(date: DayKey): DailyActivity {
  return { date, reviews: 0, new_cards: 0, time_ms: 0, review_answers: 0, review_passed: 0, completed: false };
}

/** Add one answer to a day row (mutates and returns it). */
export function addAnswerToDay(
  day: DailyActivity,
  answer: { before_state: number; rating: number; duration_ms: number },
): DailyActivity {
  day.reviews += 1;
  day.time_ms += answer.duration_ms;
  if (answer.before_state === CardState.New) day.new_cards += 1;
  if (answer.before_state === CardState.Review) {
    day.review_answers += 1;
    if (answer.rating !== Rating.Again) day.review_passed += 1;
  }
  return day;
}

/**
 * Rebuild the daily_activity cache from replayed card histories. `completed` is true for
 * an active day when, at the day's end, no studied card was left due (new cards don't
 * count; a card whose sibling was answered that day is excused; cards suspended or deleted
 * now are ignored, since their past flags are not recorded).
 */
export function buildDailyActivity(histories: Iterable<CardHistory>, cfg: DayConfig): DailyActivity[] {
  const days = new Map<DayKey, DailyActivity>();
  const reviewedCards = new Map<DayKey, Set<Id>>();
  const reviewedNotes = new Map<DayKey, Set<Id>>();
  const list = [...histories];

  for (const h of list) {
    for (const s of h.steps) {
      const key = dayKeyOf(s.log.reviewed_at, cfg);
      let d = days.get(key);
      if (!d) days.set(key, (d = emptyDay(key)));
      addAnswerToDay(d, { before_state: s.before.state, rating: s.log.rating, duration_ms: s.log.duration_ms });
      getSet(reviewedCards, key).add(h.card.id);
      getSet(reviewedNotes, key).add(h.card.note_id);
    }
  }

  const keys = [...days.keys()].sort();
  const ends = keys.map((k) => dayEndMs(k, cfg));
  const incomplete = new Set<DayKey>();

  for (const h of list) {
    if (h.card.deleted_at !== null || h.card.suspended) continue;
    const steps = h.steps;
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i]!;
      const from = Math.max(s.log.reviewed_at, s.after.due); // E_D must be > from
      const to = i + 1 < steps.length ? steps[i + 1]!.log.reviewed_at : Infinity; // E_D <= to
      for (let j = lowerBoundGreater(ends, from); j < ends.length && ends[j]! <= to; j++) {
        const key = keys[j]!;
        if (incomplete.has(key)) continue;
        const excused = reviewedNotes.get(key)?.has(h.card.note_id) && !reviewedCards.get(key)?.has(h.card.id);
        if (!excused) incomplete.add(key);
      }
    }
  }
  return keys.map((k) => ({ ...days.get(k)!, completed: !incomplete.has(k) }));
}

function getSet(m: Map<DayKey, Set<Id>>, k: DayKey): Set<Id> {
  let s = m.get(k);
  if (!s) m.set(k, (s = new Set()));
  return s;
}

/** First index whose value is strictly greater than x. */
function lowerBoundGreater(arr: number[], x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]! > x) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

export function isActive(d: DailyActivity | undefined): boolean {
  return !!d && d.reviews > 0;
}

export interface StreakSummary {
  today: DayKey;
  todayActive: boolean;
  todayCompleted: boolean;
  todayReviews: number;
  totalActiveDays: number;
  /** Today not done yet → counted from yesterday; breaks only after a whole missed day. */
  currentStreak: number;
  longestStreak: number;
  /** Active days in the last 30 days (incl. today) ÷ min(30, account age in days). */
  last30Ratio: number;
  last30ActiveDays: number;
  /** Mean time on active days of the last 30 days, ms. */
  avgDailyTimeMs: number;
  /** Non-Again share of answers on Review-state cards in the last 30 days; null without data. */
  retentionRate: number | null;
  learnedCards: number;
}

export interface StreakOptions {
  today: DayKey;
  /** Local day the account (or guest data) was created; older activity also extends it. */
  accountStartDay: DayKey | null;
  /** Cards currently in state Review. */
  learnedCards: number;
}

export function currentStreak(active: ReadonlySet<DayKey>, today: DayKey): number {
  let k = active.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (active.has(k)) {
    n++;
    k = addDays(k, -1);
  }
  return n;
}

export function longestStreak(active: ReadonlySet<DayKey>): number {
  const sorted = [...active].sort();
  let best = 0;
  let run = 0;
  let prev: DayKey | null = null;
  for (const k of sorted) {
    run = prev !== null && diffDays(prev, k) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = k;
  }
  return best;
}

export function computeStreakSummary(activity: Iterable<DailyActivity>, opts: StreakOptions): StreakSummary {
  const byDate = new Map<DayKey, DailyActivity>();
  for (const d of activity) if (d.date <= opts.today) byDate.set(d.date, d);
  const active = new Set<DayKey>();
  for (const d of byDate.values()) if (isActive(d)) active.add(d.date);

  const windowStart = addDays(opts.today, -29);
  let firstDay = opts.accountStartDay ?? opts.today;
  for (const k of active) if (k < firstDay) firstDay = k;
  const ageDays = Math.max(1, diffDays(firstDay, opts.today) + 1);
  const denominator = Math.min(30, ageDays);

  let last30Active = 0;
  let last30Time = 0;
  let answers = 0;
  let passed = 0;
  for (const d of byDate.values()) {
    if (d.date < windowStart) continue;
    answers += d.review_answers;
    passed += d.review_passed;
    if (isActive(d)) {
      last30Active++;
      last30Time += d.time_ms;
    }
  }
  const today = byDate.get(opts.today);
  return {
    today: opts.today,
    todayActive: isActive(today),
    todayCompleted: isActive(today) && !!today?.completed,
    todayReviews: today?.reviews ?? 0,
    totalActiveDays: active.size,
    currentStreak: currentStreak(active, opts.today),
    longestStreak: longestStreak(active),
    last30Ratio: last30Active / denominator,
    last30ActiveDays: last30Active,
    avgDailyTimeMs: last30Active ? Math.round(last30Time / last30Active) : 0,
    retentionRate: answers ? passed / answers : null,
    learnedCards: opts.learnedCards,
  };
}

export type HeatLevel = 0 | 1 | 2; // empty, active, completed

export interface HeatmapCell {
  date: DayKey;
  reviews: number;
  level: HeatLevel;
  future: boolean;
}

/** Calendar weeks (Monday first) ending with the current week; cells after today are `future`. */
export function buildHeatmap(activity: Iterable<DailyActivity>, today: DayKey, weeks = 26): HeatmapCell[][] {
  const byDate = new Map<DayKey, DailyActivity>();
  for (const d of activity) byDate.set(d.date, d);
  const start = addDays(today, -weekdayMon0(today) - 7 * (weeks - 1));
  const out: HeatmapCell[][] = [];
  for (let w = 0; w < weeks; w++) {
    const week: HeatmapCell[] = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(start, w * 7 + i);
      const d = byDate.get(date);
      const future = date > today;
      const level: HeatLevel = future || !isActive(d) ? 0 : d!.completed ? 2 : 1;
      week.push({ date, reviews: future ? 0 : (d?.reviews ?? 0), level, future });
    }
    out.push(week);
  }
  return out;
}
