import { describe, expect, it } from 'vitest';
import { type ChoiceCandidate, pickClozeChoices } from './clozeChoices';

const c = (term: string, pos: string | null = 'adverb'): ChoiceCandidate => ({ term, pos, meaning: null });

describe('pickClozeChoices', () => {
  const answer = c('eventually');
  const pool = [c('recently'), c('rarely'), c('immediately'), c('table', 'noun'), c('Eventually'), c('give up', 'verb')];

  it('gives the answer and three distinct distractors', () => {
    const choices = pickClozeChoices(answer, pool, 'card-1')!;
    expect(choices).toHaveLength(4);
    expect(choices.filter((x) => x.correct).map((x) => x.term)).toEqual(['eventually']);
    const terms = choices.map((x) => x.term.toLowerCase());
    expect(new Set(terms).size).toBe(4);
    expect(terms).not.toContain('give up');
  });

  it('prefers the same part of speech', () => {
    const choices = pickClozeChoices(answer, pool, 'card-1')!;
    expect(choices.filter((x) => !x.correct).map((x) => x.term).sort()).toEqual(['immediately', 'rarely', 'recently']);
  });

  it('is deterministic for a seed', () => {
    expect(pickClozeChoices(answer, pool, 's')).toEqual(pickClozeChoices(answer, pool, 's'));
  });

  it('returns null when the collection is too small', () => {
    expect(pickClozeChoices(answer, [c('rarely'), c('eventually')], 's')).toBeNull();
  });
});
