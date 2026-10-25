import { describe, expect, it } from 'vitest';
import { checkAnswer, diffLetters, editDistance, normalizeAnswer, suggestRating } from './answerCheck';
import { Rating } from './types';

describe('normalizeAnswer', () => {
  it('trims, lowercases and straightens apostrophes', () => {
    expect(normalizeAnswer('  Don’t   Mind ')).toBe("don't mind");
  });
});

describe('diffLetters', () => {
  it('marks a substituted letter', () => {
    expect(diffLetters('reluctent', 'reluctant').filter((o) => o.kind !== 'same')).toEqual([
      { kind: 'sub', typed: 'e', expected: 'a' },
    ]);
  });

  it('marks missing and extra letters', () => {
    expect(diffLetters('adress', 'address').filter((o) => o.kind !== 'same')).toEqual([
      { kind: 'missing', expected: 'd' },
    ]);
    expect(diffLetters('acommmodate', 'acommodate').filter((o) => o.kind !== 'same')).toEqual([
      { kind: 'extra', typed: 'm' },
    ]);
  });

  it('rebuilds both strings from the operations', () => {
    const ops = diffLetters('recieve', 'receive');
    const typed = ops.map((o) => (o.kind === 'same' ? o.ch : o.kind === 'missing' ? '' : o.typed)).join('');
    const expected = ops.map((o) => (o.kind === 'same' ? o.ch : o.kind === 'extra' ? '' : o.expected)).join('');
    expect(typed).toBe('recieve');
    expect(expected).toBe('receive');
    expect(editDistance('recieve', 'receive')).toBe(2);
  });
});

describe('checkAnswer', () => {
  it('accepts the exact term in any case', () => {
    expect(checkAnswer(' Reluctant ', 'reluctant').verdict).toBe('correct');
  });

  it('calls one letter off "close"', () => {
    const c = checkAnswer('reluctent', 'reluctant');
    expect(c.verdict).toBe('close');
    expect(c.distance).toBe(1);
  });

  it('allows two letters off in long words only', () => {
    expect(checkAnswer('recieve', 'receive').verdict).toBe('wrong');
    expect(checkAnswer('acomodation', 'accommodation').verdict).toBe('close');
  });

  it('accepts a verb with or without "to"', () => {
    expect(checkAnswer('go', 'to go').verdict).toBe('correct');
  });

  it('treats an empty answer as skipped', () => {
    expect(checkAnswer('  ', 'cat').verdict).toBe('skipped');
  });

  it('never calls a one-letter answer close', () => {
    expect(checkAnswer('a', 'an').verdict).toBe('wrong');
  });
});

describe('suggestRating', () => {
  it('maps verdicts to buttons', () => {
    expect(suggestRating('correct', false)).toBe(Rating.Good);
    expect(suggestRating('correct', true)).toBe(Rating.Hard);
    expect(suggestRating('close', false)).toBe(Rating.Hard);
    expect(suggestRating('wrong', false)).toBe(Rating.Again);
    expect(suggestRating('skipped', true)).toBe(Rating.Again);
  });
});
