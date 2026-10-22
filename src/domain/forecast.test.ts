import { describe, expect, it } from 'vitest';
import { applyRating, createScheduler, emptyFsrs, type Scheduler } from './fsrs';
import {
  FORECAST_DAYS,
  firstOverCapacity,
  type ForecastCard,
  forecastTotals,
  forecastWorkload,
  loadAdvice,
  newCardsPerDay,
  suggestNewLimit,
} from './forecast';
import { CardState, type FsrsFields, type RatingValue } from './types';

const DAY = 86_400_000;
const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 22, 1); // start of "today" (04:00 Istanbul)
const NOW = T0 + 8 * 3_600_000;
const bounds = Array.from({ length: FORECAST_DAYS + 1 }, (_, i) => T0 + i * DAY);

/** Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type SimCard = FsrsFields & { id: string };

/** Cards with real FSRS state from simulated histories, the last answers before NOW. */
function fixture(n: number, seed: number, scheduler: Scheduler, lateDays = 0): SimCard[] {
  const rand = rng(seed);
  const out: SimCard[] = [];
  const end = NOW - lateDays * DAY;
  for (let i = 0; i < n; i++) {
    const id = `c${i}`;
    let f = emptyFsrs(0);
    let t = end - Math.floor(rand() * 200 + 2) * DAY;
    const created = t;
    f = emptyFsrs(created);
    while (t < end) {
      const r = rand();
      const rating = (r < 0.1 ? 1 : r < 0.18 ? 2 : r < 0.95 ? 3 : 4) as RatingValue;
      f = applyRating(scheduler, { id, ...f }, rating, t);
      t = Math.max(f.due, t + MIN) + (rand() < 0.2 ? Math.floor(rand() * DAY) : 0);
    }
    out.push({ id, ...f });
  }
  return out;
}

const elapsedDays = (t: number, last: number | null) => (last === null ? 0 : Math.max(0, Math.round((t - last) / DAY)));

/**
 * Ground truth: the real scheduler (with fuzz) and a user who recalls a card with probability
 * equal to its retrievability, answering everything due each day. Mean answers per day.
 */
function groundTruth(
  scheduler: Scheduler,
  cards: SimCard[],
  opts: { runs: number; newPerDay: number; newAvailable: number; skip?: boolean[] },
): number[] {
  const totals = new Array<number>(FORECAST_DAYS).fill(0);
  const engine = scheduler.engine;
  for (let run = 0; run < opts.runs; run++) {
    const rand = rng(1000 + run);
    const deck = cards.map((c) => ({ ...c }));
    let newLeft = opts.newAvailable;
    for (let d = 0; d < FORECAST_DAYS; d++) {
      if (opts.skip?.[d]) continue;
      const t = bounds[d]! + 10 * 3_600_000;
      const end = bounds[d + 1]!;
      const opened = Math.min(newLeft, opts.newPerDay);
      newLeft -= opened;
      for (let k = 0; k < opened; k++) deck.push({ id: `n${run}-${d}-${k}`, ...emptyFsrs(t) });
      for (let i = 0; i < deck.length; i++) {
        let c = deck[i]!;
        let at = t;
        while (c.due < end) {
          at = Math.max(at, c.due);
          let rating: RatingValue = 3;
          if (c.state === CardState.Review) {
            const r = engine.forgetting_curve(elapsedDays(at, c.last_review), c.stability);
            rating = rand() < r ? 3 : 1;
          }
          c = { id: c.id, ...applyRating(scheduler, c, rating, at) };
          totals[d]! += 1;
          at += MIN;
        }
        deck[i] = c;
      }
    }
  }
  return totals.map((x) => x / opts.runs);
}

const weekly = (days: readonly number[]) => [0, 1, 2, 3].map((w) => days.slice(w * 7, w * 7 + 7).reduce((a, b) => a + b, 0));

describe('forecastWorkload', () => {
  const scheduler = createScheduler({ request_retention: 0.9, fsrs_params: null });

  it('stays within ±15% of the simulated ground truth for every week', () => {
    const cards = fixture(800, 7, scheduler);
    const f = forecastWorkload(scheduler, { cards, bounds, newAvailable: 300 });
    const predicted = forecastTotals(f, 10);
    const truth = groundTruth(scheduler, cards, { runs: 12, newPerDay: 10, newAvailable: 300 });
    const pw = weekly(predicted);
    const tw = weekly(truth);
    for (let w = 0; w < 4; w++) {
      expect(Math.abs(pw[w]! - tw[w]!) / tw[w]!, `week ${w}: forecast ${pw[w]} vs truth ${tw[w]}`).toBeLessThan(0.15);
    }
  }, 60_000);

  it('also matches after a 5-day gap (backlog on day 0) and with a vacation', () => {
    const cards = fixture(600, 11, scheduler, 5);
    const skip = Array.from({ length: FORECAST_DAYS }, (_, d) => d >= 10 && d <= 15);
    const factor = skip.map((s) => (s ? 0 : 1));
    const f = forecastWorkload(scheduler, { cards, bounds, newAvailable: 200, skipDays: skip, newFactor: factor });
    const predicted = forecastTotals(f, 5);
    expect(predicted.slice(10, 16).every((x) => x === 0)).toBe(true);
    const truth = groundTruth(scheduler, cards, { runs: 10, newPerDay: 5, newAvailable: 200, skip });
    // Truth opens new cards only on days it studies; the forecast's factor says the same.
    const pw = weekly(predicted);
    const tw = weekly(truth);
    for (let w = 0; w < 4; w++) {
      expect(Math.abs(pw[w]! - tw[w]!) / tw[w]!, `week ${w}: forecast ${pw[w]} vs truth ${tw[w]}`).toBeLessThan(0.15);
    }
  }, 60_000);

  it('is deterministic and runs in under 150 ms for 5 000 cards', () => {
    const cards: ForecastCard[] = fixture(5000, 3, scheduler);
    forecastWorkload(scheduler, { cards: cards.slice(0, 200), bounds, newAvailable: 100 }); // warm-up
    const t = performance.now();
    const a = forecastWorkload(scheduler, { cards, bounds, newAvailable: 500 });
    const ms = performance.now() - t;
    expect(ms).toBeLessThan(150);
    const b = forecastWorkload(scheduler, { cards, bounds, newAvailable: 500 });
    expect(forecastTotals(a, 10)).toEqual(forecastTotals(b, 10));
  }, 60_000);

  it('opens new cards up to the cards waiting and today’s remaining allowance', () => {
    const f = forecastWorkload(scheduler, { cards: [], bounds, newAvailable: 25, newToday: 3 });
    expect(newCardsPerDay(f, 10).slice(0, 5)).toEqual([3, 10, 10, 2, 0]);
    const totals = forecastTotals(f, 10);
    // Each new card is answered through its learning steps on its first day.
    expect(totals[0]).toBeGreaterThanOrEqual(3 * 2);
  });
});

describe('suggestNewLimit', () => {
  const scheduler = createScheduler({ request_retention: 0.9, fsrs_params: null });
  const cards = fixture(400, 5, scheduler);
  const f = forecastWorkload(scheduler, { cards, bounds, newAvailable: 2000 });

  it('suggests the largest lower limit that brings days 1–14 under capacity', () => {
    const at20 = forecastTotals(f, 20);
    const peak = Math.max(...at20.slice(1, 15));
    const capacity = Math.floor(peak) - 5;
    const advice = loadAdvice(f, capacity, 20);
    if (advice.overDay === null) {
      // Over capacity only after day 7: no warning on the home screen.
      expect(firstOverCapacity(at20, capacity, 1, 7)).toBeNull();
    }
    const n = suggestNewLimit(f, capacity, 20);
    expect(n).not.toBeNull();
    expect(n!).toBeLessThan(20);
    expect(firstOverCapacity(forecastTotals(f, n!), capacity, 1, 14)).toBeNull();
    if (n! + 1 < 20) expect(firstOverCapacity(forecastTotals(f, n! + 1), capacity, 1, 14)).not.toBeNull();
  });

  it('gives no suggestion when the current limit fits or when even 0 does not', () => {
    expect(suggestNewLimit(f, 10_000, 20)).toBeNull();
    expect(loadAdvice(f, 10_000, 20)).toEqual({ overDay: null, suggestedLimit: null });
    expect(suggestNewLimit(f, 1, 20)).toBeNull();
  });
});
