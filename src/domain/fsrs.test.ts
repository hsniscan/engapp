import { describe, expect, it } from 'vitest';
import {
  applyRating,
  createScheduler,
  emptyFsrs,
  formatInterval,
  fromTsCard,
  fsrsEqual,
  previewIntervals,
  toTsCard,
} from './fsrs';
import { CardState, Rating } from './types';

const T = Date.UTC(2026, 9, 21, 10);
const sched = createScheduler({ request_retention: 0.9, fsrs_params: null });

describe('fsrs wrapper', () => {
  it('validates settings', () => {
    expect(() => createScheduler({ request_retention: 0.5, fsrs_params: null })).toThrow();
    expect(() => createScheduler({ request_retention: 0.9, fsrs_params: [1, 2, 3] })).toThrow();
    expect(() => createScheduler({ request_retention: 0.9, fsrs_params: Array(21).fill(Number.NaN) })).toThrow();
  });

  it('converts between our fields and ts-fsrs cards losslessly', () => {
    const f = { ...emptyFsrs(T), last_review: T - 1000, state: CardState.Review, stability: 3.3, reps: 4 };
    const { ramp_step: _r, learned_at: _l, ...engineFields } = f;
    expect(fromTsCard(toTsCard('c1', f))).toEqual(engineFields);
    const { ramp_step: _r2, learned_at: _l2, ...empty } = emptyFsrs(T);
    expect(fromTsCard(toTsCard('c1', emptyFsrs(T)))).toEqual(empty);
  });

  it('uses learning steps 1m / 10m for a new card', () => {
    const card = { id: 'c1', ...emptyFsrs(T) };
    const p = previewIntervals(sched, card, T);
    expect(p[Rating.Again].label).toBe('1 dk');
    expect(p[Rating.Good].label).toBe('10 dk');
    expect(p[Rating.Easy].interval_ms).toBeGreaterThanOrEqual(86_400_000);
    expect(p[Rating.Good].state).toBe(CardState.Learning);
  });

  it('graduates after the second Good and relearns with 10m', () => {
    let f = applyRating(sched, { id: 'c1', ...emptyFsrs(T) }, Rating.Good, T);
    f = applyRating(sched, { id: 'c1', ...f }, Rating.Good, T + 10 * 60_000);
    expect(f.state).toBe(CardState.Review);
    const at = f.due;
    const lapse = applyRating(sched, { id: 'c1', ...f }, Rating.Again, at);
    expect(lapse.state).toBe(CardState.Relearning);
    expect(lapse.due - at).toBe(10 * 60_000);
  });

  it('fuzz is deterministic per card and review time, and differs between cards', () => {
    const grow = (id: string): number[] => {
      let f = emptyFsrs(T);
      let t = T;
      const out: number[] = [];
      for (let i = 0; i < 8; i++) {
        f = applyRating(sched, { id, ...f }, Rating.Good, t);
        out.push(f.due);
        t = f.due;
      }
      return out;
    };
    expect(grow('card-a')).toEqual(grow('card-a'));
    const many = new Set(Array.from({ length: 20 }, (_, i) => grow(`card-${i}`).at(-1)));
    expect(many.size).toBeGreaterThan(1);
  });

  it('fsrsEqual compares every field', () => {
    const a = emptyFsrs(T);
    expect(fsrsEqual(a, { ...a })).toBe(true);
    expect(fsrsEqual(a, { ...a, lapses: 1 })).toBe(false);
  });

  it.each([
    [30_000, '1 dk'],
    [60_000, '1 dk'],
    [10 * 60_000, '10 dk'],
    [5 * 3_600_000, '5 sa'],
    [3 * 86_400_000, '3 g'],
    [60 * 86_400_000, '2 ay'],
    [45 * 86_400_000, '1,5 ay'],
    [365 * 86_400_000, '1 yıl'],
    [548 * 86_400_000, '1,5 yıl'],
  ])('formatInterval(%d) = %s', (ms, label) => {
    expect(formatInterval(ms)).toBe(label);
  });
});
