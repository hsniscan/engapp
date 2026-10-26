import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  acceptedForms,
  checkAnswer,
  closeLimit,
  diffLetters,
  editDistance,
  foldAnswer,
  matchesAny,
  normalizeAnswer,
  suggestRating,
} from './answerCheck';
import { Rating } from './types';

const verdict = (typed: string, term: string, synonyms?: string[]) =>
  checkAnswer(typed, term, synonyms ? { synonyms } : {}).verdict;

describe('normalizeAnswer', () => {
  it('trims, lowercases and straightens apostrophes', () => {
    expect(normalizeAnswer('  Don’t   Mind ')).toBe("don't mind");
  });
});

describe('foldAnswer', () => {
  it('drops accents, apostrophes and edge punctuation', () => {
    expect(foldAnswer('Café')).toBe('cafe');
    expect(foldAnswer('naïve')).toBe('naive');
    expect(foldAnswer("Don't!")).toBe('dont');
    expect(foldAnswer('well-known.')).toBe('well known');
  });

  it('reads Turkish keyboard letters as English ones', () => {
    expect(foldAnswer('thınk')).toBe('think');
    expect(foldAnswer('İnteresting')).toBe('interesting');
    expect(foldAnswer('ŞHİP')).toBe('ship');
    expect(foldAnswer('çheap')).toBe('cheap');
    expect(foldAnswer('ğood')).toBe('good');
    expect(foldAnswer('öpen')).toBe('open');
    expect(foldAnswer('üse')).toBe('use');
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
    const typed = ops
      .map((o) => (o.kind === 'same' ? o.ch : o.kind === 'missing' ? '' : o.typed))
      .join('');
    const expected = ops
      .map((o) => (o.kind === 'same' ? o.ch : o.kind === 'extra' ? '' : o.expected))
      .join('');
    expect(typed).toBe('recieve');
    expect(expected).toBe('receive');
  });

  it('does not mark a letter that differs only by its accent', () => {
    expect(diffLetters('thınk', 'think').every((o) => o.kind === 'same')).toBe(true);
  });
});

describe('editDistance (Damerau–Levenshtein)', () => {
  it('counts a swap of two neighbours as one edit', () => {
    expect(editDistance('recieve', 'receive')).toBe(1);
    expect(editDistance('thier', 'their')).toBe(1);
    expect(editDistance('adress', 'address')).toBe(1);
  });
});

describe('closeLimit', () => {
  it('allows no typo in 1–2 letters, one up to 7 letters, two from 8', () => {
    expect(closeLimit('go')).toBe(0);
    expect(closeLimit('cat')).toBe(1);
    expect(closeLimit('house')).toBe(1);
    expect(closeLimit('receive')).toBe(1);
    expect(closeLimit('separate')).toBe(2);
  });
});

describe('checkAnswer: exact', () => {
  it.each([
    [' Reluctant ', 'reluctant'],
    ['LONDON', 'London'],
    ['cafe', 'café'],
    ['naive', 'naïve'],
    ['dont mind', "don't mind"],
    ['don’t mind', "don't mind"],
    ['well known', 'well-known'],
    ['cat.', 'cat'],
    ['cat!', 'cat'],
    ['go', 'to go'],
    ['to go', 'go'],
    ['the cat', 'cat'],
    ['cat', 'a cat'],
    ['an apple', 'apple'],
    ['take care of', 'take care of sb'],
    ['look after someone', 'look after sb'],
    ['make up your mind', 'make up your mind'],
    ['aware of', '(be) aware of'],
    ['be aware of', '(be) aware of'],
    ['lay', 'lie/lay'],
    // A Turkish keyboard: dotless ı, İ and the other Turkish letters.
    ['thınk', 'think'],
    ['İsland', 'island'],
    ['ınteresting', 'interesting'],
    ['şhip', 'ship'],
  ])('%s = %s', (typed, term) => {
    expect(verdict(typed, term)).toBe('correct');
  });

  it.each([
    ['color', 'colour'],
    ['colour', 'color'],
    ['honor', 'honour'],
    ['neighbor', 'neighbour'],
    ['behaviour', 'behavior'],
    ['realize', 'realise'],
    ['organisation', 'organization'],
    ['analyze', 'analyse'],
    ['center', 'centre'],
    ['theatre', 'theater'],
    ['traveled', 'travelled'],
    ['cancelling', 'canceling'],
    ['catalog', 'catalogue'],
    ['dialogue', 'dialog'],
    ['defense', 'defence'],
    ['licence', 'license'],
  ])('British/American spelling: %s = %s', (typed, term) => {
    expect(verdict(typed, term)).toBe('correct');
  });

  it('keeps the general rules from accepting other words', () => {
    expect(verdict('four', 'for')).not.toBe('correct');
    expect(verdict('watre', 'water')).not.toBe('correct');
    expect(verdict('dogue', 'dog')).not.toBe('correct');
    expect(acceptedForms('for')).toEqual(['for']);
  });
});

describe('checkAnswer: neredeyse (typical Turkish-learner typos)', () => {
  it.each([
    ['recieve', 'receive'], // ie / ei swap
    ['beleive', 'believe'],
    ['thier', 'their'],
    ['wich', 'which'], // a silent letter left out
    ['wether', 'whether'],
    ['becouse', 'because'], // spelled as heard
    ['tomorow', 'tomorrow'], // one double letter
    ['ocasion', 'occasion'],
    ['adress', 'address'],
    ['begining', 'beginning'],
    ['occured', 'occurred'],
    ['neccessary', 'necessary'],
    ['embarass', 'embarrass'],
    ['seperate', 'separate'],
    ['definately', 'definitely'],
    ['enviroment', 'environment'],
    ['goverment', 'government'],
    ['acomodation', 'accommodation'], // two letters in a long word
    ['acommodation', 'accommodation'],
    ['reluctent', 'reluctant'],
    ['knowlege', 'knowledge'],
    ['wierd', 'weird'],
    ['freind', 'friend'],
    ['kar', 'car'], // a Turkish letter for the sound
    ['şugr', 'sugar'],
    ['tenk', 'tank'],
    ['tek care of', 'take care of sb'],
  ])('%s ≈ %s', (typed, term) => {
    expect(verdict(typed, term)).toBe('close');
  });

  it('reports the number of letters', () => {
    expect(checkAnswer('reluctent', 'reluctant')).toMatchObject({ verdict: 'close', distance: 1 });
    expect(checkAnswer('acomodation', 'accommodation')).toMatchObject({ verdict: 'close', distance: 2 });
  });

  it('every one-letter typo in a word of five letters or more is neredeyse (criterion 8)', () => {
    const words = ['house', 'answer', 'reluctant', 'beautiful', 'knowledge', 'weather', 'business', 'opinion'];
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    fc.assert(
      fc.property(
        fc.constantFrom(...words),
        fc.nat(),
        fc.constantFrom('sub', 'ins', 'del', 'swap'),
        fc.constantFrom(...letters),
        (word, pos, op, ch) => {
          const i = pos % word.length;
          let typo: string;
          if (op === 'sub') typo = word.slice(0, i) + ch + word.slice(i + 1);
          else if (op === 'ins') typo = word.slice(0, i) + ch + word.slice(i);
          else if (op === 'del') typo = word.slice(0, i) + word.slice(i + 1);
          else {
            const j = Math.min(i, word.length - 2);
            typo = word.slice(0, j) + word[j + 1] + word[j] + word.slice(j + 2);
          }
          const v = verdict(typo, word);
          return typo === word ? v === 'correct' : v === 'close';
        },
      ),
      { numRuns: 2000 },
    );
  });

  it('two typos in a short word are wrong, not neredeyse', () => {
    expect(verdict('hoese', 'house')).toBe('close');
    expect(verdict('hoesa', 'house')).toBe('wrong');
  });
});

describe('checkAnswer: wrong and skipped', () => {
  it.each([
    ['go', 'do'], // two letters: no typo allowed
    ['a', 'an'],
    ['biznis', 'business'], // Turkish phonetic spelling, too far
    ['ofis', 'office'],
    ['dog', 'cat'],
    ['zzzz', 'reluctant'],
  ])('%s ≠ %s', (typed, term) => {
    expect(verdict(typed, term)).toBe('wrong');
  });

  it('treats an empty answer as skipped', () => {
    expect(verdict('  ', 'cat')).toBe('skipped');
    expect(verdict('...', 'cat')).toBe('skipped');
  });

  it('shows the shorter form when only it was near', () => {
    expect(checkAnswer('goo', 'to go').expected).toBe('go');
    expect(checkAnswer('dont mnd', "don't mind").expected).toBe("don't mind");
  });
});

describe('checkAnswer: synonyms', () => {
  it('accepts another word for the same meaning', () => {
    expect(verdict('large', 'big', ['large', 'huge'])).toBe('synonym');
    expect(verdict('Huge', 'big', ['large', 'huge'])).toBe('synonym');
    expect(verdict('to begin', 'start', ['begin'])).toBe('synonym');
  });

  it('an exact answer stays correct, a typo of the term stays neredeyse', () => {
    expect(verdict('big', 'big', ['large'])).toBe('correct');
    expect(verdict('bigg', 'big', ['large'])).toBe('close');
  });

  it('a typo of a synonym is not a synonym', () => {
    expect(verdict('larje', 'big', ['large'])).toBe('wrong');
  });

  it('matchesAny folds both sides and knows spelling variants', () => {
    expect(matchesAny('colour', ['color'])).toBe('color');
    expect(matchesAny('nope', ['color'])).toBeNull();
  });

  it('keeps the distance and expected answer for the result screen', () => {
    expect(checkAnswer('large', 'big', { synonyms: ['large'] })).toEqual({
      verdict: 'synonym',
      distance: 0,
      expected: 'big',
      typed: 'large',
    });
  });
});

describe('suggestRating', () => {
  it('maps verdicts to buttons', () => {
    expect(suggestRating('correct', false)).toBe(Rating.Good);
    expect(suggestRating('correct', true)).toBe(Rating.Hard);
    expect(suggestRating('synonym', false)).toBe(Rating.Good);
    expect(suggestRating('synonym', true)).toBe(Rating.Hard);
    expect(suggestRating('close', false)).toBe(Rating.Hard);
    expect(suggestRating('wrong', false)).toBe(Rating.Again);
    expect(suggestRating('skipped', true)).toBe(Rating.Again);
  });
});
