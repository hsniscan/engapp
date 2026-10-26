import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CEFR, levelRank } from './level';
import type { WordStage } from './stages';
import {
  deckProgress,
  deckWords,
  deckWordStatus,
  featuredSpec,
  forYouSpecs,
  knownShare,
  levelSpread,
  multiPosLemmas,
  type OwnedIndex,
  parseSuggestedKey,
  posLevelCounts,
  type SuggestedSpec,
  suggestedKey,
  TOP_SIZES,
  wordsToAdd,
} from './suggestedDecks';
import type { CefrLevel } from './types';
import { wordBankId, type WordBankEntry } from './wordBank';

const entry = (lemma: string, cefr: CefrLevel, zipf: number | null, pos = 'noun'): WordBankEntry => ({
  id: wordBankId(lemma, pos),
  lemma_norm: lemma,
  pos,
  lemma,
  cefr,
  list_source: levelRank(cefr) >= 4 ? 'octanove' : 'cefrj',
  zipf,
  lexicon_term_id: null,
  senses: [{ meaning_tr: 'anlam', example_en: `A ${lemma}.`, example_tr: 'Bir.', sense_id: null }],
});

const none: OwnedIndex = { known: new Set(), stage: new Map() };
const owned = (known: string[], stages: Record<string, WordStage>): OwnedIndex => ({
  known: new Set(known),
  stage: new Map(Object.entries(stages)),
});

describe('keys', () => {
  const specs: SuggestedSpec[] = [
    ...TOP_SIZES.map((size) => ({ kind: 'top', size }) as const),
    ...CEFR.map((level) => ({ kind: 'level', level }) as const),
    { kind: 'pos', pos: 'verb' },
    { kind: 'pos', pos: 'adverb' },
    { kind: 'levelPos', level: 'B1', pos: 'adjective' },
    { kind: 'falseFriends' },
  ];

  it('round-trips every deck', () => {
    for (const s of specs) expect(parseSuggestedKey(suggestedKey(s))).toEqual(s);
    expect(suggestedKey({ kind: 'levelPos', level: 'B1', pos: 'verb' })).toBe('b1-verb');
  });

  it('rejects unknown keys', () => {
    for (const k of ['', 'top-42', 'level-d1', 'pos-preposition', 'b1-preposition', 'b1-verb-x', 'x'])
      expect(parseSuggestedKey(k)).toBeNull();
  });

  it('never throws on any string', () => {
    fc.assert(fc.property(fc.string(), (s) => void parseSuggestedKey(s)));
  });
});

describe('deckWords', () => {
  const bank = [
    entry('time', 'A1', 6.5),
    entry('make', 'A1', 6.3, 'verb'),
    entry('the', 'A1', 7.7, 'determiner'),
    entry('run', 'A1', 5.5, 'verb'),
    entry('run', 'A2', 4.8, 'noun'),
    entry('avoid', 'B1', 4.6, 'verb'),
    entry('suggest', 'B1', 4.9, 'verb'),
    entry('vivid', 'B2', 3.9, 'adjective'),
    entry('rare', 'B1', null, 'adjective'),
  ];

  it('top-N: content words only, one row per word, most frequent first', () => {
    const words = deckWords(bank, { kind: 'top', size: 100 });
    expect(words.map((w) => w.id)).toEqual([
      'time|noun',
      'make|verb',
      'run|verb',
      'suggest|verb',
      'avoid|verb',
      'vivid|adjective',
      'rare|adjective',
    ]);
    // Function words and auxiliaries stay out, even with a content reading.
    const withFn = [
      ...bank,
      entry('in', 'A1', 7.5, 'preposition'),
      entry('in', 'A2', 7.5, 'adverb'),
      entry('can', 'A1', 6.4, 'verb'),
      entry('can', 'A2', 6.4, 'noun'),
      entry('is', 'A1', 7.6, 'verb'),
    ];
    expect(deckWords(withFn, { kind: 'level', level: 'A1' }).map((w) => w.lemma)).not.toContain('is');
    expect(deckWords(withFn, { kind: 'top', size: 100 }).map((w) => w.lemma)).not.toContain('in');
    expect(deckWords(withFn, { kind: 'top', size: 100 }).map((w) => w.lemma)).not.toContain('can');
    expect(deckWords(withFn, { kind: 'level', level: 'A1' }).map((w) => w.lemma)).toContain('in');
    const big = Array.from({ length: 150 }, (_, i) => entry(`w${i}`, 'A2', 5 - i / 100));
    expect(deckWords(big, { kind: 'top', size: 100 })).toHaveLength(100);
    expect(deckWords(big, { kind: 'top', size: 100 })[0]!.lemma).toBe('w0');
  });

  it('level, part of speech and both', () => {
    expect(deckWords(bank, { kind: 'level', level: 'A1' }).map((w) => w.lemma)).toEqual([
      'the',
      'time',
      'make',
      'run',
    ]);
    expect(deckWords(bank, { kind: 'pos', pos: 'verb' }).map((w) => w.lemma)).toEqual([
      'make',
      'run',
      'suggest',
      'avoid',
    ]);
    expect(
      deckWords(bank, { kind: 'levelPos', level: 'B1', pos: 'verb' }).map((w) => w.lemma),
    ).toEqual(['suggest', 'avoid']);
  });

  it('false friends come from the table it is given', () => {
    expect(deckWords(bank, { kind: 'falseFriends' })).toEqual([]);
    expect(
      deckWords(bank, { kind: 'falseFriends' }, { falseFriends: new Set(['vivid', 'avoid']) }).map(
        (w) => w.lemma,
      ),
    ).toEqual(['avoid', 'vivid']);
  });

  it('counts per level and per part of speech', () => {
    expect(levelSpread(deckWords(bank, { kind: 'top', size: 100 }))).toEqual({
      A1: 3,
      A2: 0,
      B1: 3,
      B2: 1,
      C1: 0,
      C2: 0,
    });
    const c = posLevelCounts(bank);
    expect(c.verb).toEqual({ A1: 2, A2: 0, B1: 2, B2: 0, C1: 0, C2: 0 });
    expect(c.noun.A2).toBe(1);
  });
});

describe('the user side', () => {
  const words = [
    entry('time', 'A1', 6),
    entry('make', 'A1', 6, 'verb'),
    entry('government', 'A2', 5),
    entry('provide', 'B1', 5, 'verb'),
    entry('likely', 'A2', 5, 'adjective'),
  ];
  const idx = owned(['time', 'likely', 'make'], { make: 'learned', government: 'consolidating' });

  it('a card beats Biliyorum; learned and mastered count as learned', () => {
    expect(deckWordStatus(words[0]!, idx)).toBe('known');
    expect(deckWordStatus(words[1]!, idx)).toBe('learned');
    expect(deckWordStatus(words[2]!, idx)).toBe('studying');
    expect(deckWordStatus(words[3]!, idx)).toBe('new');
    expect(deckWordStatus(words[0]!, owned([], { time: 'mastered' }))).toBe('learned');
    expect(deckWordStatus(words[0]!, owned([], { time: 'new' }))).toBe('studying');
  });

  it('progress adds up and never re-adds owned words', () => {
    const p = deckProgress(words, idx);
    expect(p).toEqual({ total: 5, learned: 1, studying: 1, known: 2, fresh: 1 });
    expect(knownShare(p)).toBeCloseTo(3 / 5);
    expect(wordsToAdd(words, idx).map((w) => w.lemma)).toEqual(['provide']);
  });

  it('property: wordsToAdd never returns a known or carded word', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f'), { maxLength: 6 }),
        fc.array(fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f'), { maxLength: 6 }),
        (known, carded) => {
          const ws = ['a', 'b', 'c', 'd', 'e', 'f'].map((l) => entry(l, 'A1', 4));
          const ix = owned(known, Object.fromEntries(carded.map((c) => [c, 'learning' as const])));
          for (const w of wordsToAdd(ws, ix)) {
            expect(known).not.toContain(w.lemma);
            expect(carded).not.toContain(w.lemma);
          }
          const p = deckProgress(ws, ix);
          expect(p.learned + p.studying + p.known + p.fresh).toBe(p.total);
        },
      ),
    );
  });
});

describe('suggestions', () => {
  const bank = [
    ...Array.from({ length: 10 }, (_, i) => entry(`bverb${i}`, 'B1', 4, 'verb')),
    ...Array.from({ length: 10 }, (_, i) => entry(`badj${i}`, 'B1', 4, 'adjective')),
    ...Array.from({ length: 10 }, (_, i) => entry(`b2verb${i}`, 'B2', 4, 'verb')),
    ...Array.from({ length: 10 }, (_, i) => entry(`b2adj${i}`, 'B2', 4, 'adjective')),
  ];

  it('features the level verbs first, then moves on once they are mostly owned', () => {
    expect(featuredSpec(bank, none, 'B1')).toEqual({ kind: 'levelPos', level: 'B1', pos: 'verb' });
    const verbsKnown = owned(
      Array.from({ length: 10 }, (_, i) => `bverb${i}`),
      {},
    );
    expect(featuredSpec(bank, verbsKnown, 'B1')).toEqual({
      kind: 'levelPos',
      level: 'B1',
      pos: 'adjective',
    });
    // C2 has no level above and nothing in the bank.
    expect(featuredSpec(bank, none, 'C2')).toBeNull();
  });

  it('for you: the level first, then one above, without the featured deck', () => {
    const featured = featuredSpec(bank, none, 'B1');
    expect(forYouSpecs(bank, none, 'B1', featured).map((x) => [suggestedKey(x.spec), x.upLevel])).toEqual([
      ['b1-adjective', false],
      ['b2-verb', true],
    ]);
  });
});

describe('multiPosLemmas', () => {
  it('finds words listed under two parts of speech', () => {
    const rows = [entry('go', 'A1', 6, 'verb'), entry('go', 'A2', 6, 'noun'), entry('table', 'A1', 5, 'noun'), entry('table', 'B1', 4, 'noun')];
    expect([...multiPosLemmas(rows)]).toEqual(['go']);
    expect(multiPosLemmas([])).toEqual(new Set());
  });
});
