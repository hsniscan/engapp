import { describe, expect, it } from 'vitest';
import { bandFit, measureCoverage } from './coverage';

describe('measureCoverage', () => {
  it('weights unknown lemmas by how often they occur', () => {
    const counts = new Map([
      ['the', 10],
      ['ubiquitous', 2],
      ['walk', 3],
    ]);
    const r = measureCoverage(counts, (l) => (l === 'ubiquitous' ? 0 : 1));
    expect(r.tokens).toBe(15);
    expect(r.unknownRate).toBeCloseTo(2 / 15);
    expect(r.unknownLemmas).toEqual(['ubiquitous']);
  });

  it('is zero for an empty text', () => {
    expect(measureCoverage(new Map(), () => 0)).toEqual({ tokens: 0, unknownRate: 0, unknownLemmas: [] });
  });
});

describe('bandFit', () => {
  it('places a rate against the chosen band and never allows more than 10 %', () => {
    expect(bandFit(0.04, 'dengeli')).toBe(0);
    expect(bandFit(0.01, 'dengeli')).toBe(-1);
    expect(bandFit(0.06, 'dengeli')).toBe(1);
    expect(bandFit(0.1, 'zorlayici')).toBe(0);
    expect(bandFit(0.11, 'zorlayici')).toBe(1);
  });
});
