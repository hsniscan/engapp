// Leech cards on the device: flagged from the logs when the 6th lapse happens, never
// suspended by the app; split and reset only change cards, never review logs.
import { beforeEach, describe, expect, it } from 'vitest';
import { LEECH_LAPSES } from '../domain/leech';
import { Rating, type Card } from '../domain/types';
import { resetDb } from '../test/db';
import { addNoteWithSenses, answerCard, undoAnswer } from './actions';
import { db } from './db';
import {
  getCardLapses,
  getLeechSheet,
  leechAfterAnswer,
  listLeechCards,
  resetCard,
  splitSenses,
  undoLeechAction,
} from './leech';
import { recomputeAllCards, runIntegrityCheck } from './maintenance';
import { getCardView, getStudyQueue } from './queries';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 1, 9);

async function bank() {
  const res = await addNoteWithSenses(
    {
      term: 'bank',
      senses: [
        { meaning_tr: 'banka', source_sentence: 'I went to the bank.', span: [14, 18] },
        { meaning_tr: 'kıyı', source_sentence: 'We sat on the river bank.', span: [20, 24] },
      ],
    },
    T0,
  );
  const cards = res.createdCards;
  return {
    note: res.note,
    senses: res.addedSenses,
    recognition: cards.find((c) => c.card_type === 'recognition')!,
    production: cards.find((c) => c.card_type === 'production')!,
  };
}

/** Easy (to Review), then `lapses` × (Again, Easy). Returns the last log id and the time. */
async function forget(cardId: string, lapses: number, start = T0) {
  let t = start;
  let last = '';
  const answer = async (rating: 1 | 4) => {
    t += 3 * DAY;
    last = (await answerCard({ card_id: cardId, rating, duration_ms: 3000 }, t)).log.id;
  };
  await answer(Rating.Easy);
  for (let i = 0; i < lapses; i++) {
    await answer(Rating.Again);
    if (i < lapses - 1) await answer(Rating.Easy);
  }
  return { last, t };
}

const logsSnapshot = async () => (await db.review_logs.toArray()).sort((a, b) => (a.id < b.id ? -1 : 1));

beforeEach(resetDb);

describe('leech detection', () => {
  it('flags the 6th lapse in the session, from the logs, and suspends nothing', async () => {
    const { recognition } = await bank();
    const five = await forget(recognition.id, LEECH_LAPSES - 1);
    expect(await leechAfterAnswer(recognition.id, five.last)).toEqual({ crossed: false, lapses: 5 });
    await answerCard({ card_id: recognition.id, rating: Rating.Easy, duration_ms: 1000 }, five.t + DAY);
    const sixth = await answerCard({ card_id: recognition.id, rating: Rating.Again, duration_ms: 1000 }, five.t + 5 * DAY);
    expect(await leechAfterAnswer(recognition.id, sixth.log.id)).toEqual({ crossed: true, lapses: 6 });
    expect(await getCardLapses(recognition.id)).toBe(sixth.card.lapses);
    expect((await db.cards.toArray()).every((c) => !c.suspended && c.deleted_at === null)).toBe(true);

    const sheet = (await getLeechSheet(recognition.id))!;
    expect(sheet).toMatchObject({ leech: true, lapses: 6, canSplit: true });
    expect(sheet.cardSenses).toHaveLength(2);
    expect((await listLeechCards()).map((l) => [l.term, l.lapses, l.card_type])).toEqual([['bank', 6, 'recognition']]);

    // Undo takes the flag back.
    await undoAnswer(sixth.log.id, five.t + 5 * DAY + 1000);
    expect(await getCardLapses(recognition.id)).toBe(5);
    expect(await listLeechCards()).toEqual([]);
  });
});

describe('split senses', () => {
  it('adds one recognition card per sense and keeps the history on the original', async () => {
    const { recognition, senses, note } = await bank();
    await forget(recognition.id, LEECH_LAPSES);
    const before = await logsSnapshot();
    const unlockedBefore = (await db.cards.where('note_id').equals(note.id).toArray())
      .filter((c) => c.card_type !== 'recognition')
      .map((c) => [c.id, c.unlocked]);

    const created = await splitSenses(recognition.id, T0 + 100 * DAY);
    expect(created).toHaveLength(2);
    const cards = await db.cards.where('note_id').equals(note.id).toArray();
    const per = cards.filter((c) => created.includes(c.id));
    expect(per.map((c) => c.sense_id).sort()).toEqual(senses.map((s) => s.id).sort());
    expect(per.every((c) => c.card_type === 'recognition' && c.reps === 0 && !c.suspended && c.unlocked)).toBe(true);
    const original = cards.find((c) => c.id === recognition.id)!;
    expect(original).toMatchObject({ suspended: true, deleted_at: null });
    expect(original.lapses).toBe(LEECH_LAPSES);
    // Logs untouched; production/cloze cards keep their lock state, also after a full replay.
    expect(await logsSnapshot()).toEqual(before);
    await recomputeAllCards();
    const after = (await db.cards.where('note_id').equals(note.id).toArray())
      .filter((c) => c.card_type !== 'recognition')
      .map((c) => [c.id, c.unlocked]);
    expect(after).toEqual(unlockedBefore);
    expect((await runIntegrityCheck()).ok).toBe(true);
    // The new cards are studied like any other (one card per note a day: the note's other
    // new cards are put aside here so the queue shows one of the split cards).
    for (const c of cards) if (c.card_type !== 'recognition') await db.cards.update(c.id, { suspended: true });
    const q = await getStudyQueue({}, T0 + 100 * DAY);
    expect(q.items.some((i) => created.includes(i.card_id))).toBe(true);
    // A second split has nothing to do.
    expect((await getLeechSheet(created[0]!))!.canSplit).toBe(false);
    await expect(splitSenses(recognition.id, T0 + 101 * DAY)).rejects.toMatchObject({ code: 'invalid_input' });

    await undoLeechAction(recognition.id, created, T0 + 102 * DAY);
    const back = await db.cards.where('note_id').equals(note.id).toArray();
    expect(back.find((c) => c.id === recognition.id)!.suspended).toBe(false);
    expect(back.filter((c) => created.includes(c.id)).every((c) => c.deleted_at !== null)).toBe(true);
  });

  it('a split card shows its own sense, never the rotation of the note', async () => {
    const { recognition, senses } = await bank();
    await forget(recognition.id, LEECH_LAPSES);
    const created = await splitSenses(recognition.id, T0 + 100 * DAY);
    const cards = await db.cards.bulkGet(created);
    for (const s of senses) {
      const card = cards.find((c) => c!.sense_id === s.id)!;
      const view = (await getCardView(card.id, T0 + 100 * DAY))!;
      expect(view.sense!.id).toBe(s.id);
      // Still its own sense after answers (the rotation would move on to the next one).
      await answerCard({ card_id: card.id, rating: Rating.Good, duration_ms: 3000 }, T0 + 100 * DAY);
      expect((await getCardView(card.id, T0 + 101 * DAY))!.sense!.id).toBe(s.id);
    }
  });
});

describe('reset', () => {
  it('suspends the old card, adds a fresh copy and never changes a log', async () => {
    const { recognition, production } = await bank();
    await forget(recognition.id, 1);
    // The production card has its own history and many lapses.
    await forget(production.id, LEECH_LAPSES, T0 + 10 * DAY);
    const before = await logsSnapshot();
    const copy = await resetCard(production.id, T0 + 200 * DAY);
    const old = (await db.cards.get(production.id)) as Card;
    expect(old).toMatchObject({ suspended: true, lapses: LEECH_LAPSES });
    expect(copy).toMatchObject({
      note_id: production.note_id,
      sense_id: production.sense_id,
      card_type: 'production',
      reps: 0,
      lapses: 0,
      suspended: false,
      unlocked: true, // the recognition card has reached Review
    });
    expect(await logsSnapshot()).toEqual(before);
    expect(await getCardLapses(copy.id)).toBe(0);
    expect(await listLeechCards()).toEqual([]);
    await recomputeAllCards();
    expect((await db.cards.get(copy.id))!.reps).toBe(0);
    expect((await runIntegrityCheck()).ok).toBe(true);

    await undoLeechAction(production.id, [copy.id], T0 + 201 * DAY);
    expect((await db.cards.get(production.id))!.suspended).toBe(false);
    expect((await db.cards.get(copy.id))!.deleted_at).not.toBeNull();
  });

  it('a reset recognition card hands the unlock rule to its fresh copy', async () => {
    const { recognition, production } = await bank();
    await forget(recognition.id, 2);
    expect((await db.cards.get(production.id))!.unlocked).toBe(true);
    const copy = await resetCard(recognition.id, T0 + 100 * DAY);
    expect(copy.state).toBe(0);
    // The production card has no history of its own: locked again until the copy is learned.
    expect((await db.cards.get(production.id))!.unlocked).toBe(false);
    await answerCard({ card_id: copy.id, rating: Rating.Easy, duration_ms: 1000 }, T0 + 100 * DAY + 1000);
    expect((await db.cards.get(production.id))!.unlocked).toBe(true);
  });
});
