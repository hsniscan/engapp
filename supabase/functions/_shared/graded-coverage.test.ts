// @vitest-environment node
// Coverage of graded texts against the word lists (decision 0047): the levels of running
// words, proper nouns left out, and the gate (≥ 95 % at or below the level, ≤ 3 % at level + 1,
// nothing above level + 2 unless glossed).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  checkCoverage,
  levelTableOf,
  parseLevelTable,
  profileObject,
  profileSentences,
  wordLevelOf,
} from './graded-coverage.ts';

const table = levelTableOf({
  cat: ['A1', 6],
  dog: ['A1', 6],
  run: ['A1', 6],
  go: ['A1', 6.5],
  big: ['A1', 6],
  house: ['A1', 6],
  journey: ['B1', 4.6],
  remarkable: ['B2', 4.1],
  ubiquitous: ['C1', 3.2],
  saturday: ['A1', 5],
  rare: [null, 3.5],
});

describe('word levels', () => {
  it('uses the list level of the word or of a base form', () => {
    expect(wordLevelOf('cats', table)).toEqual({ lemma: 'cat', cefr: 'A1' });
    expect(wordLevelOf('went', table)).toEqual({ lemma: 'go', cefr: 'A1' });
    expect(wordLevelOf('running', table)).toEqual({ lemma: 'run', cefr: 'A1' });
    expect(wordLevelOf('journeys', table)).toEqual({ lemma: 'journey', cefr: 'B1' });
  });

  it('treats function words as A1 and contractions as their base word', () => {
    expect(wordLevelOf('the', table)?.cefr).toBe('A1');
    expect(wordLevelOf("don't", table)?.cefr).toBe('A1');
    expect(wordLevelOf("won't", table)?.lemma).toBe('will');
  });

  it('falls back to frequency, then to "rarer than the data"', () => {
    expect(wordLevelOf('rare', table)?.cefr).toBe('B2'); // Zipf 3.5 → B2 band
    expect(wordLevelOf('zzyzx', table)?.cefr).toBe('C1'); // missing, below Zipf 3
  });
});

describe('profile', () => {
  it('leaves out names, keeps capitalised openers and quoted speech', () => {
    const p = profileSentences(
      ['Maria saw a big dog on Saturday.', 'She said, "My cat is big."', 'Cats run.'],
      table,
    );
    expect(p.properNouns).toEqual(['maria']);
    expect(p.lemmaCounts.get('my')).toBe(1);
    expect(p.lemmaCounts.get('saturday')).toBe(1);
    expect(p.lemmaCounts.get('cat')).toBe(2);
    expect(p.words).toBe(15);
    expect(p.tokens).toBe(14);
  });

  it('ignores numbers and punctuation', () => {
    const p = profileSentences(['The 3 cats, 2 dogs!'], table);
    expect(p.tokens).toBe(3);
  });

  it('stores the profile with sorted keys', () => {
    const p = profileSentences(['dog cat dog'], table);
    expect(Object.keys(profileObject(p))).toEqual(['cat', 'dog']);
    expect(profileObject(p)).toEqual({ cat: 1, dog: 2 });
  });
});

describe('the gate', () => {
  const easy = Array.from({ length: 20 }, () => 'The big cat and the dog go to the house.');

  it('passes an easy text', () => {
    const r = checkCoverage(profileSentences(easy, table), 'A2');
    expect(r.ok).toBe(true);
    expect(r.covLevel).toBe(1);
    expect(r.byLevel.A1).toBe(1);
  });

  it('fails when more than 3 % are at level + 1', () => {
    const text = [...easy, 'The journey, the journey, the journey, the journey, the journey, the journey, the journey, the journey.'];
    const r = checkCoverage(profileSentences(text, table), 'A2');
    expect(r.covNext).toBeGreaterThan(0.03);
    expect(r.problems).toContain('next_level');
    expect(r.offenders[0]).toBe('journey');
    expect(r.ok).toBe(false);
  });

  it('fails when fewer than 95 % are at or below the level', () => {
    const text = [...easy.slice(0, 6), 'remarkable remarkable remarkable remarkable journey journey'];
    const r = checkCoverage(profileSentences(text, table), 'A2');
    expect(r.covLevel).toBeLessThan(0.95);
    expect(r.problems).toContain('at_level');
  });

  it('allows a word above level + 2 only when glossed', () => {
    const text = [...easy, 'The cat is ubiquitous.'];
    const p = profileSentences(text, table);
    expect(checkCoverage(p, 'A2').aboveUnglossed).toEqual(['ubiquitous']);
    expect(checkCoverage(p, 'A2').ok).toBe(false);
    expect(checkCoverage(p, 'A2', new Set(['Ubiquitous'])).ok).toBe(true);
    // At B1 a C1 word is level + 2: allowed within the 5 %.
    expect(checkCoverage(p, 'B1').aboveUnglossed).toEqual([]);
  });

  it('an empty text never passes', () => {
    expect(checkCoverage(profileSentences([], table), 'B1').ok).toBe(false);
  });
});

describe('with the real level file', () => {
  const real = parseLevelTable(
    readFileSync(new URL('../../../data/levels/client-levels.tsv', import.meta.url), 'utf8'),
  );
  const fixture = JSON.parse(
    readFileSync(new URL('../../../scripts/lib/fixtures/graded/a2-travel-train.json', import.meta.url), 'utf8'),
  ) as { sentences: { en: string }[] };

  it('knows common words and their forms', () => {
    expect(wordLevelOf('went', real)?.lemma).toBe('go');
    expect(wordLevelOf('station', real)?.cefr).toMatch(/^A/);
    expect(real.minZipf).toBe(3);
  });

  it('passes a plain A2 text and fails it as A1-hard words pile up', () => {
    const p = profileSentences(fixture.sentences.map((s) => s.en), real);
    const r = checkCoverage(p, 'A2');
    expect(r.ok).toBe(true);
    expect(r.words).toBeGreaterThanOrEqual(150);
    const hard = profileSentences(
      [...fixture.sentences.map((s) => s.en), 'Nevertheless, the ubiquitous bureaucracy was an unprecedented predicament for the commuters, notwithstanding their resilience and meticulous contingency arrangements.'],
      real,
    );
    const h = checkCoverage(hard, 'A2');
    expect(h.ok).toBe(false);
    expect(h.offenders).toEqual(expect.arrayContaining(['ubiquitous', 'bureaucracy']));
  });
});
