// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseCefr } from './cefr.ts';
import {
  boundGuess,
  clampSteps,
  clampTrCorrection,
  contentWords,
  fitZipfThresholds,
  isPlainWord,
  lemmasNeeded,
  listLevel,
  resolveLevel,
  zipfBand,
  ZIPF_THRESHOLDS,
  type LevelQuery,
  type RefEntry,
  type WordRefs,
} from './level.ts';

const data: Record<string, WordRefs> = {
  television: { refs: [{ pos: 'noun', cefr: 'A1', source: 'cefrj' }], zipf: 4.9 },
  abandon: {
    refs: [{ pos: 'verb', cefr: 'B1', source: 'cefrj', tr_cefr: 'B2', tr_reason: 'Türkçede soyut' }],
    zipf: 3.9,
  },
  actually: {
    // A stored correction of two steps (should never happen) is clamped to one.
    refs: [{ pos: 'adverb', cefr: 'A2', source: 'cefrj', tr_cefr: 'B2', tr_reason: "'aktüel' ile karışır" }],
    zipf: 5.6,
  },
  // Same lemma in two parts of speech and in both lists.
  light: {
    refs: [
      { pos: 'noun', cefr: 'A1', source: 'cefrj' },
      { pos: 'adjective', cefr: 'A2', source: 'cefrj' },
      { pos: 'verb', cefr: 'B1', source: 'cefrj' },
      { pos: 'verb', cefr: 'B1', source: 'octanove' },
    ],
    zipf: 5.3,
  },
  ubiquitous: { refs: [{ pos: 'adjective', cefr: 'C2', source: 'octanove' }], zipf: 3.2 },
  'according to': { refs: [{ pos: 'preposition', cefr: 'A2', source: 'cefrj' }], zipf: null },
  people: { refs: [], zipf: 6.4 },
  serendipity: { refs: [], zipf: 2.4 },
  gadget: { refs: [], zipf: 3.5 },
  give: { refs: [{ pos: 'verb', cefr: 'A1', source: 'cefrj' }], zipf: 6.0 },
  up: { refs: [{ pos: 'adverb', cefr: 'A1', source: 'cefrj' }], zipf: 6.5 },
  corner: { refs: [{ pos: 'noun', cefr: 'A2', source: 'cefrj' }], zipf: 4.6 },
  cut: { refs: [{ pos: 'verb', cefr: 'A2', source: 'cefrj' }], zipf: 5.2 },
  advantage: { refs: [{ pos: 'noun', cefr: 'B1', source: 'cefrj' }], zipf: 4.5 },
  take: { refs: [{ pos: 'verb', cefr: 'A1', source: 'cefrj' }], zipf: 6.2 },
  mitigate: { refs: [], zipf: 3.1 },
};
const lookup = (l: string) => data[l];
const FULL = { minZipf: 3 };

const q = (lemma_norm: string, over: Partial<LevelQuery> = {}): LevelQuery => ({
  lemma_norm,
  term_type: lemma_norm.includes(' ') ? 'phrase' : 'word',
  pos: null,
  cefr_guess: null,
  ...over,
});

describe('clamps', () => {
  it('clampSteps moves a level towards the origin', () => {
    expect(clampSteps('B1', 'C2', 1)).toBe('B2');
    expect(clampSteps('B1', 'A1', 1)).toBe('A2');
    expect(clampSteps('B1', 'B2', 1)).toBe('B2');
    expect(clampSteps('A1', 'C2', 2)).toBe('B1');
    expect(clampSteps('C1', 'C1', 0)).toBe('C1');
  });

  it('the Turkish-learner correction moves a list level by one step at most', () => {
    expect(clampTrCorrection('B1', 'A2')).toBe('A2');
    expect(clampTrCorrection('B1', 'A1')).toBe('A2');
    expect(clampTrCorrection('A2', 'C2')).toBe('B1');
    expect(clampTrCorrection('C2', 'A1')).toBe('C1');
    expect(clampTrCorrection('A1', 'A1')).toBe('A1');
  });
});

describe('zipfBand', () => {
  it('maps frequency to a band with the fitted thresholds', () => {
    expect(ZIPF_THRESHOLDS).toHaveLength(5);
    expect(zipfBand(7)).toBe('A1');
    expect(zipfBand(ZIPF_THRESHOLDS[0]!)).toBe('A1');
    expect(zipfBand(ZIPF_THRESHOLDS[0]! - 0.01)).toBe('A2');
    expect(zipfBand(3.5)).toBe('B2');
    expect(zipfBand(2.0)).toBe('C1');
    expect(zipfBand(1.0)).toBe('C2');
  });

  it('fitZipfThresholds finds the band edges of clean data', () => {
    const pts = [
      ...[6.1, 6, 5.8].map((zipf) => ({ zipf, cefr: 'A1' as const })),
      ...[5.1, 5.0].map((zipf) => ({ zipf, cefr: 'A2' as const })),
      ...[4.4, 4.3].map((zipf) => ({ zipf, cefr: 'B1' as const })),
      ...[3.6].map((zipf) => ({ zipf, cefr: 'B2' as const })),
      ...[2.8, 2.7].map((zipf) => ({ zipf, cefr: 'C1' as const })),
      ...[1.2].map((zipf) => ({ zipf, cefr: 'C2' as const })),
    ];
    const th = fitZipfThresholds(pts);
    expect(th).toEqual([5.8, 5.0, 4.3, 3.6, 2.7]);
    for (const p of pts) expect(zipfBand(p.zipf, th)).toBe(p.cefr);
  });
});

describe('listLevel', () => {
  it('prefers the same part of speech, else the easiest entry', () => {
    expect(listLevel(data.light!.refs, 'verb')).toMatchObject({ cefr: 'B1', source: 'cefrj' });
    expect(listLevel(data.light!.refs, 'adjective')?.cefr).toBe('A2');
    expect(listLevel(data.light!.refs, 'phrasal verb')?.cefr).toBe('B1');
    expect(listLevel(data.light!.refs, 'idiom')?.cefr).toBe('A1');
    expect(listLevel(data.light!.refs, 'adverb')?.cefr).toBe('A1');
    expect(listLevel([], 'noun')).toBeNull();
    expect(listLevel(undefined, null)).toBeNull();
  });

  it('applies the correction, clamped, with its reason', () => {
    expect(listLevel(data.abandon!.refs, 'verb')).toEqual({
      cefr: 'B2',
      source: 'cefrj',
      list_cefr: 'B1',
      reason_tr: 'Türkçede soyut',
    });
    expect(listLevel(data.actually!.refs, 'adverb')).toMatchObject({ cefr: 'B1', list_cefr: 'A2' });
    const noReason: RefEntry[] = [{ pos: 'noun', cefr: 'B1', source: 'cefrj', tr_cefr: 'B1', tr_reason: 'x' }];
    expect(listLevel(noReason, 'noun')).toMatchObject({ cefr: 'B1', reason_tr: null });
  });
});

describe('resolveLevel', () => {
  it('1. a list word gets the list level, whatever the guess', () => {
    expect(resolveLevel(q('television', { cefr_guess: 'B2' }), lookup)).toEqual({
      cefr: 'A1',
      source: 'cefrj',
      list_cefr: 'A1',
      reason_tr: null,
    });
    expect(resolveLevel(q('ubiquitous', { pos: 'adjective' }), lookup)?.source).toBe('octanove');
    expect(resolveLevel(q('according to'), lookup)?.cefr).toBe('A2');
  });

  it('1. with the Turkish-learner correction', () => {
    expect(resolveLevel(q('abandon', { pos: 'verb' }), lookup)).toEqual({
      cefr: 'B2',
      source: 'cefrj',
      list_cefr: 'B1',
      reason_tr: 'Türkçede soyut',
    });
  });

  it('2. a phrase is the guess or its hardest word, whichever is higher', () => {
    expect(resolveLevel(q('give up', { cefr_guess: 'A2' }), lookup)).toMatchObject({ cefr: 'A2', source: 'ai' });
    expect(resolveLevel(q('give up'), lookup)).toMatchObject({ cefr: 'A1', source: 'words' });
    // "cut corners": the guess (B2) is above the words (A2).
    expect(resolveLevel(q('cut corners', { cefr_guess: 'B2' }), lookup)).toMatchObject({ cefr: 'B2', source: 'ai' });
    // A guess below the hardest word is raised to it.
    expect(
      resolveLevel(q('take advantage of sth', { cefr_guess: 'A1', term_type: 'pattern' }), lookup),
    ).toMatchObject({ cefr: 'B1', source: 'words' });
    // Unknown words count as rare when the frequency data covers Zipf >= 3.
    expect(resolveLevel(q('zorbly frob'), lookup, FULL)).toMatchObject({ cefr: 'C1', source: 'words' });
    expect(resolveLevel(q('zorbly frob'), lookup)).toBeNull();
    expect(resolveLevel(q('zorbly frob', { cefr_guess: 'C1' }), lookup)).toMatchObject({ cefr: 'C1', source: 'ai' });
  });

  it('3. an AI guess is bounded by frequency', () => {
    // Zipf >= 5: at most B1.
    expect(resolveLevel(q('people', { cefr_guess: 'C1' }), lookup)).toMatchObject({ cefr: 'B1', source: 'ai' });
    // Zipf < 3: at least C1.
    expect(resolveLevel(q('serendipity', { cefr_guess: 'A2' }), lookup)).toMatchObject({ cefr: 'C1', source: 'ai' });
    // Within two bands of the frequency band (3.5 = B2): A1 -> B1 ... kept B2.
    expect(resolveLevel(q('gadget', { cefr_guess: 'A1' }), lookup)?.cefr).toBe('A2');
    expect(resolveLevel(q('gadget', { cefr_guess: 'B1' }), lookup)?.cefr).toBe('B1');
    // A word missing from data that covers Zipf >= 3 is rare: at least C1.
    expect(resolveLevel(q('quixotry', { cefr_guess: 'B1' }), lookup, FULL)).toMatchObject({ cefr: 'C1' });
    // Without coverage information the guess stands.
    expect(resolveLevel(q('quixotry', { cefr_guess: 'B1' }), lookup)).toMatchObject({ cefr: 'B1' });
  });

  it('4. without a guess: the frequency band', () => {
    expect(resolveLevel(q('mitigate'), lookup)).toMatchObject({ cefr: 'B2', source: 'freq' });
    expect(resolveLevel(q('people'), lookup)).toMatchObject({ cefr: 'A1', source: 'freq' });
    expect(resolveLevel(q('quixotry'), lookup, FULL)).toMatchObject({ cefr: 'C1', source: 'freq' });
    expect(resolveLevel(q('quixotry'), lookup)).toBeNull();
  });

  it('ignores an invalid guess', () => {
    expect(resolveLevel(q('mitigate', { cefr_guess: 'Z9' as never }), lookup)?.source).toBe('freq');
  });
});

describe('boundGuess', () => {
  it('caps frequent words and floors rare ones', () => {
    expect(boundGuess('C2', 6.5)).toBe('B1');
    expect(boundGuess('A1', 2.2)).toBe('C1');
    expect(boundGuess('B2', null)).toBe('B2');
    expect(boundGuess('B2', 4.0)).toBe('B2');
  });
});

describe('helpers', () => {
  it('isPlainWord, contentWords and lemmasNeeded', () => {
    expect(isPlainWord('television')).toBe(true);
    expect(isPlainWord("don't")).toBe(true);
    expect(isPlainWord('give up')).toBe(false);
    expect(isPlainWord('well-known')).toBe(false);
    expect(contentWords("make up one's mind")).toEqual(['make', 'up', 'mind']);
    expect(contentWords('take advantage of sth')).toEqual(['take', 'advantage']);
    expect(contentWords('by and large')).toEqual(['large']);
    expect(lemmasNeeded('television')).toEqual(['television']);
    expect(lemmasNeeded('cut corners')).toEqual(expect.arrayContaining(['cut corners', 'cut', 'corner']));
    // Words that are also Object.prototype keys must not crash the irregular-form lookup.
    expect(() => lemmasNeeded('constructor toString')).not.toThrow();
  });

  it('parseCefr accepts only the six levels', () => {
    expect(parseCefr('B2')).toBe('B2');
    expect(parseCefr(' b2 ')).toBe('B2');
    expect(parseCefr('B3')).toBeNull();
    expect(parseCefr(null)).toBeNull();
    expect(parseCefr(2)).toBeNull();
  });
});
