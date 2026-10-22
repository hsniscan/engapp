// Load management on the local database (v0.3 İP3): catch-up queue, vacation, ramp, streak,
// settings actions, forecast input and backups.
import { beforeEach, describe, expect, it } from 'vitest';
import { relativeOverdueness } from '../domain/catchup';
import { addDays, dayKeyOf } from '../domain/day';
import { CardState, Rating, type Card } from '../domain/types';
import { makeCard } from '../test/factories';
import { resetDb } from '../test/db';
import { answerCard } from './actions';
import { db } from './db';
import {
  computeWorkload,
  dismissLoadWarning,
  endVacation,
  getLoadStatus,
  getWorkloadInput,
  isLoadWarningSnoozed,
  resetLoadCache,
  setVacation,
} from './load';
import { exportBackup, restoreBackup } from './maintenance';
import { getStreakSummary, getStudyQueue } from './queries';
import { dayConfig, getSettings, updateSettings } from './settings';

// 2026-10-21 12:00 Istanbul (UTC+3).
const T = Date.UTC(2026, 9, 21, 9);
const DAY = 86_400_000;
const today = '2026-10-21';

beforeEach(async () => {
  await resetDb();
  resetLoadCache();
  await updateSettings({ timezone: 'Europe/Istanbul', daily_new_limit: 10 }, T - 60 * DAY);
});

/** n Review cards overdue by 1–20 days, plus `fresh` new cards. */
async function seed(n: number, fresh = 10): Promise<Card[]> {
  const cards: Card[] = [];
  for (let i = 0; i < n; i++) {
    const late = 1 + (i % 20);
    const ivl = 1 + ((i * 7) % 40);
    cards.push(
      makeCard({
        id: `r${String(i).padStart(4, '0')}`,
        note_id: `n${i}`,
        created_at: T - 90 * DAY,
        state: CardState.Review,
        due: T - late * DAY,
        last_review: T - (late + ivl) * DAY,
        scheduled_days: ivl,
        stability: ivl,
        difficulty: 5,
        reps: 3,
      }),
    );
  }
  for (let i = 0; i < fresh; i++)
    cards.push(makeCard({ id: `new${i}`, note_id: `nn${i}`, created_at: T - 30 * DAY + i }));
  await db.cards.bulkAdd(cards);
  return cards;
}

describe('catch-up queue', () => {
  it('caps today at capacity, most overdue first, and pauses new cards', async () => {
    const cards = await seed(200);
    const q = await getStudyQueue({}, T);
    expect(q.load?.plan.mode).toBe('catchup');
    // No history yet: 10 s a card → 20 min = 120 cards.
    expect(q.load?.capacity).toBe(120);
    expect(q.counts.review).toBe(120);
    expect(q.counts.new).toBe(0);
    const od = (id: string) => relativeOverdueness(cards.find((c) => c.id === id)!, T);
    const reviews = q.items.filter((i) => i.kind === 'review').map((i) => od(i.card_id));
    expect(reviews).toEqual([...reviews].sort((a, b) => b - a));

    // Answers count against the cap; nothing but the answered cards changes.
    const before = await db.cards.toArray();
    for (const item of q.items.slice(0, 30)) {
      await answerCard({ card_id: item.card_id, rating: Rating.Good, duration_ms: 5000 }, T + 1000);
    }
    const q2 = await getStudyQueue({}, T + 2000);
    expect(q2.counts.review).toBe(90);
    expect(q2.load?.reviewsDoneToday).toBe(30);
    const answered = new Set(q.items.slice(0, 30).map((i) => i.card_id));
    const after = await db.cards.toArray();
    for (const c of after) if (!answered.has(c.id)) expect(c).toEqual(before.find((b) => b.id === c.id));
    expect(await db.review_logs.count()).toBe(30);

    const status = await getLoadStatus(T + 2000);
    expect(status.catchupDays).toBe(2);
  });

  it('is off when turned off, and normal when the backlog fits', async () => {
    await seed(200);
    await updateSettings({ catchup_auto: false }, T - DAY);
    const q = await getStudyQueue({}, T);
    expect(q.load?.plan.mode).toBe('normal');
    expect(q.counts.review).toBe(200);
    await updateSettings({ catchup_auto: true, daily_capacity_min: 60 }, T - DAY);
    resetLoadCache();
    expect((await getStudyQueue({}, T)).counts.review).toBe(200);
  });

  it('does not cap "Yarının kartları"', async () => {
    await seed(200);
    const q = await getStudyQueue({ mode: 'ahead' }, T);
    expect(q.load).toBeNull();
    expect(q.counts.review).toBe(200);
  });
});

describe('vacation', () => {
  it('opens no new cards on vacation and ramps them 0 → ½ → full afterwards', async () => {
    await seed(5);
    await setVacation({ start: '2026-10-20', end: '2026-10-25' }, T - 2 * DAY);
    expect((await getStudyQueue({}, T)).counts.new).toBe(0);
    const at = (d: number) => T + d * DAY;
    expect((await getStudyQueue({}, at(5))).load?.plan.newFactor).toBe(0); // first day back
    expect((await getStudyQueue({}, at(5))).counts.new).toBe(0);
    expect((await getStudyQueue({}, at(6))).counts.new).toBe(5);
    expect((await getStudyQueue({}, at(7))).counts.new).toBe(10);
  });

  it('keeps the streak frozen on vacation days without reviews', async () => {
    const rows = ['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19'].map((date) => ({
      date,
      reviews: 3,
      new_cards: 0,
      time_ms: 1000,
      review_answers: 0,
      review_passed: 0,
      completed: true,
    }));
    await db.daily_activity.bulkPut(rows);
    expect((await getStreakSummary(T + 2 * DAY)).currentStreak).toBe(0);
    await setVacation({ start: '2026-10-20', end: '2026-10-25' }, T - 2 * DAY);
    expect((await getStreakSummary(T + 2 * DAY)).currentStreak).toBe(5);
    expect((await getStreakSummary(T + 5 * DAY)).currentStreak).toBe(5); // first day back, nothing yet
    expect((await getStreakSummary(T + 6 * DAY)).currentStreak).toBe(0); // a missed day after it
  });

  it('offers the vacation days’ reviews ahead, up to 7 days, through the ahead queue', async () => {
    const cards = Array.from({ length: 10 }, (_, i) =>
      makeCard({ id: `a${i}`, note_id: `an${i}`, state: CardState.Review, due: T + (i + 1) * DAY, stability: 10, difficulty: 5, reps: 2, last_review: T - 5 * DAY, scheduled_days: 6 }),
    );
    await db.cards.bulkAdd(cards);
    await setVacation({ start: '2026-10-23', end: '2026-11-10' }, T);
    const s = await getLoadStatus(T);
    expect(s.aheadDays).toBe(7);
    expect(s.aheadCount).toBe(7);
    const ahead = await getStudyQueue({ mode: 'ahead' }, T);
    expect(ahead.counts.review).toBe(7);
  });

  it('ends early, keeps the lived days for the streak, and syncs through the outbox', async () => {
    await setVacation({ start: '2026-10-18', end: '2026-10-30' }, T - 5 * DAY);
    await endVacation(T);
    const s = await getSettings(T);
    expect(s.vacation).toEqual({ start: '2026-10-18', end: '2026-10-20' });
    const pushed = (await db.outbox.toArray()).filter((r) => r.table === 'settings').at(-1);
    expect(pushed?.payload).toMatchObject({ vacation: { start: '2026-10-18', end: '2026-10-20' } });
    await expect(setVacation({ start: '2026-10-01', end: '2026-10-02' }, T)).rejects.toThrow();
    await expect(setVacation({ start: '2026-10-30', end: '2026-10-20' }, T)).rejects.toThrow();
    // Replacing it later keeps the lived days in the history.
    await setVacation({ start: '2026-12-01', end: '2026-12-02' }, T + DAY);
    expect((await getSettings(T)).vacation_history).toEqual([{ start: '2026-10-18', end: '2026-10-20' }]);
  });

  it('survives a backup round trip', async () => {
    await updateSettings({ daily_capacity_min: 35, catchup_auto: false }, T);
    await setVacation({ start: '2026-11-01', end: '2026-11-05' }, T);
    const file = await exportBackup(T);
    await updateSettings({ daily_capacity_min: 10, vacation: null }, T + 1);
    await restoreBackup(JSON.parse(JSON.stringify(file)), 'overwrite', T + 2);
    expect(await getSettings(T + 3)).toMatchObject({
      daily_capacity_min: 35,
      catchup_auto: false,
      vacation: { start: '2026-11-01', end: '2026-11-05' },
    });
  });
});

describe('forecast input and warning', () => {
  it('builds a 30-day forecast and a suggestion when the load is above capacity', async () => {
    // Many cards falling due over the next days, little capacity.
    const cards = Array.from({ length: 400 }, (_, i) =>
      makeCard({ id: `f${i}`, note_id: `fn${i}`, state: CardState.Review, due: T + (1 + (i % 10)) * DAY, stability: 3, difficulty: 6, reps: 2, last_review: T - 2 * DAY, scheduled_days: 3 }),
    );
    await db.cards.bulkAdd(cards);
    await updateSettings({ daily_capacity_min: 5 }, T);
    const input = await getWorkloadInput(T);
    expect(input.days[0]).toBe(today);
    expect(input.days).toHaveLength(30);
    const view = computeWorkload(input);
    expect(view.totals).toHaveLength(30);
    expect(view.capacity).toBe(30);
    expect(view.advice.overDay).not.toBeNull();
  });

  it('snoozes the warning for a week', async () => {
    expect(await isLoadWarningSnoozed(T)).toBe(false);
    await dismissLoadWarning(T);
    expect(await isLoadWarningSnoozed(T + 6 * DAY)).toBe(true);
    expect(await isLoadWarningSnoozed(T + 7 * DAY)).toBe(false);
    expect(dayKeyOf(T, dayConfig(await getSettings(T)))).toBe(today);
    expect(addDays(today, 7)).toBe('2026-10-28');
  });
});
