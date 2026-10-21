// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { findGappedSpan, findSentence, findSpan, spanMatches } from './locate.ts';

const chunk =
  'He was “reluctant” to go.\nThe bank of the\nriver was steep — very steep. She gave it up.';

describe('findSentence (verbatim check)', () => {
  it('finds an exact sentence', () => {
    const r = findSentence(chunk, 'She gave it up.');
    expect(r?.text).toBe('She gave it up.');
    expect(chunk.slice(r!.start, r!.end)).toBe('She gave it up.');
  });

  it('tolerates collapsed line breaks and straightened quotes/dashes, returning the chunk text', () => {
    const r = findSentence(chunk, 'The bank of the river was steep - very steep.');
    expect(r?.text).toBe('The bank of the\nriver was steep — very steep.');
    expect(findSentence(chunk, 'He was "reluctant" to go.')?.text).toBe(
      'He was “reluctant” to go.',
    );
  });

  it('rejects hallucinated or edited sentences', () => {
    expect(findSentence(chunk, 'He was unwilling to go.')).toBeNull();
    expect(findSentence(chunk, 'She gave it up!')).toBeNull();
    expect(findSentence(chunk, 'The bank of the river was very steep.')).toBeNull();
    expect(findSentence(chunk, '   ')).toBeNull();
  });
});

describe('findSpan (surface inside sentence)', () => {
  it('finds the surface on word boundaries', () => {
    const s = 'The embankment near the bank collapsed.';
    expect(findSpan(s, 'bank')).toEqual([24, 28]);
  });
  it('is case-insensitive as a fallback', () => {
    expect(findSpan('By and large, fine.', 'by and large')).toEqual([0, 12]);
  });
  it('handles separable phrasal verbs given with a gap', () => {
    const s = 'The manager turned her application down yesterday.';
    const span = findSpan(s, 'turned down')!;
    expect(s.slice(span[0], span[1])).toBe('turned her application down');
    expect(findGappedSpan(s, 'turned down', 1)).toBeNull();
  });
  it('returns null when the surface is absent', () => {
    expect(findSpan('Nothing here.', 'bank')).toBeNull();
  });
});

describe('spanMatches', () => {
  it('checks a given span', () => {
    expect(spanMatches('She gave up.', [4, 11], 'gave up')).toBe(true);
    expect(spanMatches('She gave up.', [4, 10], 'gave up')).toBe(false);
    expect(spanMatches('She gave up.', [-1, 3], 'She')).toBe(false);
  });
});
