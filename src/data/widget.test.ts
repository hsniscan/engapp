import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from '../test/db';
import { pickFsrs } from '../domain/fsrs';
import { parseAnswerQueue, ratingValue } from '../domain/notificationAnswer';
import { CardState, Rating, type Card } from '../domain/types';
import { uuidv7 } from '../domain/ids';
import {
  addNoteWithSenses,
  answerCard,
  replayQueuedAnswer,
  setSuspended,
  softDeleteNote,
} from './actions';
import { db } from './db';
import { updateSettings } from './settings';
import { getReminderCards, getWidgetState } from './widget';

// 2026-10-21 12:00 Istanbul (UTC+3).
const T = Date.UTC(2026, 9, 21, 9);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

beforeEach(async () => {
  await resetDb();
  await updateSettings({ timezone: 'Europe/Istanbul' }, T - 10 * DAY);
});

async function recognition(term: string, meaning: string, at = T - 5 * DAY): Promise<Card> {
  const r = await addNoteWithSenses({ term, senses: [{ meaning_tr: meaning }] }, at);
  const card = (await db.cards.where('note_id').equals(r.note.id).toArray()).find(
    (c) => c.card_type === 'recognition',
  );
  return card!;
}

/** A recognition card in Review, due a day before T. */
async function reviewCard(term: string, meaning: string): Promise<Card> {
  const c = await recognition(term, meaning);
  await answerCard({ card_id: c.id, rating: Rating.Easy, duration_ms: 3000 }, T - 4 * DAY);
  const card = (await db.cards.get(c.id))!;
  expect(card.state).toBe(CardState.Review);
  await db.cards.update(c.id, { due: T - DAY });
  return (await db.cards.get(c.id))!;
}

type Snapshot = Map<string, unknown[]>;

/** Every table's rows (to run two answers from the same start, same card ids). */
async function snapshot(): Promise<Snapshot> {
  const out: Snapshot = new Map();
  for (const t of db.tables) out.set(t.name, await t.toArray());
  return out;
}

async function restore(s: Snapshot): Promise<void> {
  await resetDb();
  for (const t of db.tables) await t.bulkPut(s.get(t.name) ?? []);
}

/** What the answer leaves behind, without ids and write stamps. */
async function outcome(cardId: string) {
  const card = (await db.cards.get(cardId))!;
  const logs = await db.review_logs.where('card_id').equals(cardId).sortBy('reviewed_at');
  const days = await db.daily_activity.toArray();
  return {
    fsrs: pickFsrs(card),
    unlocked: card.unlocked,
    logs: logs.map((l) => ({
      rating: l.rating,
      reviewed_at: l.reviewed_at,
      duration_ms: l.duration_ms,
      undo_of: l.undo_of,
    })),
    days: days.map((d) => ({ ...d })).sort((a, b) => (a.date < b.date ? -1 : 1)),
  };
}

describe('replayQueuedAnswer', () => {
  for (const rating of ['Good', 'Again'] as const) {
    it(`gives the same card, log and day as answering live (${rating})`, async () => {
      const at = T + 2 * HOUR;
      const c = await reviewCard('resilient', 'dayanıklı');
      const before = await snapshot();
      await answerCard({ card_id: c.id, rating: ratingValue(rating), duration_ms: 0 }, at);
      const live = await outcome(c.id);

      await restore(before);
      const id = uuidv7(at);
      // Replayed when the app comes back, hours later on the same day.
      const r = await replayQueuedAnswer(
        { id, card_id: c.id, rating: ratingValue(rating), at },
        at + 5 * HOUR,
      );
      expect(r.status).toBe('applied');
      expect(await outcome(c.id)).toEqual(live);
      // The queue id is the log id; the log is new (append-only), written now.
      const log = (await db.review_logs.get(id))!;
      expect(log.reviewed_at).toBe(at);
      expect(log.created_at).toBe(at + 5 * HOUR);
    });
  }

  it('applies each queued item once', async () => {
    const c = await reviewCard('brittle', 'kırılgan');
    const item = { id: uuidv7(T), card_id: c.id, rating: Rating.Good, at: T };
    expect((await replayQueuedAnswer(item, T + HOUR)).status).toBe('applied');
    const after = await outcome(c.id);
    const outbox = await db.outbox.count();
    expect((await replayQueuedAnswer(item, T + 2 * HOUR)).status).toBe('duplicate');
    expect(await outcome(c.id)).toEqual(after);
    expect(await db.outbox.count()).toBe(outbox);
  });

  it('counts an answer from yesterday on yesterday', async () => {
    const c = await reviewCard('vivid', 'canlı');
    const at = T - 20 * HOUR; // 2026-10-20 19:00 Istanbul
    expect(
      (await replayQueuedAnswer({ id: uuidv7(at), card_id: c.id, rating: Rating.Good, at }, T))
        .status,
    ).toBe('applied');
    const days = await db.daily_activity.toArray();
    expect(days.find((d) => d.date === '2026-10-20')?.reviews).toBe(1);
    expect(days.find((d) => d.date === '2026-10-21')).toBeUndefined();
  });

  it('puts an older answer in its place when the card was answered after it', async () => {
    const c = await reviewCard('sparse', 'seyrek');
    const base = await snapshot();
    const notifiedAt = T + HOUR;
    await answerCard({ card_id: c.id, rating: Rating.Good, duration_ms: 2000 }, T + 2 * HOUR);
    const r = await replayQueuedAnswer(
      { id: uuidv7(notifiedAt), card_id: c.id, rating: Rating.Again, at: notifiedAt },
      T + 3 * HOUR,
    );
    expect(r.status).toBe('applied');

    // Same history answered live in time order.
    const replayed = await outcome(c.id);
    await restore(base);
    await answerCard({ card_id: c.id, rating: Rating.Again, duration_ms: 0 }, notifiedAt);
    await answerCard({ card_id: c.id, rating: Rating.Good, duration_ms: 2000 }, T + 2 * HOUR);
    const live = await outcome(c.id);
    expect(replayed.fsrs).toEqual(live.fsrs);
    expect(replayed.logs).toEqual(live.logs);
    expect(replayed.days.map((x) => [x.date, x.reviews])).toEqual(
      live.days.map((x) => [x.date, x.reviews]),
    );
  });

  it('skips a deleted or suspended card and never dates an answer in the future', async () => {
    const a = await reviewCard('gone', 'gitmiş');
    const b = await reviewCard('paused', 'durmuş');
    const c = await reviewCard('ahead', 'ileri');
    await softDeleteNote(a.note_id, T);
    await setSuspended({ card_ids: [b.id] }, true, T);
    expect(
      (await replayQueuedAnswer({ id: uuidv7(T), card_id: a.id, rating: Rating.Good, at: T }, T))
        .status,
    ).toBe('skipped');
    expect(
      (await replayQueuedAnswer({ id: uuidv7(T), card_id: b.id, rating: Rating.Good, at: T }, T))
        .status,
    ).toBe('skipped');
    expect(
      (await replayQueuedAnswer({ id: uuidv7(T), card_id: 'nope', rating: Rating.Good, at: T }, T))
        .status,
    ).toBe('skipped');
    const id = uuidv7(T + HOUR);
    await replayQueuedAnswer({ id, card_id: c.id, rating: Rating.Good, at: T + HOUR }, T);
    expect((await db.review_logs.get(id))?.reviewed_at).toBe(T);
  });

  it('replays a parsed native queue in order', async () => {
    const c = await reviewCard('steady', 'istikrarlı');
    const q = parseAnswerQueue([
      { id: uuidv7(T + 2 * HOUR), card_id: c.id, rating: 'Good', at: T + 2 * HOUR },
      { id: uuidv7(T + HOUR), card_id: c.id, rating: 'Again', at: T + HOUR },
    ]);
    for (const item of q)
      await replayQueuedAnswer({ ...item, rating: ratingValue(item.rating) }, T + 3 * HOUR);
    const logs = await db.review_logs.where('card_id').equals(c.id).sortBy('reviewed_at');
    expect(logs.slice(-2).map((l) => l.rating)).toEqual([Rating.Again, Rating.Good]);
  });
});

describe('getWidgetState', () => {
  it('counts due word cards today and tomorrow and picks a word being learned', async () => {
    const due = await reviewCard('resilient', 'dayanıklı');
    await recognition('fresh', 'taze', T - DAY); // new: a candidate for the new count, not the word
    const s = await getWidgetState(null, T);
    expect(s.day).toBe('2026-10-21');
    expect(s.due).toBe(1);
    expect(s.new_count).toBe(1);
    expect(s.next?.day).toBe('2026-10-22');
    expect(s.word).toEqual({ tr: 'dayanıklı', en: 'resilient', note_id: due.note_id });
    expect(s.updated_at).toBe(T);

    // After a session the count drops (the state the widget gets after each session).
    await answerCard({ card_id: due.id, rating: Rating.Good, duration_ms: 1000 }, T + HOUR);
    const after = await getWidgetState(s, T + HOUR);
    expect(after.due).toBe(0);
    expect(after.word?.note_id).toBe(due.note_id);
  });

  it('has no word when nothing is being learned', async () => {
    await recognition('fresh', 'taze');
    expect((await getWidgetState(null, T)).word).toBeNull();
  });
});

describe('getReminderCards', () => {
  it('asks due Review cards with their term and meaning', async () => {
    const a = await reviewCard('resilient', 'dayanıklı');
    await recognition('fresh', 'taze');
    const [first, second] = await getReminderCards([T, T]);
    expect(first).toMatchObject({ card_id: a.id, term: 'resilient', meaning: 'dayanıklı' });
    expect(second).toBeNull();
    expect(await getReminderCards([])).toEqual([]);
  });
});
