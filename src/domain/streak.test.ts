import { describe, expect, it } from 'vitest';
import { makeLog } from '../test/factories';
import { addDays } from './day';
import { createScheduler } from './fsrs';
import { replayCard } from './recompute';
import { buildDailyActivity, buildHeatmap, type CardHistory, computeStreakSummary, currentStreak, emptyDay, longestStreak } from './streak';
import type { DailyActivity, RatingValue } from './types';

const day = (date: string, p: Partial<DailyActivity> = {}): DailyActivity => ({
  ...emptyDay(date),
  reviews: 10,
  time_ms: 60_000,
  completed: true,
  ...p,
});

describe('streaks from fixed date lists', () => {
  it('current streak counts from yesterday while today is not done', () => {
    const active = new Set(['2026-10-18', '2026-10-19', '2026-10-20']);
    expect(currentStreak(active, '2026-10-21')).toBe(3);
    expect(currentStreak(new Set([...active, '2026-10-21']), '2026-10-21')).toBe(4);
    // A whole missed day breaks it.
    expect(currentStreak(active, '2026-10-22')).toBe(0);
  });

  it('streak runs across the year boundary and DST changes', () => {
    const active = new Set(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
    expect(currentStreak(active, '2027-01-02')).toBe(4);
    const dst = new Set(['2026-10-24', '2026-10-25', '2026-10-26']); // Europe DST ends 10-25
    expect(currentStreak(dst, '2026-10-26')).toBe(3);
    expect(longestStreak(new Set([...active, ...dst]))).toBe(4);
  });

  it('longest streak over gaps', () => {
    expect(longestStreak(new Set(['2026-01-01', '2026-01-02', '2026-01-04', '2026-01-05', '2026-01-06']))).toBe(3);
    expect(longestStreak(new Set())).toBe(0);
  });

  it('summary metrics', () => {
    const rows = [
      day('2026-09-01', { review_answers: 100, review_passed: 0 }), // outside 30-day window
      day('2026-10-19', { time_ms: 120_000, review_answers: 10, review_passed: 9 }),
      day('2026-10-20', { time_ms: 60_000, review_answers: 10, review_passed: 7, completed: false }),
      day('2026-10-21', { reviews: 0, time_ms: 0 }), // row without answers is not active
    ];
    const s = computeStreakSummary(rows, { today: '2026-10-21', accountStartDay: '2026-08-01', learnedCards: 42 });
    expect(s.totalActiveDays).toBe(3);
    expect(s.currentStreak).toBe(2);
    expect(s.longestStreak).toBe(2);
    expect(s.todayActive).toBe(false);
    expect(s.last30ActiveDays).toBe(2);
    expect(s.last30Ratio).toBeCloseTo(2 / 30);
    expect(s.avgDailyTimeMs).toBe(90_000);
    expect(s.retentionRate).toBeCloseTo(16 / 20);
    expect(s.learnedCards).toBe(42);
  });

  it('last-30 ratio divides by account age when the account is younger', () => {
    const rows = [day('2026-10-19'), day('2026-10-21')];
    const s = computeStreakSummary(rows, { today: '2026-10-21', accountStartDay: '2026-10-17', learnedCards: 0 });
    expect(s.last30Ratio).toBeCloseTo(2 / 5);
    const fresh = computeStreakSummary([], { today: '2026-10-21', accountStartDay: '2026-10-21', learnedCards: 0 });
    expect(fresh.last30Ratio).toBe(0);
    expect(fresh.retentionRate).toBeNull();
  });

  it('heatmap: 26 Monday-first weeks ending in the current week', () => {
    const rows = [day('2026-10-20'), day('2026-10-21', { completed: false })];
    const weeks = buildHeatmap(rows, '2026-10-21');
    expect(weeks).toHaveLength(26);
    const last = weeks[25]!;
    expect(last[0]!.date).toBe('2026-10-19');
    expect(last[1]).toMatchObject({ date: '2026-10-20', level: 2, reviews: 10 });
    expect(last[2]).toMatchObject({ date: '2026-10-21', level: 1 });
    expect(last[3]!.future).toBe(true);
    expect(weeks[0]![0]!.date).toBe(addDays('2026-10-19', -25 * 7));
  });
});

describe('buildDailyActivity from logs', () => {
  const sched = createScheduler({ request_retention: 0.9, fsrs_params: null });
  const IST = { timezone: 'Europe/Istanbul', day_start_hour: 4 };
  const BER = { timezone: 'Europe/Berlin', day_start_hour: 4 };

  function history(id: string, note: string, created: number, answers: [number, RatingValue][], extra = {}): CardHistory {
    const logs = answers.map(([t, r], i) => makeLog({ id: `${id}-${i}`, card_id: id, reviewed_at: t, rating: r, duration_ms: 1000 }));
    return { card: { id, note_id: note, suspended: false, deleted_at: null, ...extra }, steps: replayCard(sched, { id, created_at: created }, logs).steps };
  }

  it('a 03:59 answer counts to the previous day', () => {
    const t0359 = Date.UTC(2026, 9, 21, 0, 59); // 03:59 Istanbul
    const days = buildDailyActivity([history('c', 'n', t0359 - 1000, [[t0359, 3]])], IST);
    expect(days.map((d) => d.date)).toEqual(['2026-10-20']);
    expect(days[0]).toMatchObject({ reviews: 1, new_cards: 1, time_ms: 1000 });
  });

  it('counts new cards, review-state answers and passes; excludes undone answers', () => {
    const t = Date.UTC(2026, 9, 21, 7);
    const h = history('c', 'n', t - 1000, [
      [t, 3],
      [t + 10 * 60_000, 3], // graduates to Review
    ]);
    const due = h.steps[1]!.after.due;
    const h2 = history('c', 'n', t - 1000, [
      [t, 3],
      [t + 10 * 60_000, 3],
      [due, 1], // Review-state answer, failed
    ]);
    const days = buildDailyActivity([h2], IST);
    const total = days.reduce((a, d) => a + d.reviews, 0);
    expect(total).toBe(3);
    expect(days.reduce((a, d) => a + d.new_cards, 0)).toBe(1);
    expect(days.reduce((a, d) => a + d.review_answers, 0)).toBe(1);
    expect(days.reduce((a, d) => a + d.review_passed, 0)).toBe(0);
  });

  it('completed: false when a due card was left at day end, buried siblings excused', () => {
    const d1 = Date.UTC(2026, 9, 20, 8); // 2026-10-20 11:00 Istanbul
    // Card A: Again on day 1 → due in 1 min, never answered again → day 1 incomplete.
    const a = history('A', 'nA', d1 - 1000, [[d1, 1]]);
    // Card B graduates with Easy (due days later): complete.
    const b = history('B', 'nB', d1 - 1000, [[d1, 4]]);
    expect(buildDailyActivity([b], IST)[0]!.completed).toBe(true);
    expect(buildDailyActivity([a, b], IST)[0]!.completed).toBe(false);
    // Sibling of A answered that day (A itself not) → A's later pending state is excused.
    const d2 = d1 + 86_400_000;
    const sib = history('S', 'nA', d1 - 1000, [[d2, 4]]);
    const days = buildDailyActivity([a, b, sib], IST);
    expect(days.find((d) => d.date === '2026-10-21')!.completed).toBe(true);
    // Suspended cards are ignored.
    const aSusp = history('A', 'nA', d1 - 1000, [[d1, 1]], { suspended: true });
    expect(buildDailyActivity([aSusp, b], IST)[0]!.completed).toBe(true);
  });

  it('day keys stay right across a DST change', () => {
    // Berlin falls back on 2026-10-25 03:00 → 02:00. 03:30 CET on 10-25 = 02:30 UTC is before 04:00.
    const before = Date.UTC(2026, 9, 25, 2, 30);
    const after = Date.UTC(2026, 9, 25, 3, 0); // 04:00 CET
    const days = buildDailyActivity([history('x', 'n', before - 1, [[before, 4]]), history('y', 'm', after - 1, [[after, 4]])], BER);
    expect(days.map((d) => d.date)).toEqual(['2026-10-24', '2026-10-25']);
  });
});
