// Progress tab ("Gelişim") on the local database.
import { beforeEach, describe, expect, it } from 'vitest';
import { Rating, type RatingValue } from '../domain/types';
import { resetDb } from '../test/db';
import { addNoteWithSenses, answerCard, createSource, softDeleteNote, undoAnswer } from './actions';
import { db } from './db';
import { setSourceTopics } from './profile';
import { getProgressView, loadRetentionInput } from './progress';
import { recordPractice } from './practice';
import { updateSettings } from './settings';

const T = Date.UTC(2026, 9, 21, 9);
const DAY = 86_400_000;

beforeEach(async () => {
  await resetDb();
  await updateSettings({ timezone: 'Europe/Istanbul' }, T - 60 * DAY);
});

async function cardsOf(noteId: string) {
  const cards = await db.cards.where('note_id').equals(noteId).toArray();
  return {
    rec: cards.find((c) => c.card_type === 'recognition')!,
    prod: cards.find((c) => c.card_type === 'production')!,
  };
}

const answer = (card_id: string, rating: RatingValue, at: number) =>
  answerCard({ card_id, rating, duration_ms: 3000 }, at);

describe('progress data', () => {
  it('gathers facts per card and counts only first answers to Review cards', async () => {
    const src = await createSource({ kind: 'text', title: 'Mutfak yazısı' }, T - 40 * DAY);
    await setSourceTopics(src.id, ['food'], T - 40 * DAY);
    const apple = await addNoteWithSenses(
      { term: 'apple', senses: [{ meaning_tr: 'elma', pos: 'Noun', source_id: src.id }] },
      T - 40 * DAY,
    );
    const gone = await addNoteWithSenses(
      { term: 'gone', senses: [{ meaning_tr: 'gitmiş' }] },
      T - 40 * DAY,
    );
    const a = await cardsOf(apple.note.id);
    const g = await cardsOf(gone.note.id);

    await answer(a.rec.id, Rating.Easy, T - 30 * DAY); // → Review (learned)
    await answer(a.prod.id, Rating.Easy, T - 30 * DAY + 60_000);
    const miss = await answer(a.rec.id, Rating.Again, T - 20 * DAY); // counted: miss
    await undoAnswer(miss.log.id, T - 20 * DAY + 1000); // …undone
    await answer(a.rec.id, Rating.Good, T - 20 * DAY + 2000); // counted: pass
    await answer(a.prod.id, Rating.Again, T - 15 * DAY); // counted: miss
    await answer(g.rec.id, Rating.Easy, T - 30 * DAY);
    await answer(g.rec.id, Rating.Again, T - 10 * DAY);
    await softDeleteNote(gone.note.id, T - 5 * DAY);
    // Practice answers never count.
    await recordPractice(
      { card_id: a.rec.id, result: 'unknown', mode: 'hard', session_id: 's', duration_ms: 1000 },
      T - 2 * DAY,
    );

    const input = await loadRetentionInput(T, null);
    expect([...input.facts.keys()].sort()).toEqual([a.rec.id, a.prod.id].sort());
    expect(input.facts.get(a.prod.id)).toMatchObject({
      note_id: apple.note.id,
      card_type: 'production',
      term_type: 'word',
      topics: ['food'],
      sources: [src.id],
      pos: ['noun'],
    });
    const events = input.data.events.filter((e) => input.facts.has(e.card_id));
    expect(events.map((e) => [e.card_id, e.passed])).toEqual([
      [a.rec.id, true],
      [a.prod.id, false],
    ]);

    const view = await getProgressView(T, null);
    expect(view.report.overall).toMatchObject({ n: 2, passed: 1, enough: false });
    expect(view.report.groups.source.map((x) => x.key)).toEqual([src.id]);
    expect(view.sourceTitles).toEqual({ [src.id]: 'Mutfak yazısı' });
    // apple was recalled on two days only: Pekişiyor, not learned yet (ADR 0041).
    expect(view.report.series.at(-1)!.learnedTotal).toBe(0);
    expect(input.facts.get(a.rec.id)?.learned_day).toBeNull();
    expect(view.gapNoteIds).toEqual([]);
  });
});
