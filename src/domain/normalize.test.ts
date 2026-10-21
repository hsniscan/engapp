import { describe, expect, it } from 'vitest';
import { cleanText, normalizeTerm } from './normalize';

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

  it('cleanText keeps case', () => {
    expect(cleanText('  It’s  Fine ')).toBe("It's Fine");
  });
});
