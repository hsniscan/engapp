// The pure side of the graded library (decision 0047): scoring, suggestion order, filters and
// the numbers on a row.
import { describe, expect, it } from 'vitest';
import {
  compareSuggestions,
  filterLibrary,
  readingMinutes,
  scoreGradedText,
  suggestTexts,
  understoodPercent,
  type GradedCatalogEntry,
  type ScoredGradedText,
} from './library';

const entry = (id: string, over: Partial<GradedCatalogEntry> = {}, unknown = 4): GradedCatalogEntry => ({
  id,
  level: 'B1',
  topic: 'travel',
  title: id,
  words: 100,
  tokens: 100,
  cov_level: 0.97,
  lemma_profile: unknown > 0 ? { known: 100 - unknown, [`u_${id}`]: unknown } : { known: 100 },
  target_lemmas: [],
  server_seq: 1,
  ...over,
});

const pKnown = (l: string) => (l === 'known' ? 1 : 0);
const score = (e: GradedCatalogEntry, interests: string[] = []): ScoredGradedText =>
  scoreGradedText(e, { pKnown, difficulty: 'dengeli', interests: new Set(interests) });

describe('scoreGradedText', () => {
  it('measures unknown share and places it against the band', () => {
    expect(score(entry('a', {}, 4))).toMatchObject({ fit: 0, interest: false });
    expect(score(entry('a', {}, 4)).unknownRate).toBeCloseTo(0.04);
    expect(score(entry('b', {}, 1)).fit).toBe(-1);
    expect(score(entry('c', {}, 8)).fit).toBe(1);
    expect(score(entry('d', {}, 30)).fit).toBe(1);
  });

  it('marks interests through the topic map', () => {
    const s = scoreGradedText(entry('a', { topic: 'daily_life' }), {
      pKnown,
      difficulty: 'dengeli',
      interests: new Set(['food']),
      topicInterests: (t) => (t === 'daily_life' ? ['daily_life', 'food'] : [t]),
    });
    expect(s.interest).toBe(true);
    expect(score(entry('b', { topic: 'travel' }), ['travel']).interest).toBe(true);
    expect(score(entry('c', { topic: 'travel' }), []).interest).toBe(false);
  });
});

describe('compareSuggestions and suggestTexts', () => {
  it('orders finished last, interests first, then nearest the band centre', () => {
    const a = score(entry('a', {}, 3));
    const b = score(entry('b', {}, 4));
    const c = score(entry('c', { topic: 'sports' }, 5), ['sports']);
    const sorted = [a, b, c].sort(compareSuggestions('dengeli', new Set(['c'])));
    expect(sorted.map((s) => s.entry.id)).toEqual(['b', 'a', 'c']);
    expect([a, b, c].sort(compareSuggestions('dengeli')).map((s) => s.entry.id)).toEqual(['c', 'b', 'a']);
  });

  it('never suggests a harder text, falls back to the closest easier', () => {
    const easy1 = score(entry('e1', {}, 0));
    const easy2 = score(entry('e2', {}, 2));
    const hard = score(entry('h', {}, 9));
    expect(suggestTexts([easy1, easy2, hard], 'dengeli', 5).map((s) => s.entry.id)).toEqual(['e2', 'e1']);
    expect(suggestTexts([hard], 'dengeli', 5)).toEqual([]);
    expect(suggestTexts([easy1], 'dengeli', 0)).toEqual([]);
  });
});

describe('filterLibrary', () => {
  const texts = [
    score(entry('c1', { level: 'C1', topic: 'science' }, 2)),
    score(entry('a2b', { level: 'A2' }, 5)),
    score(entry('a2a', { level: 'A2' }, 1)),
    score(entry('b1', { level: 'B1', topic: 'science' }, 3)),
  ];

  it('sorts by level, then easiest for the user', () => {
    expect(filterLibrary(texts, { level: null, topic: null }).map((s) => s.entry.id)).toEqual(['a2a', 'a2b', 'b1', 'c1']);
  });

  it('filters by level and topic together', () => {
    expect(filterLibrary(texts, { level: 'A2', topic: null }).map((s) => s.entry.id)).toEqual(['a2a', 'a2b']);
    expect(filterLibrary(texts, { level: null, topic: 'science' }).map((s) => s.entry.id)).toEqual(['b1', 'c1']);
    expect(filterLibrary(texts, { level: 'A2', topic: 'science' })).toEqual([]);
  });
});

describe('row numbers', () => {
  it('understoodPercent floors and clamps', () => {
    expect(understoodPercent(0.04)).toBe(96);
    expect(understoodPercent(0.035)).toBe(96);
    expect(understoodPercent(0)).toBe(100);
    expect(understoodPercent(1.2)).toBe(0);
  });

  it('readingMinutes is about 120 words a minute, at least 1', () => {
    expect(readingMinutes(30)).toBe(1);
    expect(readingMinutes(240)).toBe(2);
    expect(readingMinutes(600)).toBe(5);
  });
});
