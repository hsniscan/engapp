import { describe, expect, it } from 'vitest';
import { cleanText, normalizeMeaningTr, normalizeTerm } from './normalize';

describe('normalizeTerm', () => {
  it.each([
    ['  Give   UP ', 'give up'],
    ['don’t', "don't"],
    ['“quoted”', '"quoted"'],
    ['well–known', 'well-known'],
    ['café', 'café'],
    ['a\tb\nc', 'a b c'],
  ])('%j → %j', (input, expected) => {
    expect(normalizeTerm(input)).toBe(expected);
  });

  it('a dotted capital İ is a plain i; an English I stays i', () => {
    expect(normalizeTerm('İstanbul')).toBe('istanbul');
    expect(normalizeTerm('IDEA')).toBe('idea');
  });

  it('normalizeMeaningTr lower-cases with Turkish rules', () => {
    expect(normalizeMeaningTr('  İhmal   etmek ')).toBe('ihmal etmek');
    expect(normalizeMeaningTr('IŞIK')).toBe('ışık');
    expect(normalizeMeaningTr('İsteksiz')).toBe(normalizeMeaningTr('isteksiz'));
  });

  it('cleanText keeps case', () => {
    expect(cleanText('  It’s  Fine ')).toBe("It's Fine");
  });
});
