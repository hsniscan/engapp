// 30-day workload forecast (v0.3 İP3, docs/decisions/0021-load-management.md).
//
// Expected answers per day, by an expected-value walk over each card's future: at every due
// review the card is recalled ("Good") with probability R = its retrievability on that day,
// or forgotten ("Again", one relearning step the same day) otherwise. Both branches are
// followed with their probability until a branch is too unlikely or too deep; then only the
// recall path goes on, carrying the whole weight. New cards add their learning steps on the
// day they are opened and their reviews afterwards, from a profile of one new card.
//
// It uses the same FSRS model as the scheduler (ts-fsrs, via domain/fsrs.ts) without fuzz,
// is deterministic, and never changes a card. ~10–40 ms for 5 000 cards.
import { applyRating, emptyFsrs, type Scheduler } from './fsrs';
import { CardState, type CardStateValue, type FsrsFields, type Millis, Rating } from './types';

export const FORECAST_DAYS = 30;
/** The warning looks at days 1–7 (tomorrow on); the suggestion must fit days 1–14. */
export const WARNING_DAYS = 7;
export const SUGGESTION_DAYS = 14;

const DAY_MS = 86_400_000;
const MIN_BRANCH_P = 0.02;
const MAX_DEPTH = 8;
const S_MIN = 0.001;
const GOOD = 3 as const;
const AGAIN = 1 as const;

export interface ForecastCard {
  state: CardStateValue;
  due: Millis;
  stability: number;
  difficulty: number;
  last_review: Millis | null;
}

export interface ForecastInput {
  /** Studiable cards that were studied (Learning, Review, Relearning); New cards are ignored. */
  cards: Iterable<ForecastCard>;
  /** bounds[i] = first instant of day i (0 = today); length = days + 1. */
  bounds: readonly Millis[];
  /** New cards waiting to be opened. */
  newAvailable: number;
  /** New cards still allowed today (day 0). Default: the daily limit. */
  newToday?: number;
  /** Days without reviews (vacation): what falls due then is answered on the next other day. */
  skipDays?: readonly boolean[];
  /** Share of the daily new-card limit per day (vacation 0, ramp ½). Default 1. */
  newFactor?: readonly number[];
}

export interface WorkloadForecast {
  days: number;
  /** Expected answers per day from the cards that exist now (reviews and relearning steps). */
  base: number[];
  /** Of those, answers to cards in state Review. */
  baseReviews: number[];
  /** profile[j][k]: expected answers on day k from one new card opened on day j. */
  newProfile: number[][];
  newAvailable: number;
  newToday: number | null;
  newFactor: number[];
}

/** Day index of an instant: 0 for anything before the end of today, `days` past the horizon. */
function dayIndexOf(bounds: readonly Millis[], t: Millis): number {
  const days = bounds.length - 1;
  if (t < bounds[1]!) return 0;
  if (t >= bounds[days]!) return days;
  let lo = 1;
  let hi = days;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (bounds[mid]! <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

interface Sim {
  scheduler: Scheduler;
  days: number;
  ivlFactor: number;
  maxIvl: number;
  /** next day (≥ d) on which reviews are done; `days` when none is left. */
  nextOpen: Int32Array;
}

function makeSim(scheduler: Scheduler, days: number, skip?: readonly boolean[]): Sim {
  const nextOpen = new Int32Array(days + 1);
  nextOpen[days] = days;
  for (let d = days - 1; d >= 0; d--) nextOpen[d] = skip?.[d] ? nextOpen[d + 1]! : d;
  const engine = scheduler.engine;
  return {
    scheduler,
    days,
    ivlFactor: engine.interval_modifier,
    maxIvl: engine.parameters.maximum_interval,
    nextOpen,
  };
}

function interval(sim: Sim, s: number): number {
  return Math.min(sim.maxIvl, Math.max(1, Math.round(s * sim.ivlFactor)));
}

interface Mem {
  difficulty: number;
  stability: number;
}

function valid(m: Mem): Mem {
  return {
    difficulty: Math.min(10, Math.max(1, m.difficulty || 5)),
    stability: Math.max(S_MIN, m.stability || S_MIN),
  };
}

/**
 * Walk one Review-state card from its due day. `lastDay` is the last review in days from the
 * start of day 0 (fractional; negative in the past). Adds expected answers to `out`.
 */
function walk(
  sim: Sim,
  mem0: Mem,
  lastDay0: number,
  dueDay0: number,
  p0: number,
  out: number[],
  reviews: number[] | null,
): void {
  const engine = sim.scheduler.engine;
  const stack: { mem: Mem; last: number; due: number; p: number; depth: number }[] = [
    { mem: valid(mem0), last: lastDay0, due: dueDay0, p: p0, depth: 0 },
  ];
  while (stack.length) {
    const n = stack.pop()!;
    const day = sim.nextOpen[Math.min(sim.days, Math.max(0, n.due))]!;
    if (day >= sim.days) continue;
    const at = day + 0.5;
    const elapsed = Math.max(0, Math.round(at - n.last));
    const r = engine.forgetting_curve(elapsed, n.mem.stability);
    out[day]! += n.p;
    if (reviews) reviews[day]! += n.p;
    const good = valid(engine.next_state(n.mem, elapsed, GOOD, r));
    const pFail = n.p * (1 - r);
    // The relearning step after "Again" is one more answer the same day.
    out[day]! += pFail;
    const split = pFail >= MIN_BRANCH_P && n.depth < MAX_DEPTH;
    stack.push({
      mem: good,
      last: at,
      due: day + interval(sim, good.stability),
      p: split ? n.p - pFail : n.p,
      depth: n.depth + 1,
    });
    if (split) {
      const lapsed = valid(engine.next_state(n.mem, elapsed, AGAIN, r));
      const relearned = valid(engine.next_state(lapsed, 0, GOOD));
      stack.push({
        mem: relearned,
        last: at,
        due: day + interval(sim, relearned.stability),
        p: pFail,
        depth: n.depth + 1,
      });
    }
  }
}

/** One new card answered "Good" through its learning steps: answers on day 0, then its state. */
function newCardPath(scheduler: Scheduler): { answers: number; fsrs: FsrsFields } {
  const t0 = 0;
  let f = emptyFsrs(t0);
  let t = t0;
  let answers = 0;
  while (answers < 10) {
    f = applyRating(scheduler, { id: 'forecast-new', ...f }, Rating.Good, t);
    answers++;
    if (f.state === CardState.Review) break;
    t = Math.max(f.due, t + 60_000);
  }
  return { answers, fsrs: f };
}

/** Expected answers per day for the existing cards and for new cards. Pure, deterministic. */
export function forecastWorkload(scheduler: Scheduler, input: ForecastInput): WorkloadForecast {
  const { bounds } = input;
  const days = bounds.length - 1;
  const sim = makeSim(scheduler, days, input.skipDays);
  const base = new Array<number>(days).fill(0);
  const baseReviews = new Array<number>(days).fill(0);
  const start = bounds[0]!;
  const engine = scheduler.engine;

  for (const c of input.cards) {
    const dueDay = dayIndexOf(bounds, c.due);
    if (c.state === CardState.Review) {
      const last = c.last_review === null ? dueDay - 1 : (c.last_review - start) / DAY_MS;
      walk(sim, c, last, dueDay, 1, base, baseReviews);
    } else if (c.state === CardState.Learning || c.state === CardState.Relearning) {
      // One more step (answered "Good"), then the card is in review.
      const day = sim.nextOpen[dueDay]!;
      if (day >= days) continue;
      base[day]! += 1;
      const mem =
        c.stability > 0 ? valid(engine.next_state(valid(c), 0, GOOD)) : valid({ difficulty: engine.init_difficulty(GOOD), stability: engine.init_stability(GOOD) });
      walk(sim, mem, day + 0.5, day + interval(sim, mem.stability), 1, base, null);
    }
  }

  const path = newCardPath(scheduler);
  const newProfile: number[][] = [];
  for (let j = 0; j < days; j++) {
    const row = new Array<number>(days).fill(0);
    row[j] = path.answers;
    walk(sim, path.fsrs, j + 0.5, j + Math.max(1, path.fsrs.scheduled_days), 1, row, null);
    newProfile.push(row);
  }

  const newFactor = Array.from({ length: days }, (_, d) => {
    const v = input.newFactor?.[d];
    const f = typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
    return input.skipDays?.[d] ? 0 : f;
  });
  return {
    days,
    base,
    baseReviews,
    newProfile,
    newAvailable: Math.max(0, input.newAvailable),
    newToday: input.newToday ?? null,
    newFactor,
  };
}

/** New cards opened per day with this daily limit (limited by the cards waiting). */
export function newCardsPerDay(f: WorkloadForecast, dailyNewLimit: number): number[] {
  let left = f.newAvailable;
  const out: number[] = [];
  for (let d = 0; d < f.days; d++) {
    const limit = d === 0 && f.newToday !== null ? Math.min(f.newToday, dailyNewLimit) : dailyNewLimit;
    const n = Math.min(left, Math.ceil(Math.max(0, limit) * f.newFactor[d]!));
    out.push(n);
    left -= n;
  }
  return out;
}

/** Expected answers per day (existing cards + new cards at this daily limit). */
export function forecastTotals(f: WorkloadForecast, dailyNewLimit: number): number[] {
  const totals = [...f.base];
  const opened = newCardsPerDay(f, dailyNewLimit);
  for (let j = 0; j < f.days; j++) {
    const n = opened[j]!;
    if (n === 0) continue;
    const row = f.newProfile[j]!;
    for (let k = j; k < f.days; k++) totals[k]! += n * row[k]!;
  }
  return totals;
}

/** First day in [from, to] whose expected answers exceed the capacity, or null. */
export function firstOverCapacity(
  totals: readonly number[],
  capacity: number,
  from = 1,
  to = WARNING_DAYS,
): number | null {
  for (let d = from; d <= Math.min(to, totals.length - 1); d++) {
    if (totals[d]! > capacity) return d;
  }
  return null;
}

/**
 * Largest daily new-card limit below `current` whose forecast stays within the capacity on
 * days 1–14. null when even 0 does not fit (the reviews alone exceed it) or when the current
 * limit already fits.
 */
export function suggestNewLimit(f: WorkloadForecast, capacity: number, current: number): number | null {
  if (firstOverCapacity(forecastTotals(f, current), capacity, 1, SUGGESTION_DAYS) === null) return null;
  for (let n = current - 1; n >= 0; n--) {
    if (firstOverCapacity(forecastTotals(f, n), capacity, 1, SUGGESTION_DAYS) === null) return n;
  }
  return null;
}

export interface LoadAdvice {
  /** First day (1–7) over capacity with the current limit; null = no warning. */
  overDay: number | null;
  /** Suggested daily new-card limit (only with a warning); null = none fits. */
  suggestedLimit: number | null;
}

export function loadAdvice(f: WorkloadForecast, capacity: number, currentLimit: number): LoadAdvice {
  const overDay = firstOverCapacity(forecastTotals(f, currentLimit), capacity);
  if (overDay === null) return { overDay: null, suggestedLimit: null };
  return { overDay, suggestedLimit: suggestNewLimit(f, capacity, currentLimit) };
}
