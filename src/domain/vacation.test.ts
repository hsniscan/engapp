import { describe, expect, it } from 'vitest';
import { computeStreakSummary, currentStreak, longestStreak } from './streak';
import type { DailyActivity } from './types';
import {
  aheadDaysBeforeVacation,
  daysSinceVacation,
  endVacationEarly,
  isOnVacation,
  isVacationDay,
  isValidRange,
  withVacation,
} from './vacation';

const v = (start: string, end: string) => ({ start, end });

describe('vacation', () => {
  it('validates ranges', () => {
    expect(isValidRange(v('2026-11-01', '2026-11-05'))).toBe(true);
    expect(isValidRange(v('2026-11-05', '2026-11-01'))).toBe(false);
    expect(isValidRange(v('2026-11-01', '2027-11-01'))).toBe(false);
    expect(isValidRange({ start: 'x', end: 'y' })).toBe(false);
    expect(isValidRange(null)).toBe(false);
  });

  it('knows the days of the current vacation, both ends included', () => {
    const s = { vacation: v('2026-11-01', '2026-11-05') };
    expect(isOnVacation(s, '2026-10-31')).toBe(false);
    expect(isOnVacation(s, '2026-11-01')).toBe(true);
    expect(isOnVacation(s, '2026-11-05')).toBe(true);
    expect(isOnVacation(s, '2026-11-06')).toBe(false);
    expect(isOnVacation({ vacation: null }, '2026-11-01')).toBe(false);
    expect(isOnVacation({}, '2026-11-01')).toBe(false);
  });

  it('counts the days back', () => {
    const s = { vacation: v('2026-11-01', '2026-11-05'), vacation_history: [v('2026-08-01', '2026-08-03')] };
    expect(daysSinceVacation(s, '2026-11-03')).toBeNull();
    expect(daysSinceVacation(s, '2026-11-06')).toBe(1);
    expect(daysSinceVacation(s, '2026-11-08')).toBe(3);
    expect(daysSinceVacation(s, '2026-10-01')).toBe(59);
    expect(daysSinceVacation({}, '2026-10-01')).toBeNull();
  });

  it('offers to review ahead from 3 days before, up to 7 days', () => {
    const s = { vacation: v('2026-11-01', '2026-11-20') };
    expect(aheadDaysBeforeVacation(s, '2026-10-27')).toBe(0);
    expect(aheadDaysBeforeVacation(s, '2026-10-29')).toBe(7);
    expect(aheadDaysBeforeVacation({ vacation: v('2026-11-01', '2026-11-02') }, '2026-10-31')).toBe(2);
    expect(aheadDaysBeforeVacation(s, '2026-11-01')).toBe(0);
  });

  it('keeps the lived days of a replaced or ended vacation in the history', () => {
    const s = { vacation: v('2026-11-01', '2026-11-10'), vacation_history: null };
    expect(withVacation(s, v('2026-12-01', '2026-12-03'), '2026-10-20')).toEqual({
      vacation: v('2026-12-01', '2026-12-03'),
      vacation_history: null,
    });
    expect(withVacation(s, null, '2026-11-04')).toEqual({
      vacation: null,
      vacation_history: [v('2026-11-01', '2026-11-03')],
    });
    expect(withVacation(s, v('2026-11-01', '2026-11-12'), '2026-11-04')).toEqual({
      vacation: v('2026-11-01', '2026-11-12'),
      vacation_history: null,
    });
    expect(endVacationEarly(s, '2026-11-04')).toEqual({
      vacation: v('2026-11-01', '2026-11-03'),
      vacation_history: null,
    });
    expect(endVacationEarly(s, '2026-11-01')).toEqual({ vacation: null, vacation_history: null });
    expect(endVacationEarly(s, '2026-10-01')).toEqual({ vacation: null, vacation_history: null });
    expect(endVacationEarly(s, '2026-11-20')).toBeNull();
    const h = withVacation(
      { vacation: v('2026-11-01', '2026-11-02'), vacation_history: [v('2026-08-01', '2026-08-02')] },
      null,
      '2026-12-01',
    );
    expect(isVacationDay(h, '2026-08-02')).toBe(true);
    expect(isVacationDay(h, '2026-11-02')).toBe(true);
  });
});

describe('streak on vacation (frozen)', () => {
  const settings = { vacation: v('2026-11-03', '2026-11-07') };
  const frozen = (d: string) => isVacationDay(settings, d);
  const active = new Set(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-08', '2026-11-09']);

  it('neither breaks nor grows across inactive vacation days', () => {
    expect(currentStreak(active, '2026-11-09')).toBe(2);
    expect(currentStreak(active, '2026-11-09', frozen)).toBe(6);
    expect(currentStreak(active, '2026-11-05', frozen)).toBe(4); // during the vacation: kept
    expect(currentStreak(active, '2026-11-08', frozen)).toBe(5); // first day back, active
    expect(longestStreak(active)).toBe(4);
    expect(longestStreak(active, frozen)).toBe(6);
  });

  it('still breaks on a missed day outside the vacation', () => {
    const a = new Set(['2026-11-01', '2026-11-02', '2026-11-10']);
    expect(currentStreak(a, '2026-11-10', frozen)).toBe(1);
  });

  it('feeds computeStreakSummary', () => {
    const rows: DailyActivity[] = [...active].map((date) => ({
      date,
      reviews: 5,
      new_cards: 0,
      time_ms: 1,
      review_answers: 0,
      review_passed: 0,
      completed: true,
    }));
    const s = computeStreakSummary(rows, {
      today: '2026-11-09',
      accountStartDay: '2026-10-01',
      learnedCards: 0,
      isFrozenDay: frozen,
    });
    expect(s.currentStreak).toBe(6);
    expect(s.longestStreak).toBe(6);
  });
});
