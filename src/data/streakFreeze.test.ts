// Streak protections through the data layer (v0.5 İP10, docs/decisions/0052): a missed day is
// covered once, through the sync writer (synced settings), the streak survives, Bugün gets one
// calm note, and vacation days never use a protection.
import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, type DayKey } from '../domain/day';
import { emptyDay } from '../domain/streak';
import { resetDb } from '../test/db';
import { db } from './db';
import { META, setMeta } from './meta';
import { getStreakSummary } from './queries';
import { ensureSettings, updateSettings } from './settings';
import { dismissFreezeNote, ensureStreakFreezes, getStreakFreezeView } from './streakFreeze';

// 12:00 in Istanbul on 13 November 2026.
const T = Date.UTC(2026, 10, 13, 9);
const DAY = 86_400_000;

async function activeOn(list: DayKey[]) {
  await db.daily_activity.bulkPut(list.map((d) => ({ ...emptyDay(d), reviews: 3, time_ms: 60_000 })));
}
const range = (from: DayKey, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));

beforeEach(async () => {
  await resetDb();
  await db.transaction('rw', db.meta, () => setMeta(META.userId, 'user-1'));
  await ensureSettings(T - 60 * DAY);
  await updateSettings({ timezone: 'Europe/Istanbul' }, T - 60 * DAY);
});

describe('ensureStreakFreezes', () => {
  it('covers yesterday once, as a synced settings change, and keeps the streak', async () => {
    await activeOn(range('2026-11-01', 11)); // 1–11 November; the 12th was missed
    expect((await getStreakSummary(T)).currentStreak).toBe(0);
    const outbox = await db.outbox.where('table').equals('settings').count();

    expect(await ensureStreakFreezes(T)).toEqual(['2026-11-12']);
    const settings = (await db.settings.get('settings'))!;
    expect(settings.streak_freezes).toEqual(['2026-11-12']);
    expect(await db.outbox.where('table').equals('settings').count()).toBe(outbox + 1);
    expect((await getStreakSummary(T)).currentStreak).toBe(11);

    // Again (another tab, the next open): nothing more is spent or written.
    const hlc = settings.hlc;
    expect(await ensureStreakFreezes(T + 60_000)).toEqual([]);
    expect((await db.settings.get('settings'))!.hlc).toBe(hlc);
  });

  it('two calls at once spend one protection', async () => {
    await activeOn(range('2026-11-01', 11));
    const [a, b] = await Promise.all([ensureStreakFreezes(T), ensureStreakFreezes(T)]);
    expect(a).toEqual(['2026-11-12']);
    expect(b).toEqual(['2026-11-12']); // the same run
    expect((await db.settings.get('settings'))!.streak_freezes).toEqual(['2026-11-12']);
  });

  it('three missed days: the streak ends and no protection is used', async () => {
    await activeOn(range('2026-11-01', 9)); // missed 10, 11, 12
    expect(await ensureStreakFreezes(T)).toEqual([]);
    expect((await db.settings.get('settings'))!.streak_freezes ?? null).toBeNull();
    expect((await getStreakFreezeView(T)).left).toBe(2);
  });

  it('vacation days are neutral and never use a protection', async () => {
    await activeOn(range('2026-11-01', 9)); // 1–9 November
    await updateSettings({ vacation: { start: '2026-11-10', end: '2026-11-12' } }, T - 5 * DAY);
    expect(await ensureStreakFreezes(T)).toEqual([]);
    expect((await getStreakSummary(T)).currentStreak).toBe(9);
    expect((await getStreakFreezeView(T)).left).toBe(2);
  });
});

describe('getStreakFreezeView', () => {
  it('the note shows on the day after, says what is left, and closes for good', async () => {
    await activeOn(range('2026-11-01', 11));
    expect((await getStreakFreezeView(T)).note).toBeNull();
    await ensureStreakFreezes(T);
    const view = await getStreakFreezeView(T);
    expect(view).toMatchObject({ note: { covered: 1, left: 1, day: '2026-11-12' }, left: 1, perMonth: 2, usedThisMonth: ['2026-11-12'] });
    await dismissFreezeNote('2026-11-12');
    expect((await getStreakFreezeView(T)).note).toBeNull();
    expect((await getStreakFreezeView(T)).left).toBe(1);
  });
});
