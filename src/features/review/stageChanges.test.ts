// "Aşama değişenler" on the session summary (v0.5.2, ADR 0066): words whose stage went up.
import { beforeEach, describe, expect, it } from 'vitest';
import { addNoteWithSenses, db, ensureSettings, getCardView, type CardView } from '@/data';
import type { WordStage } from '@/domain/stages';
import { Rating, type RatingValue } from '@/domain/types';
import { resetDb } from '@/test/db';
import { stageChanges } from './study';
import type { SessionAnswer } from './useReviewSession';

const T = Date.UTC(2026, 10, 2, 9);

async function viewOf(term: string, type = 'recognition'): Promise<CardView> {
  const note = (await db.notes.toArray()).find((n) => n.term === term)!;
  const card = (await db.cards.where('note_id').equals(note.id).toArray()).find(
    (c) => c.card_type === type,
  )!;
  return (await getCardView(card.id, T))!;
}

/** An answer whose scheduler preview says the word ends at `after`. */
function answer(view: CardView, rating: RatingValue, after: WordStage): SessionAnswer {
  const previews = { ...view.previews, [rating]: { ...view.previews[rating], stageAfter: after } };
  return {
    cardId: view.card.id,
    kind: 'new',
    rating,
    durationMs: 3000,
    logId: null,
    view: { ...view, previews } as CardView,
  };
}

beforeEach(async () => {
  await resetDb();
  await ensureSettings(T);
  await addNoteWithSenses({ term: 'hinder', senses: [{ meaning_tr: 'engellemek' }] }, T);
  await addNoteWithSenses({ term: 'cope', senses: [{ meaning_tr: 'başa çıkmak' }] }, T);
});

describe('stageChanges', () => {
  it('lists words that moved up, by their last answer, recognition cards only', async () => {
    const hinder = await viewOf('hinder');
    const cope = await viewOf('cope');
    const copeProduction = await viewOf('cope', 'production');
    const list = stageChanges([
      answer(hinder, Rating.Good, 'learning'),
      answer(cope, Rating.Again, 'new'),
      answer(copeProduction, Rating.Easy, 'mastered'),
      answer(hinder, Rating.Easy, 'consolidating'),
    ]);
    expect(list).toEqual([
      { noteId: hinder.note.id, term: 'hinder', from: 'new', to: 'consolidating' },
    ]);
  });
});
