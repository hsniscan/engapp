import { beforeEach, describe, expect, it } from 'vitest';
import {
  addNoteWithSenses,
  answerCard,
  db,
  getHomeSummary,
  getStreakSummary,
  META,
  resetStudyHistory,
  setMeta,
  undoAnswer,
  updateSettings,
} from '@/data';
import { effectiveLogs } from '@/domain/recompute';
import { CardState, Rating } from '@/domain/types';
import { resetDb } from '@/test/db';
import { MAX_PUSH_BATCH } from './api';
import { runSync } from './engine';
import {
  FakeServer,
  loadDevice,
  onDevice,
  saveDevice,
  type DeviceImage,
} from './testing/fakeServer';

const T = Date.UTC(2026, 9, 21, 9);
const DAY = 86_400_000;
const USER = 'user-1';
const NOTES = 120;
const CHUNK = 50; // three reset transactions

let server: FakeServer;
let maxBatch = 0;

async function newDevice(deviceId: string): Promise<DeviceImage> {
  await resetDb();
  await db.transaction('rw', db.meta, async () => {
    await setMeta(META.deviceId, deviceId);
    await setMeta(META.userId, USER);
  });
  await updateSettings({ timezone: 'Europe/Istanbul' }, T);
  return saveDevice();
}

const sync = (now: number) => runSync(server, { now: () => now });

/** What a reset must leave: New cards, no answer that counts, empty stats. */
async function expectNoHistory(now: number) {
  const cards = (await db.cards.toArray()).filter((c) => c.deleted_at === null);
  expect(cards).toHaveLength(NOTES * 3);
  for (const c of cards) {
    expect(c).toMatchObject({
      state: CardState.New,
      reps: 0,
      lapses: 0,
      last_review: null,
      due: c.created_at,
    });
    expect(c.unlocked).toBe(c.card_type === 'recognition');
  }
  expect(effectiveLogs(await db.review_logs.toArray())).toEqual([]);
  expect(await db.daily_activity.count()).toBe(0);
  const streak = await getStreakSummary(now);
  expect(streak).toMatchObject({
    todayActive: false,
    todayReviews: 0,
    totalActiveDays: 0,
    currentStreak: 0,
  });
  const home = await getHomeSummary(now);
  expect(home.doneToday).toBe(0);
  expect(home.queue.new).toBe(10); // the daily limit again, nothing introduced today
}

beforeEach(async () => {
  server = new FakeServer(USER);
  maxBatch = 0;
  const push = server.pushBatch.bind(server);
  server.pushBatch = (items) => {
    maxBatch = Math.max(maxBatch, items.length);
    return push(items);
  };
  await resetDb();
});

describe('reset study history', () => {
  it('survives sync: another device pulls New cards and no effective history', async () => {
    // Device A studies over two days (recognition → Review unlocks production and cloze).
    let a = await onDevice(await newDevice('dev-a'), async () => {
      for (let i = 0; i < NOTES; i++) {
        const sentence = `I saw word${i} today.`;
        await addNoteWithSenses(
          {
            term: `word${i}`,
            senses: [
              {
                meaning_tr: `anlam${i}`,
                source_sentence: sentence,
                span: [6, 6 + `word${i}`.length],
              },
            ],
          },
          T,
        );
      }
      for (const c of await db.cards.where('card_type').equals('recognition').toArray()) {
        await answerCard({ card_id: c.id, rating: Rating.Easy, duration_ms: 2000 }, T + 1000);
      }
      for (const c of await db.cards.where('card_type').equals('production').toArray()) {
        await answerCard({ card_id: c.id, rating: Rating.Good, duration_ms: 2000 }, T + DAY);
      }
      const last = await db.review_logs.orderBy('reviewed_at').last();
      await undoAnswer(last!.id, T + DAY + 1); // an undone answer stays undone
      await sync(T + DAY + 2);
    });
    let b = await onDevice(await newDevice('dev-b'), async () => {
      await sync(T + DAY + 3);
      expect(effectiveLogs(await db.review_logs.toArray())).toHaveLength(NOTES * 2 - 1);
    });

    const now = T + DAY + 60_000;
    a = await onDevice(a, async () => {
      const res = await resetStudyHistory(now, CHUNK);
      expect(res.undoneLogs).toBe(NOTES * 2 - 1);
      expect(res.resetCards).toBe(NOTES * 3); // every card: New, or re-locked
      await expectNoHistory(now);
      maxBatch = 0;
      await sync(now + 1);
      expect(await db.outbox.count()).toBe(0);
      expect(maxBatch).toBe(MAX_PUSH_BATCH);
      // Running it again changes nothing.
      expect(await resetStudyHistory(now + 2, CHUNK)).toEqual({ undoneLogs: 0, resetCards: 0 });
      expect(await db.outbox.count()).toBe(0);
    });

    // The second device pulls the undo rows and the reset cards.
    b = await onDevice(b, async () => {
      await sync(now + 3);
      await expectNoHistory(now + 3);
      expect(await db.outbox.count()).toBe(0); // its recompute matched the pulled cards
    });

    // A new device pulling everything from 0 sees the same.
    await newDevice('dev-c');
    await sync(now + 4);
    await expectNoHistory(now + 4);

    // Studying again after the reset counts normally.
    await loadDevice(b);
    const rec = (await db.cards.where('card_type').equals('recognition').toArray())[0]!;
    await answerCard({ card_id: rec.id, rating: Rating.Good, duration_ms: 1000 }, now + 5);
    expect((await getStreakSummary(now + 6)).todayReviews).toBe(1);
    expect((await db.cards.get(rec.id))!.reps).toBe(1);
  }, 120_000);

  it('also cancels logs whose card is not on this device yet', async () => {
    await newDevice('dev-a');
    const { createdCards } = await addNoteWithSenses(
      { term: 'tide', senses: [{ meaning_tr: 'gelgit' }] },
      T,
    );
    const rec = createdCards.find((c) => c.card_type === 'recognition')!;
    await answerCard({ card_id: rec.id, rating: Rating.Good, duration_ms: 1000 }, T + 1);
    const log = (await db.review_logs.toArray())[0]!;
    await db.review_logs.add({ ...log, id: 'orphan-log', card_id: 'card-from-elsewhere' });
    const res = await resetStudyHistory(T + 2);
    expect(res.undoneLogs).toBe(2);
    expect(effectiveLogs(await db.review_logs.toArray())).toEqual([]);
    expect((await db.cards.get(rec.id))!.state).toBe(CardState.New);
  });
});
