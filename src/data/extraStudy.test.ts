// "Biraz daha çalış" on the local database: extra new cards, review ahead, practice.
import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, dayKeyOf } from '../domain/day';
import { applyRating, createScheduler, emptyFsrs } from '../domain/fsrs';
import { CardState, Rating, type Card, type RatingValue } from '../domain/types';
import { resetDb } from '../test/db';
import { addNoteWithSenses, answerCard, undoAnswer } from './actions';
import { db } from './db';
import { addExtraNew, getMoreStudyOverview } from './extraStudy';
import { rebuildDailyActivity } from './dailyActivity';
import { recomputeAllCards } from './maintenance';
import { extraNewKey, getMeta, setMeta } from './meta';
import {
  getPracticeCards,
  getPracticeSourceCounts,
  loadPracticeCandidates,
  recordPractice,
} from './practice';
import { getStreakSummary, getStudyQueue } from './queries';
import { dayConfig, getSettings, updateSettings } from './settings';

// 2026-10-21 12:00 Istanbul (UTC+3).
const T = Date.UTC(2026, 9, 21, 9);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 86_400_000;
const sched = createScheduler({ request_retention: 0.9, fsrs_params: null });

beforeEach(async () => {
  await resetDb();
  await updateSettings({ timezone: 'Europe/Istanbul', daily_new_limit: 3 }, T - 30 * DAY);
});

async function addWords(n: number, at = T - 20 * DAY): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = await addNoteWithSenses(
      { term: `word${String(i).padStart(2, '0')}`, senses: [{ meaning_tr: `anlam ${i}` }] },
      at + i,
    );
    ids.push(r.note.id);
  }
  return ids;
}

async function recognition(noteId: string): Promise<Card> {
  return (await db.cards.where('note_id').equals(noteId).toArray()).find(
    (c) => c.card_type === 'recognition',
  )!;
}

/** Answer the whole queue at `now` (Easy by default: cards graduate at once); returns the answer count. */
async function studyAll(
  now: number,
  rating: RatingValue = Rating.Easy,
  mode?: 'ahead',
): Promise<number> {
  let n = 0;
  for (let guard = 0; guard < 200; guard++) {
    const q = await getStudyQueue({ learnAheadMs: 0, ...(mode ? { mode } : {}) }, now + n * 1000);
    const next = q.items[0];
    if (!next) return n;
    await answerCard({ card_id: next.card_id, rating, duration_ms: 3000 }, now + n * 1000);
    n++;
  }
  throw new Error('queue never emptied');
}

/** A recognition card graduated to Review in the past, chosen so that it falls due tomorrow. */
async function reviewDueTomorrow(noteId: string): Promise<Card> {
  const cfg = dayConfig(await getSettings(T));
  const tomorrow = addDays(dayKeyOf(T, cfg), 1);
  const card = await recognition(noteId);
  // First answers on some earlier day: Good, then Good after the 10-minute step.
  for (let back = 1; back <= 10; back++) {
    const at = T - back * DAY;
    let f = emptyFsrs(card.created_at);
    f = applyRating(sched, { id: card.id, ...f }, Rating.Good, at);
    f = applyRating(sched, { id: card.id, ...f }, Rating.Good, at + 10 * MIN);
    if (f.state === CardState.Review && dayKeyOf(f.due, cfg) === tomorrow) {
      await answerCard({ card_id: card.id, rating: Rating.Good, duration_ms: 1000 }, at);
      await answerCard({ card_id: card.id, rating: Rating.Good, duration_ms: 1000 }, at + 10 * MIN);
      return (await db.cards.get(card.id))!;
    }
  }
  throw new Error('no start day gives a due date of tomorrow');
}

describe('extra new cards', () => {
  it('"+5" brings exactly 5 more new cards today, counted once', async () => {
    await addWords(20);
    expect(await studyAll(T)).toBe(3);
    expect((await getStudyQueue({ learnAheadMs: 0 }, T + HOUR)).counts.total).toBe(0);

    expect(await addExtraNew(5, T + HOUR)).toBe(5);
    const q = await getStudyQueue({ learnAheadMs: 0 }, T + HOUR);
    expect(q.counts).toMatchObject({ new: 5, total: 5 });
    expect(q.extraNewToday).toBe(5);
    expect(await studyAll(T + HOUR)).toBe(5);

    const after = await getStudyQueue({ learnAheadMs: 0 }, T + 2 * HOUR);
    expect(after.counts.total).toBe(0);
    expect(after.newToday).toBe(8);
    expect(after.doneToday).toBe(8);
    const day = await db.daily_activity.get(dayKeyOf(T, dayConfig(await getSettings(T))));
    expect(day).toMatchObject({ reviews: 8, new_cards: 8 });
  });

  it('adds up, is per day, and drops the allowance of other days', async () => {
    await addWords(30);
    await setMeta(extraNewKey('2026-10-19'), 10);
    await addExtraNew(5, T);
    expect(await addExtraNew(10, T)).toBe(15);
    expect(await getMeta(extraNewKey('2026-10-19'))).toBeUndefined();
    expect((await getStudyQueue({ learnAheadMs: 0 }, T)).counts.new).toBe(18);
    // Tomorrow the allowance is gone.
    expect((await getStudyQueue({ learnAheadMs: 0 }, T + DAY)).counts.new_allowed).toBe(3);
    await expect(addExtraNew(0, T)).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('another device sees the cards introduced here and never introduces them twice', async () => {
    await addWords(20);
    await addExtraNew(5, T);
    await studyAll(T);
    // "Another device": same logs, no allowance in its meta.
    await db.meta.delete(extraNewKey(dayKeyOf(T, dayConfig(await getSettings(T)))));
    const q = await getStudyQueue({ learnAheadMs: 0 }, T + HOUR);
    expect(q.newToday).toBe(8);
    expect(q.counts.new).toBe(0);
  });
});

describe("review ahead (tomorrow's cards)", () => {
  it('writes normal review logs, recomputes to the same card and leaves today complete', async () => {
    const [a, b] = await addWords(2);
    const ca = await reviewDueTomorrow(a!);
    await reviewDueTomorrow(b!);
    const now = T + 2 * HOUR;
    const normal = await getStudyQueue({ learnAheadMs: 0 }, now);
    expect(normal.counts.review + normal.counts.learning).toBe(0);
    const ahead = await getStudyQueue({ mode: 'ahead', learnAheadMs: 0 }, now);
    expect(ahead.items.map((i) => i.kind)).toEqual(['review', 'review']);
    expect(ahead.items.every((i) => i.card.due >= ahead.dayEnd)).toBe(true);
    expect((await getMoreStudyOverview(now)).aheadCount).toBe(2);

    const logsBefore = await db.review_logs.count();
    expect(await studyAll(now, Rating.Good, 'ahead')).toBe(2);
    expect(await db.review_logs.count()).toBe(logsBefore + 2);
    const after = (await db.cards.get(ca.id))!;
    expect(after.last_review).toBe(now);
    expect(after.due).toBeGreaterThan(ca.due);

    // The logs are the truth: a full recompute changes nothing.
    expect(await recomputeAllCards(now + MIN)).toBe(0);
    expect(await getStudyQueue({ mode: 'ahead', learnAheadMs: 0 }, now + MIN)).toMatchObject({
      items: [],
    });
    const day = await db.daily_activity.get(dayKeyOf(now, dayConfig(await getSettings(now))));
    expect(day).toMatchObject({ reviews: 2, completed: true });
    expect((await rebuildDailyActivity(now)).find((d) => d.date === day!.date)).toEqual(day);
    expect((await getStreakSummary(now)).todayActive).toBe(true);
  });

  it('an early Again comes back as a learning step today and can be undone', async () => {
    const [a] = await addWords(1);
    const card = await reviewDueTomorrow(a!);
    const now = T + HOUR;
    const res = await answerCard(
      { card_id: card.id, rating: Rating.Again, duration_ms: 2000 },
      now,
    );
    expect(res.card.state).toBe(CardState.Relearning);
    expect(
      (await getStudyQueue({ learnAheadMs: 0 }, now + 11 * MIN)).items.map((i) => i.card_id),
    ).toEqual([card.id]);
    await undoAnswer(res.log.id, now + MIN);
    expect(await db.cards.get(card.id)).toMatchObject({
      state: CardState.Review,
      due: card.due,
      stability: card.stability,
    });
  });
});

describe('practice', () => {
  async function studiedDeck() {
    const notes = await addWords(6);
    for (const id of notes) await reviewDueTomorrow(id);
    return notes;
  }

  it('selects hard cards from Again answers and practice misses, and recent cards from first answers', async () => {
    const notes = await addWords(4, T - 3 * DAY);
    // Day -3: everything learned (first answers within 7 days).
    await studyAll(T - 3 * DAY);
    await studyAll(T - 3 * DAY + 20 * MIN);
    const c0 = await recognition(notes[0]!);
    const c1 = await recognition(notes[1]!);
    expect((await getPracticeSourceCounts(T)).recent).toBe(3);

    // An Again today makes c0 hard; an undone Again does not count.
    await answerCard({ card_id: c0.id, rating: Rating.Again, duration_ms: 1000 }, T);
    const undone = await answerCard(
      { card_id: c1.id, rating: Rating.Again, duration_ms: 1000 },
      T + 1,
    );
    await undoAnswer(undone.log.id, T + 2);
    expect(await getPracticeCards({ source: 'hard' }, { size: 10, seed: 's' }, T + 3)).toEqual([
      c0.id,
    ]);

    // A practice miss makes c1 hard too.
    await recordPractice(
      { card_id: c1.id, result: 'unknown', mode: 'recent', session_id: 'p1', duration_ms: 900 },
      T + 4,
    );
    expect(
      (await getPracticeCards({ source: 'hard' }, { size: 10, seed: 's' }, T + 5)).sort(),
    ).toEqual([c0.id, c1.id].sort());
    expect((await getPracticeSourceCounts(T + 5)).hard).toBe(2);
  });

  it('lists tags of studied notes', async () => {
    const r = await addNoteWithSenses(
      { term: 'invoice', tags: ['iş'], senses: [{ meaning_tr: 'fatura' }] },
      T - 5 * DAY,
    );
    await addNoteWithSenses(
      { term: 'unseen', tags: ['ev'], senses: [{ meaning_tr: 'görülmemiş' }] },
      T - 5 * DAY,
    );
    await reviewDueTomorrow(r.note.id);
    expect((await getPracticeSourceCounts(T)).tags).toEqual([{ tag: 'iş', count: 1 }]);
    expect(
      await getPracticeCards({ source: 'tag', tag: 'iş' }, { size: 10, seed: 's' }, T),
    ).toHaveLength(1);
  });

  it('recordPractice writes one practice log and its outbox row, nothing else', async () => {
    const [a] = await studiedDeck();
    const card = await recognition(a!);
    const outbox = await db.outbox.count();
    const log = await recordPractice(
      { card_id: card.id, result: 'known', mode: 'hard', session_id: 's1', duration_ms: 99_000 },
      T,
    );
    expect(log).toMatchObject({
      card_id: card.id,
      result: 'known',
      practiced_at: T,
      duration_ms: 60_000,
      user_id: null,
    });
    expect(await db.practice_logs.toArray()).toEqual([log]);
    const queued = (await db.outbox.toArray()).slice(outbox);
    expect(queued.map((o) => [o.table, o.row_id, o.op])).toEqual([
      ['practice_logs', log.id, 'upsert'],
    ]);
    await expect(
      recordPractice(
        {
          card_id: card.id,
          result: 'maybe' as 'known',
          mode: 'hard',
          session_id: 's1',
          duration_ms: 1,
        },
        T,
      ),
    ).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });

  it('property: no practice sequence changes cards, review logs, daily activity or the streak', async () => {
    const notes = await studiedDeck();
    const cardIds = (await db.cards.toArray())
      .filter((c) => notes.includes(c.note_id))
      .map((c) => c.id);
    const snapshot = async () => ({
      cards: await db.cards.toArray(),
      logs: await db.review_logs.toArray(),
      days: await db.daily_activity.toArray(),
      streak: await getStreakSummary(T + DAY),
      queue: (await getStudyQueue({ learnAheadMs: 0 }, T + HOUR)).items.map((i) => i.card_id),
    });
    const before = await snapshot();
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            card: fc.constantFrom(...cardIds),
            known: fc.boolean(),
            dt: fc.integer({ min: 0, max: 3 * HOUR }),
          }),
          { minLength: 1, maxLength: 25 },
        ),
        async (answers) => {
          for (const x of answers) {
            await recordPractice(
              {
                card_id: x.card,
                result: x.known ? 'known' : 'unknown',
                mode: 'recent',
                session_id: 'round',
                duration_ms: 1500,
              },
              T + x.dt,
            );
          }
          expect(await snapshot()).toEqual(before);
        },
      ),
      { numRuns: 25 },
    );
    expect(await db.practice_logs.count()).toBeGreaterThan(0);
  });
});

describe('overview', () => {
  it('counts what "Biraz daha çalış" offers', async () => {
    await addWords(12);
    await studyAll(T);
    const o = await getMoreStudyOverview(T + HOUR);
    expect(o).toMatchObject({
      dueNow: 0,
      dailyNewLimit: 3,
      extraNewToday: 0,
      newWaiting: 9,
      aheadCount: 0,
    });
    expect(o.practice.recent).toBe(3);
    await addExtraNew(5, T + HOUR);
    expect(await getMoreStudyOverview(T + HOUR)).toMatchObject({ dueNow: 5, extraNewToday: 5 });
  });

  it('candidates load quickly for 1,000 cards', async () => {
    const notes = await addWords(300, T - 40 * DAY);
    for (const id of notes.slice(0, 100)) {
      const c = await recognition(id);
      await answerCard({ card_id: c.id, rating: Rating.Good, duration_ms: 1000 }, T - 10 * DAY);
    }
    const t0 = performance.now();
    const list = await loadPracticeCandidates(T);
    await getMoreStudyOverview(T);
    expect(list.length).toBe(100);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
