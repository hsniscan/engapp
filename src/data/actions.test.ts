import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from '../test/db';
import { CardState, Rating, type Card } from '../domain/types';
import {
  addNoteWithSenses,
  answerCard,
  editNote,
  editSense,
  getLastUndoableAnswer,
  setSuspended,
  softDeleteNote,
  softDeleteSense,
  undoAnswer,
} from './actions';
import { db } from './db';
import { ActionError } from './errors';
import { getCardView, getStudyQueue, findNoteByTerm, getHomeSummary } from './queries';
import { updateSettings } from './settings';
import { rebuildDailyActivity } from './dailyActivity';

// 2026-10-21 12:00 Istanbul (UTC+3, no DST).
const T = Date.UTC(2026, 9, 21, 9);
const MIN = 60_000;
const sentence = 'We walked along the river bank at dusk.';

beforeEach(async () => {
  await resetDb();
  await updateSettings({ timezone: 'Europe/Istanbul' }, T - 86_400_000 * 10);
});

async function cardsOf(noteId: string): Promise<Card[]> {
  return db.cards.where('note_id').equals(noteId).toArray();
}

describe('addNoteWithSenses', () => {
  it('creates note, senses, recognition + production cards and cloze only with a valid span', async () => {
    const r = await addNoteWithSenses(
      {
        term: '  Bank ',
        tags: ['geo'],
        senses: [
          { meaning_tr: 'kıyı', source_sentence: sentence, span: [26, 30] },
          { meaning_tr: 'banka', source_sentence: 'Bad span.', span: [5, 50] },
        ],
      },
      T,
    );
    expect(r.status).toBe('created');
    expect(r.note).toMatchObject({ term: 'Bank', term_norm: 'bank', term_type: 'word', tags: ['geo'] });
    expect(r.addedSenses.map((s) => [s.sense_no, s.span])).toEqual([
      [1, [26, 30]],
      [2, null],
    ]);
    const cards = await cardsOf(r.note.id);
    const types = cards.map((c) => c.card_type).sort();
    expect(types).toEqual(['cloze', 'production', 'production', 'recognition']);
    for (const c of cards) {
      expect(c.state).toBe(CardState.New);
      expect(c.unlocked).toBe(c.card_type === 'recognition');
    }
  });

  it('adds a new sense to the existing note and skips known senses', async () => {
    const a = await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka', lexicon_sense_id: 'L1' }] }, T);
    const b = await addNoteWithSenses(
      {
        term: 'BANK',
        senses: [
          { meaning_tr: 'other words', lexicon_sense_id: 'L1' },
          { meaning_tr: 'Banka ' },
          { meaning_tr: 'kıyı' },
        ],
      },
      T + 1,
    );
    expect(b.status).toBe('existing');
    expect(b.note.id).toBe(a.note.id);
    expect(b.skippedSenses).toHaveLength(2);
    expect(b.addedSenses.map((s) => [s.meaning_tr, s.sense_no])).toEqual([['kıyı', 2]]);
    expect((await cardsOf(a.note.id)).filter((c) => c.card_type === 'recognition')).toHaveLength(1);
  });

  it('new senses start unlocked when recognition is already in Review', async () => {
    const a = await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] }, T);
    const rec = (await cardsOf(a.note.id)).find((c) => c.card_type === 'recognition')!;
    await answerCard({ card_id: rec.id, rating: Rating.Easy, duration_ms: 1000 }, T + MIN);
    const b = await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'kıyı' }] }, T + 2 * MIN);
    expect(b.createdCards.every((c) => c.unlocked)).toBe(true);
  });

  it('reactivates a soft-deleted note with the same term', async () => {
    const a = await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] }, T);
    await softDeleteNote(a.note.id, T + 1);
    expect(await findNoteByTerm('bank')).toBeNull();
    const b = await addNoteWithSenses({ term: 'Bank', senses: [{ meaning_tr: 'banka' }, { meaning_tr: 'kıyı' }] }, T + 2);
    expect(b.status).toBe('reactivated');
    expect(b.note.id).toBe(a.note.id);
    expect(b.note.deleted_at).toBeNull();
    const live = (await cardsOf(a.note.id)).filter((c) => c.deleted_at === null);
    expect(live.map((c) => c.card_type).sort()).toEqual(['production', 'production', 'recognition']);
    const senses = (await db.senses.where('note_id').equals(a.note.id).toArray()).filter((s) => !s.deleted_at);
    expect(senses.map((s) => s.sense_no).sort()).toEqual([1, 2]);
  });

  it('rejects empty input', async () => {
    await expect(addNoteWithSenses({ term: '  ', senses: [] }, T)).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(addNoteWithSenses({ term: 'x', senses: [{ meaning_tr: ' ' }] }, T)).rejects.toBeInstanceOf(ActionError);
  });
});

describe('answerCard and undo', () => {
  it('writes the log, updates the card and daily_activity in one go', async () => {
    const a = await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] }, T);
    const rec = (await cardsOf(a.note.id)).find((c) => c.card_type === 'recognition')!;
    const before = await db.outbox.count();
    const r = await answerCard({ card_id: rec.id, rating: Rating.Good, duration_ms: 90_000 }, T + MIN);
    expect(r.log).toMatchObject({ card_id: rec.id, rating: 3, duration_ms: 60_000, undo_of: null, reviewed_at: T + MIN });
    expect(r.card.state).toBe(CardState.Learning);
    expect(r.day).toMatchObject({ date: '2026-10-21', reviews: 1, new_cards: 1, time_ms: 60_000, completed: false });
    expect(await db.outbox.count()).toBe(before + 2);
    expect(await db.daily_activity.get('2026-10-21')).toEqual(r.day);
  });

  it('unlocks production/cloze when recognition reaches Review; undo locks them again', async () => {
    const a = await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'kıyı', source_sentence: sentence, span: [26, 30] }] }, T);
    const rec = (await cardsOf(a.note.id)).find((c) => c.card_type === 'recognition')!;
    const first = await answerCard({ card_id: rec.id, rating: Rating.Good, duration_ms: 1000 }, T + MIN);
    expect(first.unlockedCardIds).toEqual([]);
    const second = await answerCard({ card_id: rec.id, rating: Rating.Good, duration_ms: 1000 }, T + 12 * MIN);
    expect(second.card.state).toBe(CardState.Review);
    expect(second.unlockedCardIds).toHaveLength(2);
    expect((await cardsOf(a.note.id)).every((c) => c.unlocked)).toBe(true);

    const last = await getLastUndoableAnswer(T + 13 * MIN);
    expect(last?.id).toBe(second.log.id);
    const undone = await undoAnswer(second.log.id, T + 13 * MIN);
    expect(undone.card).toMatchObject({ state: first.card.state, due: first.card.due, reps: first.card.reps });
    const after = await cardsOf(a.note.id);
    expect(after.filter((c) => c.card_type !== 'recognition').every((c) => !c.unlocked)).toBe(true);
    expect(await db.daily_activity.get('2026-10-21')).toMatchObject({ reviews: 1, new_cards: 1 });
    await expect(undoAnswer(second.log.id, T + 14 * MIN)).rejects.toMatchObject({ code: 'already_undone' });
    const undoRow = (await db.review_logs.toArray()).find((l) => l.undo_of === second.log.id)!;
    await expect(undoAnswer(undoRow.id, T + 14 * MIN)).rejects.toMatchObject({ code: 'not_undoable' });
    // The original log is untouched.
    expect(await db.review_logs.get(second.log.id)).toEqual(second.log);
    expect(await getLastUndoableAnswer(T + 14 * MIN)).toMatchObject({ id: first.log.id });
  });

  it('marks the day completed once nothing studied is left due', async () => {
    const a = await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] }, T);
    const rec = (await cardsOf(a.note.id)).find((c) => c.card_type === 'recognition')!;
    const r1 = await answerCard({ card_id: rec.id, rating: Rating.Good, duration_ms: 1000 }, T);
    expect(r1.day.completed).toBe(false); // 10-minute step still due today
    const r2 = await answerCard({ card_id: rec.id, rating: Rating.Easy, duration_ms: 1000 }, T + 10 * MIN);
    expect(r2.day.completed).toBe(true);
    // Incremental cache equals a full rebuild.
    const rebuilt = await rebuildDailyActivity(T + 11 * MIN);
    expect(rebuilt).toEqual([r2.day]);
  });

  it('records the shown sense and rotates recognition sentences', async () => {
    const a = await addNoteWithSenses(
      {
        term: 'bank',
        senses: [
          { meaning_tr: 'banka', source_sentence: 'The bank is closed.' },
          { meaning_tr: 'kıyı', source_sentence: sentence },
        ],
      },
      T,
    );
    const rec = (await cardsOf(a.note.id)).find((c) => c.card_type === 'recognition')!;
    const v1 = (await getCardView(rec.id, T))!;
    expect(v1.sense?.meaning_tr).toBe('banka');
    expect(v1.previews[Rating.Good].label).toBe('10 dk');
    await answerCard({ card_id: rec.id, rating: Rating.Good, duration_ms: 1, shown_sense_id: v1.sense!.id }, T);
    const v2 = (await getCardView(rec.id, T + MIN))!;
    expect(v2.sense?.meaning_tr).toBe('kıyı');
  });

  it('getCardView builds cloze and production hints', async () => {
    const a = await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'kıyı', source_sentence: sentence, span: [26, 30] }] }, T);
    const cards = await cardsOf(a.note.id);
    const cloze = (await getCardView(cards.find((c) => c.card_type === 'cloze')!.id, T))!;
    expect(cloze.cloze?.masked).toBe('We walked along the river _____ at dusk.');
    const prod = (await getCardView(cards.find((c) => c.card_type === 'production')!.id, T))!;
    expect(prod.hint).toBe('b___');
  });
});

describe('editing and deleting', () => {
  it('editSense adds and removes the cloze card', async () => {
    const a = await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'kıyı' }] }, T);
    const sense = a.addedSenses[0]!;
    await editSense(sense.id, { source_sentence: sentence, span: [26, 30] }, T + 1);
    let cloze = (await cardsOf(a.note.id)).find((c) => c.card_type === 'cloze');
    expect(cloze?.deleted_at).toBeNull();
    expect(cloze?.unlocked).toBe(false);
    await expect(editSense(sense.id, { span: [0, 999] }, T + 2)).rejects.toMatchObject({ code: 'invalid_input' });
    await editSense(sense.id, { source_sentence: null }, T + 3);
    cloze = (await cardsOf(a.note.id)).find((c) => c.card_type === 'cloze');
    expect(cloze?.deleted_at).toBe(T + 3);
    expect((await db.senses.get(sense.id))!.span).toBeNull();
    await editSense(sense.id, { source_sentence: sentence, span: [26, 30], meaning_tr_override: 'nehir kıyısı' }, T + 4);
    const clozes = (await cardsOf(a.note.id)).filter((c) => c.card_type === 'cloze');
    expect(clozes).toHaveLength(1);
    expect(clozes[0]!.deleted_at).toBeNull();
  });

  it('editNote renames with duplicate check', async () => {
    const a = await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] }, T);
    await addNoteWithSenses({ term: 'shore', senses: [{ meaning_tr: 'kıyı' }] }, T);
    const n = await editNote(a.note.id, { term: 'river  bank', tags: ['a', 'a', ' b '] }, T + 1);
    expect(n).toMatchObject({ term: 'river bank', term_norm: 'river bank', tags: ['a', 'b'] });
    await expect(editNote(a.note.id, { term: 'Shore' }, T + 2)).rejects.toMatchObject({ code: 'duplicate_term' });
  });

  it('softDeleteNote cascades to senses and cards; softDeleteSense to its cards', async () => {
    const a = await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }, { meaning_tr: 'kıyı', source_sentence: sentence, span: [26, 30] }] }, T);
    await softDeleteSense(a.addedSenses[1]!.id, T + 1);
    const live = (await cardsOf(a.note.id)).filter((c) => c.deleted_at === null);
    expect(live.map((c) => c.card_type).sort()).toEqual(['production', 'recognition']);
    await softDeleteNote(a.note.id, T + 2);
    expect((await cardsOf(a.note.id)).every((c) => c.deleted_at !== null)).toBe(true);
    expect((await db.senses.toArray()).every((s) => s.deleted_at !== null)).toBe(true);
    const deletes = (await db.outbox.toArray()).filter((o) => o.op === 'delete');
    expect(deletes.length).toBe(1 + 2 + 2 + 2); // note, 2 senses, cloze+production of sense 2, recognition+production of sense 1
  });

  it('suspend hides cards from the queue', async () => {
    const a = await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] }, T);
    expect((await getStudyQueue({}, T)).counts.new).toBe(1);
    expect(await setSuspended({ note_id: a.note.id }, true, T)).toBe(2);
    expect((await getStudyQueue({}, T)).counts.new).toBe(0);
    await setSuspended({ card_ids: (await cardsOf(a.note.id)).map((c) => c.id) }, false, T);
    expect((await getStudyQueue({}, T)).counts.new).toBe(1);
  });
});

describe('study queue from the database', () => {
  it('daily new limit counts cards introduced today; siblings are buried', async () => {
    await updateSettings({ daily_new_limit: 3 }, T);
    for (let i = 0; i < 5; i++) await addNoteWithSenses({ term: `word${i}`, senses: [{ meaning_tr: `anlam${i}` }] }, T + i);
    let q = await getStudyQueue({}, T + MIN);
    expect(q.counts.new).toBe(3);
    const answeredNote = q.items[0]!.note_id;
    const r = await answerCard({ card_id: q.items[0]!.card_id, rating: Rating.Easy, duration_ms: 1 }, T + MIN);
    expect(r.unlockedCardIds).toHaveLength(1);
    q = await getStudyQueue({}, T + 2 * MIN);
    expect(q.newToday).toBe(1);
    expect(q.counts.new).toBe(2);
    // The answered recognition card graduated; its production card is unlocked but buried today.
    expect(q.items.some((i) => i.note_id === answeredNote)).toBe(false);
    expect((await getStudyQueue({}, T + 86_400_000)).items.some((i) => i.card_id === r.unlockedCardIds[0])).toBe(true);
    const home = await getHomeSummary(T + 2 * MIN);
    expect(home.doneToday).toBe(1);
    expect(home.plannedToday).toBe(3);
    expect(home.streak).toMatchObject({ todayActive: true, currentStreak: 1 });
    // Next day (after 04:00) the limit resets.
    q = await getStudyQueue({}, T + 86_400_000);
    expect(q.counts.new).toBe(3);
  });

  it('a 03:59 answer belongs to the previous day', async () => {
    await addNoteWithSenses({ term: 'a', senses: [{ meaning_tr: 'x' }] }, T);
    const q = await getStudyQueue({}, T);
    const at0359 = Date.UTC(2026, 9, 22, 0, 59); // 03:59 Istanbul on 10-22
    const r = await answerCard({ card_id: q.items[0]!.card_id, rating: Rating.Good, duration_ms: 1 }, at0359);
    expect(r.day.date).toBe('2026-10-21');
  });

  it('learning cards re-enter the queue when due', async () => {
    const a = await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] }, T);
    const rec = (await cardsOf(a.note.id)).find((c) => c.card_type === 'recognition')!;
    await answerCard({ card_id: rec.id, rating: Rating.Again, duration_ms: 1 }, T);
    const soon = await getStudyQueue({ learnAheadMs: 0 }, T + 30_000);
    expect(soon.items).toHaveLength(0);
    expect(soon.nextLearningDue).toBe(T + MIN);
    const later = await getStudyQueue({ learnAheadMs: 0 }, T + MIN);
    expect(later.items.map((i) => [i.card_id, i.kind])).toEqual([[rec.id, 'learning']]);
  });

  it('builds the queue for 1,000 cards well under a second', async () => {
    const cards: Card[] = [];
    for (let i = 0; i < 1000; i++) {
      cards.push({
        id: `c${String(i).padStart(4, '0')}`,
        user_id: null,
        created_at: T - 1e9,
        updated_at: T,
        deleted_at: null,
        hlc: 'h',
        note_id: `n${i}`,
        sense_id: null,
        card_type: 'recognition',
        suspended: false,
        unlocked: true,
        due: i % 4 === 0 ? T - 1e9 : T - i * MIN,
        stability: 5,
        difficulty: 5,
        elapsed_days: 1,
        scheduled_days: 1,
        learning_steps: 0,
        reps: i % 4 === 0 ? 0 : 3,
        lapses: 0,
        state: i % 4 === 0 ? CardState.New : CardState.Review,
        last_review: i % 4 === 0 ? null : T - 2e8,
      });
    }
    await db.cards.bulkAdd(cards);
    const t0 = performance.now();
    const q = await getStudyQueue({}, T);
    const elapsed = performance.now() - t0;
    expect(q.counts.review).toBe(750);
    expect(q.counts.new).toBe(10);
    expect(elapsed).toBeLessThan(1000);
  });
});
