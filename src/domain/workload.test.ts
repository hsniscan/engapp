import { default_w } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { createScheduler } from './fsrs';
import { changePct, expectedDailyReviews, intervalDays, NEW_CARD_REVIEWS } from './workload';

const W = [...default_w];

describe('intervalDays', () => {
  it('matches the scheduler: at 90 % the interval equals the stability', () => {
    expect(intervalDays(W, 10, 0.9)).toBe(10);
    expect(intervalDays(W, 0.2, 0.9)).toBe(1);
    expect(intervalDays(W, 1e6, 0.9)).toBe(36500);
  });

  it('agrees with ts-fsrs next_interval (no fuzz) at other targets', () => {
    for (const r of [0.85, 0.95]) {
      const engine = createScheduler({ request_retention: r, fsrs_params: null }).engine;
      for (const s of [3, 12.5, 40, 300]) {
        const expected = Math.min(Math.max(1, Math.round(s * (Reflect.get(engine, 'intervalModifier') as number))), 36500);
        expect(intervalDays(W, s, r)).toBe(expected);
      }
    }
  });
});

describe('expectedDailyReviews', () => {
  it('a higher target means more reviews; new cards add their learning steps', () => {
    const s = Array.from({ length: 200 }, (_, i) => 1 + i);
    const at = (r: number) => expectedDailyReviews(s, W, r, 0);
    expect(at(0.85)).toBeLessThan(at(0.9));
    expect(at(0.9)).toBeLessThan(at(0.95));
    expect(expectedDailyReviews(s, W, 0.9, 10) - at(0.9)).toBeCloseTo(10 * NEW_CARD_REVIEWS);
    expect(expectedDailyReviews([0, 0], W, 0.9, 0)).toBe(0);
  });

  it('changePct', () => {
    expect(changePct(100, 90)).toBe(-10);
    expect(changePct(0, 5)).toBe(0);
  });
});
