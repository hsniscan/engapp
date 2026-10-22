import { describe, expect, it } from 'vitest';
import {
  activeGoals,
  DEFAULT_GOALS,
  goalProgress,
  percentile,
  suggestGoals,
  type WeekFacts,
} from './goals';

describe('percentile', () => {
  it('interpolates between the closest ranks', () => {
    expect(percentile([], 0.8)).toBeNull();
    expect(percentile([7], 0.8)).toBe(7);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    // 8 weeks: position 0.8 × 7 = 5.6 between the 6th and 7th smallest
    expect(percentile([0, 1, 2, 3, 4, 5, 6, 7], 0.8)).toBeCloseTo(5.6);
    expect(percentile([5, 1, 3], 1)).toBe(5);
  });
});

const week = (active_days: number, minutes: number, learned: number): WeekFacts => ({
  active_days,
  minutes,
  learned,
});

describe('suggested goals (80th percentile of the last 8 weeks, rounded)', () => {
  it('uses the last 8 weeks and rounds days to 1, minutes and words to 5', () => {
    const weeks = [
      week(7, 300, 90), // older than 8 weeks: ignored
      week(3, 40, 10),
      week(5, 70, 20),
      week(6, 95, 25),
      week(4, 60, 12),
      week(7, 120, 30),
      week(5, 80, 18),
      week(2, 20, 5),
      week(6, 100, 22),
    ];
    const s = suggestGoals(weeks);
    // active days sorted: 2 3 4 5 5 6 6 7 → 5.6 → 6
    expect(s.week_active_days).toEqual({ value: 6, basis: 'history', weeks: 8 });
    // minutes sorted: 20 40 60 70 80 95 100 120 → 95 + 0.6·5 = 98 → 100
    expect(s.week_minutes.value).toBe(100);
    // learned sorted: 5 10 12 18 20 22 25 30 → 22 + 0.6·3 = 23.8; × 30/7 = 102 → 100
    expect(s.month_new_terms.value).toBe(100);
  });

  it('leaves out the weeks before the first active one', () => {
    const s = suggestGoals([week(0, 0, 0), week(0, 0, 0), week(3, 30, 6), week(4, 41, 8)]);
    expect(s.week_active_days).toEqual({ value: 4, basis: 'history', weeks: 2 });
    expect(s.week_minutes.value).toBe(40); // 30 + 0.8·11 = 38.8 → 40
  });

  it('suggests a modest start without two weeks of history', () => {
    for (const weeks of [[], [week(0, 0, 0)], [week(0, 0, 0), week(5, 50, 9)]]) {
      const s = suggestGoals(weeks);
      expect(s.week_active_days).toMatchObject({
        value: DEFAULT_GOALS.week_active_days,
        basis: 'default',
      });
      expect(s.week_minutes.value).toBe(DEFAULT_GOALS.week_minutes);
    }
  });

  it('stays inside the limits the user can set', () => {
    const s = suggestGoals([week(1, 0, 0), week(1, 1, 0)]);
    expect(s.week_active_days.value).toBe(1);
    expect(s.week_minutes.value).toBe(5);
    expect(s.month_new_terms.value).toBe(5);
  });
});

describe('goal progress', () => {
  it('only for goals that are set, capped at a full ring', () => {
    expect(goalProgress(null, { weekActiveDays: 3, weekMinutes: 50, monthLearned: 20 })).toEqual(
      [],
    );
    expect(
      goalProgress(
        { week_active_days: 6, month_new_terms: 150, week_minutes: null },
        { weekActiveDays: 7, weekMinutes: 50, monthLearned: 30 },
      ),
    ).toEqual([
      { key: 'week_active_days', target: 6, value: 7, ratio: 1, met: true },
      { key: 'month_new_terms', target: 150, value: 30, ratio: 0.2, met: false },
    ]);
  });

  it('ignores stored values outside the limits', () => {
    expect(activeGoals({ week_active_days: 9, week_minutes: 2.5, month_new_terms: 40 })).toEqual({
      month_new_terms: 40,
    });
  });
});
