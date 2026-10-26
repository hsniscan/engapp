import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { measureCoverage } from './coverage';
import { buildKnowledge, frequencyFactor, P_LEARNING, P_NO_DATA, type KnowledgeInput } from './knowledgeModel';
import { parseClientLevels } from './level';
import { lemmaCounts, tokenizeReaderText } from './readerTokens';
import type { WordStage } from './stages';
import type { CefrLevel } from './types';

const BANDS: Record<CefrLevel, number> = { A1: 0.98, A2: 0.95, B1: 0.85, B2: 0.5, C1: 0.2, C2: 0.05 };

const small = parseClientLevels(
  [
    '# @min_zipf 3',
    'go\t6.2\tv:A1:j',
    'walk\t5.1\tv:A1:j',
    'park\t5.0\tn:A1:j',
    'cope\t4.1\tv:B1:j',
    'ubiquitous\t3.2\tj:C1:o',
    'serendipity\t3.1\t',
    'child\t5.6\tn:A1:j',
    'mouse\t4.3\tn:A1:j',
  ].join('\n'),
);

function model(over: Partial<KnowledgeInput> = {}) {
  return buildKnowledge({
    stages: new Map<string, WordStage>(),
    known: new Set(),
    bandKnown: BANDS,
    levels: { lookup: small.lookup, minZipf: small.minZipf },
    offset: 0,
    ...over,
  });
}

describe('lemmatize', () => {
  const k = model();
  it('maps inflected forms to a base form the level list holds', () => {
    expect(k.lemmatize('went')).toBe('go');
    expect(k.lemmatize('Walking')).toBe('walk');
    expect(k.lemmatize('walked')).toBe('walk');
    expect(k.lemmatize('parks')).toBe('park');
    expect(k.lemmatize('children')).toBe('child');
    expect(k.lemmatize('mice')).toBe('mouse');
  });

  it('handles contractions', () => {
    expect(k.lemmatize("don't")).toBe('do');
    expect(k.lemmatize('won’t')).toBe('will');
    expect(k.lemmatize("children's")).toBe('child');
  });

  it("prefers the user's own word", () => {
    const own = model({ stages: new Map([['walking', 'learning' as const]]) });
    expect(own.lemmatize('walking')).toBe('walking');
    expect(model({ known: new Set(['parks']) }).lemmatize('parks')).toBe('parks');
  });

  it('keeps an unknown word as written', () => {
    expect(k.lemmatize('zorblax')).toBe('zorblax');
  });
});

describe('pKnown', () => {
  it('function words are known', () => {
    expect(model().pKnown('the')).toBe(1);
    expect(model({ levels: null }).pKnown('of')).toBe(1);
  });

  it("follows the user's word stages", () => {
    const stages = new Map<string, WordStage>([
      ['cope', 'learning'],
      ['walk', 'consolidating'],
      ['park', 'learned'],
      ['go', 'mastered'],
      ['ubiquitous', 'new'],
      ['child', 'new'],
    ]);
    const k = model({ stages });
    expect(k.pKnown('cope')).toBe(P_LEARNING);
    expect(k.pKnown('walk')).toBe(1);
    expect(k.pKnown('park')).toBe(1);
    expect(k.pKnown('go')).toBe(1);
    // A card never answered: at most the learning value.
    expect(k.pKnown('ubiquitous')).toBeLessThanOrEqual(P_LEARNING);
    expect(k.pKnown('child')).toBe(P_LEARNING);
  });

  it('"Biliyorum" words are known', () => {
    expect(model({ known: new Set(['ubiquitous']) }).pKnown('ubiquitous')).toBe(1);
  });

  it("uses the level model's share for the lemma's band, raised for frequent words", () => {
    const k = model();
    expect(k.band('cope')).toBe('B1');
    expect(k.pKnown('cope')).toBeCloseTo(0.85);
    expect(k.pKnown('ubiquitous')).toBeCloseTo(0.2);
    // A1 and very frequent: 1 − 0.02 × 0.1.
    expect(k.pKnown('go')).toBeCloseTo(0.998);
    // Not in the word list: the frequency band.
    expect(k.band('serendipity')).not.toBeNull();
    // Missing from the frequency data that covers everything ≥ 3: rarer than all of it.
    expect(k.band('zorblax')).toBe('C2');
    expect(k.pKnown('zorblax')).toBeCloseTo(0.05);
  });

  it('a hyphenated word is as known as its least known part', () => {
    expect(model().pKnown('walk-ubiquitous')).toBeCloseTo(0.2);
  });

  it('without level data every other word is a neutral estimate', () => {
    const k = model({ levels: null });
    expect(k.pKnown('cope')).toBe(P_NO_DATA);
    expect(k.source('cope')).toBe('none');
    expect(k.lemmatize('went')).toBe('went');
  });

  it('the reading offset scales the unknown share, bounded', () => {
    const hard = model({ offset: 0.5 }).pKnown('ubiquitous');
    const easy = model({ offset: -0.5 }).pKnown('ubiquitous');
    expect(hard).toBe(0); // 1 − 0.8 × 1.5, clamped
    expect(model({ offset: 0.2 }).pKnown('ubiquitous')).toBeCloseTo(1 - 0.8 * 1.2);
    expect(easy).toBeCloseTo(1 - 0.8 * 0.5);
    expect(model({ offset: 9 }).pKnown('ubiquitous')).toBeCloseTo(hard);
    expect(model({ offset: Number.NaN }).pKnown('ubiquitous')).toBeCloseTo(0.2);
    // The offset never moves the user's own words or "Biliyorum" words.
    expect(model({ offset: 0.5, stages: new Map([['cope', 'learned' as const]]) }).pKnown('cope')).toBe(1);
  });

  it('every probability is within 0..1', () => {
    for (const offset of [-0.5, 0, 0.5]) {
      const k = model({ offset, bandKnown: { A1: 2, A2: -1, B1: 0.5, B2: 0.5, C1: 0.5, C2: 0.5 } });
      for (const w of ['go', 'walk', 'cope', 'zorblax', 'serendipity', 'child']) {
        expect(k.pKnown(w)).toBeGreaterThanOrEqual(0);
        expect(k.pKnown(w)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('frequencyFactor', () => {
    expect([null, 3, 5, 5.5, 6, 7].map(frequencyFactor)).toEqual([1, 1, 0.5, 0.25, 0.1, 0.1]);
  });
});

describe('on the real level file', () => {
  const real = parseClientLevels(readFileSync('data/levels/client-levels.tsv', 'utf8'));
  const B1_USER: Record<CefrLevel, number> = { A1: 0.97, A2: 0.92, B1: 0.75, B2: 0.35, C1: 0.12, C2: 0.04 };
  const k = buildKnowledge({
    stages: new Map(),
    known: new Set(),
    bandKnown: B1_USER,
    levels: { lookup: real.lookup, minZipf: real.minZipf },
    offset: 0,
  });

  const easy =
    'My name is Ali. I live in a small house with my family. Every morning I get up early and walk to school. ' +
    'My mother makes breakfast for us. We eat bread, eggs and cheese. After school I play football with my friends in the park.';
  const hard =
    'The ubiquitous proliferation of algorithmic curation has engendered an epistemological quandary, ' +
    'wherein the veracity of disseminated information is perpetually contested by heterogeneous constituencies.';

  const rate = (body: string) => measureCoverage(lemmaCounts(tokenizeReaderText(body).tokens, k.lemmatize), k.pKnown).unknownRate;

  it('an A1 story is mostly known, an academic sentence is not', () => {
    expect(rate(easy)).toBeLessThan(0.05);
    expect(rate(hard)).toBeGreaterThan(0.3);
  });

  it('measures 1 000 words in well under a second', () => {
    const words = readFileSync('data/levels/client-levels.tsv', 'utf8')
      .split('\n')
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => l.split('\t')[0]!)
      .filter((w) => /^[a-z]+$/.test(w));
    const pick = Array.from({ length: 1000 }, (_, i) => words[(i * 7919) % words.length]!);
    const body = pick.map((w, i) => (i % 12 === 11 ? `${w}ed.` : `${w}s`)).join(' ');
    const fresh = buildKnowledge({
      stages: new Map(),
      known: new Set(),
      bandKnown: B1_USER,
      levels: { lookup: real.lookup, minZipf: real.minZipf },
      offset: 0,
    });
    const start = performance.now();
    const counts = lemmaCounts(tokenizeReaderText(body).tokens, fresh.lemmatize);
    const c = measureCoverage(counts, fresh.pKnown);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(c.tokens).toBeGreaterThan(900);
  });
});
