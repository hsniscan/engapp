import { describe, expect, it } from 'vitest';
import { makeCard } from '../test/factories';
import { cardStageDistribution, countWordStages, WEEK_MS } from './wordStages';
import { CardState, type Card, type Note, type NoteTermType } from './types';

const NOW = Date.UTC(2027, 2, 1, 12);
const DAY = 86_400_000;

const note = (id: string, term_type: NoteTermType = 'word', deleted_at: number | null = null) =>
  ({ id, term_type, deleted_at }) as Pick<Note, 'id' | 'term_type' | 'deleted_at'>;

const learnedFields = { state: CardState.Review, ramp_step: 3, stability: 20 } as const;
const masteredFields = { state: CardState.Review, ramp_step: 5, stability: 120 } as const;
const consolidatingFields = { state: CardState.Review, ramp_step: 1, stability: 6 } as const;

function rec(noteId: string, over: Partial<Card> = {}): Card {
  return makeCard({ id: `rec-${noteId}`, note_id: noteId, card_type: 'recognition', ...over });
}

describe('countWordStages ("Öğrendiğin kelime")', () => {
  it('counts words by their recognition card, not cards', () => {
    const notes = [note('a'), note('b'), note('c'), note('d'), note('e')];
    const cards = [
      rec('a', { ...learnedFields, learned_at: NOW - 2 * DAY }),
      // Production, cloze and picture cards of a word never add to the count.
      makeCard({ note_id: 'a', card_type: 'production', sense_id: 's', ...learnedFields }),
      makeCard({ note_id: 'a', card_type: 'cloze', sense_id: 's', ...learnedFields }),
      makeCard({ note_id: 'a', card_type: 'image', sense_id: 's', ...learnedFields }),
      rec('b', { ...masteredFields, learned_at: NOW - 30 * DAY }),
      rec('c', consolidatingFields),
      // Only the production card is learned: not a learned word.
      rec('d', { state: CardState.Learning }),
      makeCard({ note_id: 'd', card_type: 'production', sense_id: 's2', ...learnedFields }),
      rec('e'),
    ];
    const known = [{ deleted_at: null }, { deleted_at: null }, { deleted_at: NOW }];
    expect(countWordStages(notes, cards, known, NOW)).toEqual({
      new: 1,
      learning: 1,
      consolidating: 1,
      learned: 1,
      mastered: 1,
      learnedTotal: 2,
      weekDelta: 1,
      active: 2,
      alreadyKnown: 2,
    });
  });

  it('"Biliyorum" known terms never count as learned', () => {
    const c = countWordStages([], [], [{ deleted_at: null }], NOW);
    expect(c.learnedTotal).toBe(0);
    expect(c.alreadyKnown).toBe(1);
  });

  it('leaves out affix roots, contrast notes, deleted notes and deleted cards; suspended words count', () => {
    const notes = [note('a', 'affix'), note('b', 'contrast'), note('c', 'word', NOW), note('d', 'phrase'), note('e', 'pattern'), note('f')];
    const cards = [
      rec('a', learnedFields),
      rec('b', learnedFields),
      rec('c', learnedFields),
      rec('d', { ...learnedFields, suspended: true }),
      rec('e', learnedFields),
      rec('f', { ...learnedFields, deleted_at: NOW }),
    ];
    expect(countWordStages(notes, cards, [], NOW).learnedTotal).toBe(2);
  });

  it('this week = first reached Öğrenildi in the last 7 days, even if forgotten since', () => {
    const notes = [note('a'), note('b'), note('c')];
    const cards = [
      rec('a', { ...learnedFields, learned_at: NOW - WEEK_MS + 1 }),
      rec('b', { ...learnedFields, learned_at: NOW - WEEK_MS }),
      rec('c', { state: CardState.Relearning, ramp_step: 1, stability: 3, learned_at: NOW - DAY }),
    ];
    const c = countWordStages(notes, cards, [], NOW);
    expect(c.weekDelta).toBe(2);
    expect(c.learnedTotal).toBe(2);
  });

  it('uses the primary recognition card when a split added per-sense ones', () => {
    const cards = [
      rec('a', consolidatingFields),
      makeCard({ id: 'split', note_id: 'a', card_type: 'recognition', sense_id: 's1', ...learnedFields }),
    ];
    expect(countWordStages([note('a')], cards, [], NOW).consolidating).toBe(1);
  });
});

describe('cardStageDistribution (one bar per study mode)', () => {
  it('counts the cards of the mode, live and unlocked', () => {
    const cards = [
      makeCard({ note_id: 'a', card_type: 'production', sense_id: 's', unlocked: true, ...learnedFields }),
      makeCard({ note_id: 'a', card_type: 'image', sense_id: 's', unlocked: true }),
      makeCard({ note_id: 'b', card_type: 'production', sense_id: 's', unlocked: false }),
      makeCard({ note_id: 'c', card_type: 'production', sense_id: 's', unlocked: true, deleted_at: NOW }),
      makeCard({ note_id: 'a', card_type: 'recognition', ...consolidatingFields }),
    ];
    expect(cardStageDistribution(cards, ['production', 'image'])).toEqual({ new: 1, learning: 0, consolidating: 0, learned: 1, mastered: 0 });
    expect(cardStageDistribution(cards, ['recognition'])).toEqual({ new: 0, learning: 0, consolidating: 1, learned: 0, mastered: 0 });
  });
});
