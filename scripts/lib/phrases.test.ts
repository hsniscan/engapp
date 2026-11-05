// @vitest-environment node
// Phrasal verbs and collocations (decision 0074): Wiktionary titles, corpus counts with the
// particle split, association, ranking and levels. No network.
import { describe, expect, it } from 'vitest';
import { parseLevelIndex } from './example-match.ts';
import {
  CollocationCounter,
  collocationStats,
  levelFor,
  parseCategoryPage,
  PHRASAL_BANDS,
  PhrasalCounter,
  phrasalVerbOf,
  posPredicate,
  rankCollocations,
  rankPhrasals,
  sentences,
  tokens,
  wikiText,
  zipfOf,
} from './phrases.ts';

const LEVEL_FILE = [
  'give\t6\tv:A1:j',
  'look\t6\tv:A1:j',
  'turn\t5.5\tv:A1:j|n:A2:j',
  'make\t6.5\tv:A1:j',
  'take\t6.5\tv:A1:j',
  'pay\t5.5\tv:A1:j',
  'decision\t5\tn:B1:j',
  'photo\t5\tn:A1:j',
  'attention\t5\tn:B1:j',
  'radio\t5\tn:A1:j',
  'mistake\t5\tn:A2:j',
  'bus stop\t3\tn:A1:j',
  'album\t4\tn:B1:j',
].join('\n');
const LEVELS = parseLevelIndex(LEVEL_FILE);
const isVerb = posPredicate(LEVEL_FILE, 'v');
const isNoun = posPredicate(LEVEL_FILE, 'n');

describe('Wiktionary titles', () => {
  it('reads category pages and keeps verb + particle titles only', () => {
    expect(
      parseCategoryPage({
        continue: { cmcontinue: 'page|abc' },
        query: { categorymembers: [{ ns: 0, title: 'give up' }, { ns: 14, title: 'Category:x' }] },
      }),
    ).toEqual({ titles: ['give up'], next: 'page|abc' });
    expect(parseCategoryPage({ query: { categorymembers: [] } }).next).toBeNull();
    expect(phrasalVerbOf('give up', isVerb)).toBe('give up');
    expect(phrasalVerbOf('look forward to', isVerb)).toBe('look forward to');
    expect(phrasalVerbOf('give someone up', isVerb)).toBeNull();
    expect(phrasalVerbOf("make up one's mind", isVerb)).toBeNull();
    expect(phrasalVerbOf('Give up', isVerb)).toBeNull();
    expect(phrasalVerbOf('give way', isVerb)).toBeNull(); // "way" is not a particle
    expect(phrasalVerbOf('glorp up', isVerb)).toBeNull(); // not a verb of the lists
  });
});

describe('corpus helpers', () => {
  it('tokenises with breaks at punctuation, strips wiki markup and splits sentences', () => {
    expect(tokens("Don't stop, go.")).toEqual(["don't", 'stop', null, 'go', null, null]);
    expect(wikiText("'''Paris''' is the [[capital city|capital]] of [[France]].<ref>x</ref>")).toBe(
      'Paris is the capital of France. ',
    );
    expect(wikiText('{{Infobox}}')).toBeNull();
    expect(wikiText('[[Category:Cities]]')).toBeNull();
    expect(sentences('It rains. We stay home! Okay then')).toEqual(['It rains.', 'We stay home!', 'Okay then']);
  });
});

describe('counting', () => {
  it('counts phrasal verbs in any form, split by a short object, once per sentence', () => {
    const c = new PhrasalCounter(['give up', 'turn down', 'look forward to', 'look up']);
    for (const s of [
      'Never give up.',
      'He gave it up, then gave up again.',
      'She is giving up smoking.',
      'Turn the radio down.',
      'They turned down the offer.',
      'I look forward to it.',
      'Look at the sky up there.', // "at" is a preposition: not "look up"
      'Give, up!', // across punctuation: no
    ])
      c.add(s);
    expect(c.counts.get('give up')).toBe(3);
    expect(c.counts.get('turn down')).toBe(2);
    expect(c.counts.get('look forward to')).toBe(1);
    expect(c.counts.get('look up')).toBe(0);
    expect(c.words).toBeGreaterThan(20);
  });

  it('counts verb + noun collocations with their article and association', () => {
    const c = new CollocationCounter(['make', 'take', 'pay'], isNoun);
    for (let k = 0; k < 9; k++) c.add('You must make a decision now.');
    c.add('She made the decision.');
    for (let k = 0; k < 10; k++) c.add('Please pay attention.');
    c.add('Take a photo album.'); // the noun does not end the phrase
    c.add('Take my photo.'); // possessive
    const stats = collocationStats([c]);
    const dec = stats.find((s) => s.noun === 'decision')!;
    expect(dec).toMatchObject({ verb: 'make', det: 'a', totals: { counts: [10] } });
    expect(dec.logDice).toBeGreaterThan(10);
    expect(stats.find((s) => s.noun === 'attention')).toMatchObject({ det: '' });
    expect(stats.find((s) => s.noun === 'photo')).toBeUndefined();
    const rows = rankCollocations(stats, LEVELS, {
      size: 10,
      minCount: 8,
      minLogDice: 6,
      version: 't',
      exclude: new Set(),
    });
    expect(rows.map((r) => [r.lemma_norm, r.cefr, r.pos, r.source])).toEqual([
      ['make a decision', 'B1', 'phrase', 'corpus'],
      ['pay attention', 'B1', 'phrase', 'corpus'],
    ]);
  });
});

describe('levels and ranking', () => {
  it('levels by rank, never below the hardest word', () => {
    expect(levelFor(1, PHRASAL_BANDS, 0)).toBe('A1');
    expect(levelFor(100, PHRASAL_BANDS, 0)).toBe('B1');
    expect(levelFor(1, PHRASAL_BANDS, 3)).toBe('B2');
    expect(levelFor(999, PHRASAL_BANDS, null)).toBe('C2');
    expect(zipfOf(1)).toBe(3);
    expect(zipfOf(0)).toBe(0);
  });

  it('ranks phrasal verbs by their average rate over the corpora', () => {
    const rows = rankPhrasals(
      new Map([
        ['give up', { counts: [50, 10], words: [1e5, 1e5] }],
        ['turn down', { counts: [5, 40], words: [1e5, 1e5] }],
        ['look up', { counts: [2, 1], words: [1e5, 1e5] }],
      ]),
      LEVELS,
      { size: 10, minCount: 5, version: 'v' },
    );
    expect(rows.map((r) => r.lemma_norm)).toEqual(['give up', 'turn down']);
    expect(rows[0]).toMatchObject({ pos: 'phrasal verb', source: 'wiktionary', cefr: 'A1', corpus_count: 60, source_version: 'v' });
    expect(rows[0]!.zipf).toBeCloseTo(zipfOf(300), 2);
  });
});
