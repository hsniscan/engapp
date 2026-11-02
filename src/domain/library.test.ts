// The pure side of the graded library (decision 0047): scoring, suggestion order, filters and
// the numbers on a row.
import { describe, expect, it } from 'vitest';
import {
  compareSuggestions,
  filterLibrary,
  foldSearch,
  gradedReaderBody,
  matchesLibraryQuery,
  readingMinutes,
  scoreGradedText,
  profileCounts,
  stretchTexts,
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

describe('stretchTexts (B7)', () => {
  it('when nothing fits, offers the closest harder texts, unfinished first', () => {
    const h1 = score(entry('h1', {}, 9));
    const h2 = score(entry('h2', {}, 7));
    const h3 = score(entry('h3', {}, 30));
    const ok = score(entry('ok', {}, 4));
    expect(stretchTexts([h1, h2, h3, ok], 2).map((s) => s.entry.id)).toEqual(['h2', 'h1']);
    expect(stretchTexts([h1, h2], 2, new Set(['h2'])).map((s) => s.entry.id)).toEqual(['h1', 'h2']);
    expect(stretchTexts([h1], 0)).toEqual([]);
  });
});

describe('profileCounts (B10)', () => {
  it('passes profile keys through the reader lemmatizer and adds merged counts', () => {
    const lem = (w: string) => (w === 'went' ? 'go' : w);
    expect(profileCounts({ went: 2, go: 1, cat: 3 }, lem)).toEqual(new Map([['go', 3], ['cat', 3]]));
    expect(profileCounts({ went: 2 })).toEqual(new Map([['went', 2]]));
  });

  it('scores a text the same way the reader would', () => {
    const e = entry('x', { lemma_profile: { known: 96, went: 4 } });
    const pk = (l: string) => (l === 'known' || l === 'go' ? 1 : 0);
    const plain = scoreGradedText(e, { pKnown: pk, difficulty: 'dengeli' });
    const lemmatized = scoreGradedText(e, { pKnown: pk, difficulty: 'dengeli', lemmatize: (w) => (w === 'went' ? 'go' : w) });
    expect(plain.unknownRate).toBeCloseTo(0.04);
    expect(lemmatized.unknownRate).toBe(0);
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

describe('gradedReaderBody (decision 0054)', () => {
  it('joins sentences by paragraph and remembers where each one is', () => {
    const { body, spans } = gradedReaderBody([
      { en: 'Mr. Lee  was late.', p: 0 },
      { en: 'He ran.', p: 0 },
      { en: '   ', p: 0 },
      { en: 'The end.', p: 1 },
    ]);
    expect(body).toBe('Mr. Lee was late. He ran.\n\nThe end.');
    expect(spans).toEqual([
      { start: 0, end: 17, index: 0 },
      { start: 18, end: 25, index: 1 },
      { start: 27, end: 35, index: 3 },
    ]);
    for (const s of spans) expect(body.slice(s.start, s.end)).not.toMatch(/^\s|\s$/);
  });

  it('an empty text is an empty body', () => {
    expect(gradedReaderBody([])).toEqual({ body: '', spans: [] });
  });
});

describe('library search (v0.5.2)', () => {
  const list = [
    score(entry('a', { title: 'A Day at the Bakery', topic: 'food' })),
    score(entry('b', { title: 'The Island Train', topic: 'travel' })),
    score(entry('c', { title: 'Inside a Hospital', topic: 'health' })),
  ];
  const label = (k: string) =>
    ({ food: 'Yemek', travel: 'Seyahat', health: 'Sağlık' })[k] ?? k;
  const titles = (q: string) =>
    filterLibrary(list, { level: null, topic: null, query: q, topicLabel: label }).map(
      (x) => x.entry.title,
    );

  it('folds case, accents and the Turkish i', () => {
    expect(foldSearch('  İstanbul   ŞEHİR ')).toBe('istanbul sehir');
    expect(foldSearch('ISLAND')).toBe('island');
  });

  it('finds titles and topic names; every word must match', () => {
    expect(titles('bakery')).toEqual(['A Day at the Bakery']);
    expect(titles('saglik')).toEqual(['Inside a Hospital']);
    expect(titles('seyahat train')).toEqual(['The Island Train']);
    expect(titles('seyahat bakery')).toEqual([]);
    expect(titles('   ')).toHaveLength(3);
  });

  it('works without a topic label', () => {
    expect(matchesLibraryQuery({ title: 'X', topic: 'travel' }, 'trav')).toBe(true);
  });
});
