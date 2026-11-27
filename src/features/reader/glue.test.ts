import { describe, expect, it } from 'vitest';
import { splitGap } from './glue';

describe('splitGap', () => {
  it('glues a comma to the word before and an opening quote to the word after', () => {
    expect(splitGap(', "', true)).toEqual([',', ' ', '"']);
    expect(splitGap(' (', true)).toEqual(['', ' ', '(']);
    expect(splitGap('." ', true)).toEqual(['."', ' ', '']);
  });
  it('keeps a gap with no space on the word before', () => {
    expect(splitGap('—', true)).toEqual(['—', '', '']);
  });
  it('gives the sentence opening to the first word', () => {
    expect(splitGap('"', false)).toEqual(['', '', '"']);
    expect(splitGap(' “', false)).toEqual(['', ' ', '“']);
  });
  it('handles an empty gap and a plain space', () => {
    expect(splitGap('', true)).toEqual(['', '', '']);
    expect(splitGap(' ', true)).toEqual(['', ' ', '']);
  });
});
