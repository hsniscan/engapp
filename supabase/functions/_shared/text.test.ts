// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  cleanLemma,
  glossKey,
  glossSimilarity,
  isDuplicateSense,
  isNearDuplicateGloss,
  isSameMeaningTr,
  meaningAlternatives,
  normalizeLemma,
  normalizePos,
} from './text.ts';
import { normalizeTerm } from '../../../src/domain/normalize.ts';

describe('normalizeLemma', () => {
  it('matches notes.term_norm normalisation exactly', () => {
    for (const s of [
      'Give  Up',
      ' bank ',
      'one’s',
      'make up one‘s mind',
      'Well‐being',
      'CAFÉ',
      'naïve',
    ]) {
      expect(normalizeLemma(s)).toBe(normalizeTerm(s));
    }
    fc.assert(fc.property(fc.string(), (s) => normalizeLemma(s) === normalizeTerm(s)));
  });

  it('cleanLemma trims edge punctuation but keeps inner apostrophes', () => {
    expect(cleanLemma(' "give up." ')).toBe('give up');
    expect(cleanLemma('make up one’s mind')).toBe("make up one's mind");
  });
});

describe('glossKey', () => {
  it('ignores case, articles, punctuation and plural -s', () => {
    expect(glossKey('the land beside a river')).toBe('beside land river');
    expect(glossKey('Land beside rivers.')).toBe('beside land river');
    expect(glossKey('  LAND, beside the River ')).toBe('beside land river');
  });

  it('keeps different meanings apart', () => {
    expect(glossKey('an organization that keeps and lends money')).not.toBe(
      glossKey('the land beside a river'),
    );
  });

  it('folds diacritics and satisfies the SQL CHECK pattern', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (s) => {
        const k = glossKey(s);
        return k === null || (/^[a-z0-9]+( [a-z0-9]+)*$/.test(k) && k.length <= 200);
      }),
    );
    expect(glossKey('café crème')).toBe('cafe creme');
  });

  it('falls back to stop words when the gloss has nothing else', () => {
    expect(glossKey('to be')).toBe('be to');
    expect(glossKey('...')).toBeNull();
  });
});

describe('near-duplicate glosses', () => {
  it('detects rewordings', () => {
    expect(isNearDuplicateGloss('the land beside a river', 'land beside rivers')).toBe(true);
    expect(isNearDuplicateGloss('the sloping land beside a river', 'land beside a river')).toBe(
      true,
    );
    expect(glossSimilarity('the land beside a river', 'the land alongside a river')).toBeLessThan(
      0.8,
    );
  });
  it('does not merge different senses', () => {
    expect(isNearDuplicateGloss('keep money in a bank', 'an organization that keeps money')).toBe(
      false,
    );
    expect(
      isNearDuplicateGloss('stop doing a habit', 'stop trying to do something difficult'),
    ).toBe(false);
  });
});

describe('normalizePos', () => {
  it('maps aliases', () => {
    expect(normalizePos('Phrasal Verb')).toBe('phrasal verb');
    expect(normalizePos('adj')).toBe('adjective');
    expect(normalizePos('collocation')).toBe('phrase');
    expect(normalizePos('weird')).toBe('other');
    expect(normalizePos('')).toBeNull();
    expect(normalizePos(null)).toBeNull();
  });
});

describe('Turkish meaning overlap (semantic duplicate senses)', () => {
  it('splits a meaning into normalised alternatives', () => {
    expect(meaningAlternatives('davetiye, davet')).toEqual(['davetiye', 'davet']);
    expect(meaningAlternatives(' Nehir  kıyısı; sahil / kıyı. ')).toEqual([
      'nehir kıyısı',
      'sahil',
      'kıyı',
    ]);
    expect(meaningAlternatives('')).toEqual([]);
    expect(meaningAlternatives(null)).toEqual([]);
  });

  it('"davet" and "davetiye, davet" are the same meaning', () => {
    expect(isSameMeaningTr('davet', 'davetiye, davet')).toBe(true);
    expect(isSameMeaningTr('davetiye, davet', 'davet')).toBe(true);
    expect(isSameMeaningTr('Davet', 'davet')).toBe(true);
    expect(isSameMeaningTr('kıyı', 'kıyı, sahil')).toBe(true);
  });

  it('different meanings are not merged', () => {
    expect(isSameMeaningTr('banka', 'kıyı')).toBe(false);
    expect(isSameMeaningTr('çalışmak', 'işlemek')).toBe(false);
    expect(isSameMeaningTr('davetiye', 'davet')).toBe(false); // a whole alternative must match
    expect(isSameMeaningTr('nehir kıyısı', 'deniz kıyısı')).toBe(false); // words inside are not compared
    expect(isSameMeaningTr('', '')).toBe(false);
  });

  it('a duplicate sense needs the same part of speech', () => {
    const a = { pos: 'noun', meaning_tr: 'davetiye, davet' };
    expect(isDuplicateSense(a, { pos: 'noun', meaning_tr: 'davet' })).toBe(true);
    expect(isDuplicateSense(a, { pos: 'verb', meaning_tr: 'davet' })).toBe(false);
    expect(
      isDuplicateSense({ pos: 'noun', meaning_tr: 'banka' }, { pos: 'noun', meaning_tr: 'kıyı' }),
    ).toBe(false);
    expect(
      isDuplicateSense(
        { pos: 'verb', meaning_tr: 'çalışmak' },
        { pos: 'verb', meaning_tr: 'işlemek' },
      ),
    ).toBe(false);
    // Unknown part of speech (typed by hand): not merged on meaning overlap.
    expect(
      isDuplicateSense(
        { pos: null, meaning_tr: 'davet' },
        { pos: null, meaning_tr: 'davetiye, davet' },
      ),
    ).toBe(false);
  });
});
