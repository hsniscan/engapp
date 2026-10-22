import clientLevels from '../../data/levels/client-levels.tsv?raw';
import { describe, expect, it } from 'vitest';
import { levelSortKey, noteLevel, parseClientLevels, senseLevel, storedLevel, withOverride } from './level';
import type { LexiconSense } from './types';

const FILE = [
  '# Engapp word-level data (test)',
  '# @min_zipf 3',
  'television\t4.9\tn:A1:j',
  'abandon\t3.9\tv:B1:j:B2:Türkçede soyut: kalıcı',
  'light\t5.3\tn:A1:j|j:A2:j|v:B1:j|v:B1:o',
  'ubiquitous\t3.2\tj:C2:o',
  'gadget\t3.5\t',
  'broken line',
  'odd\t4.1\tq:A1:j|n:Z9:j|n:B1:k',
].join('\n');

const data = parseClientLevels(FILE);

const lex = (over: Partial<LexiconSense> = {}): LexiconSense => ({
  id: 'l1',
  term_id: 't1',
  lemma: 'abandon',
  lemma_norm: 'abandon',
  term_type: 'word',
  pos: 'verb',
  gloss_en: 'leave',
  meaning_tr: 'terk etmek',
  ipa: null,
  updated_at: 1,
  ...over,
});
const note = (term_norm: string, level_override: LexiconSense['cefr'] = null) => ({
  term_norm,
  term_type: 'word' as const,
  level_override,
});

describe('parseClientLevels', () => {
  it('reads entries, corrections, frequency and coverage, and skips bad parts', () => {
    expect(data.minZipf).toBe(3);
    expect(data.lookup('television')).toEqual({
      zipf: 4.9,
      refs: [{ pos: 'noun', cefr: 'A1', source: 'cefrj', tr_cefr: null, tr_reason: null }],
    });
    // A reason may contain ":".
    expect(data.lookup('abandon')!.refs[0]).toMatchObject({ tr_cefr: 'B2', tr_reason: 'Türkçede soyut: kalıcı' });
    expect(data.lookup('light')!.refs).toHaveLength(4);
    expect(data.lookup('gadget')).toEqual({ zipf: 3.5, refs: [] });
    expect(data.lookup('odd')!.refs).toEqual([]);
    expect(data.lookup('broken line')).toEqual({ zipf: null, refs: [] });
    expect(data.lookup('nope')).toBeUndefined();
  });

  it('parses the committed client file', () => {
    const real = parseClientLevels(clientLevels);
    expect(real.size).toBeGreaterThan(25_000);
    expect(real.minZipf).toBe(3);
    expect(real.lookup('television')!.refs[0]).toMatchObject({ cefr: 'A1', source: 'cefrj' });
    expect(real.lookup('aberration')!.refs[0]).toMatchObject({ cefr: 'C2', source: 'octanove' });
  });
});

describe('levels on the client', () => {
  it('a level stored with the lexicon sense wins over the client file', () => {
    const stored = lex({ cefr: 'C1', cefr_source: 'ai', cefr_list: null, cefr_reason_tr: null });
    expect(senseLevel(note('abandon'), { pos: 'verb' }, stored, data)).toEqual({
      cefr: 'C1',
      source: 'ai',
      list_cefr: null,
      reason_tr: null,
    });
    expect(storedLevel(lex({ cefr: 'B1', cefr_source: null }))).toBeNull();
  });

  it('falls back to the rule on the client file (with its corrections)', () => {
    expect(senseLevel(note('abandon'), { pos: 'verb' }, lex(), data)).toMatchObject({
      cefr: 'B2',
      source: 'cefrj',
      list_cefr: 'B1',
      reason_tr: 'Türkçede soyut: kalıcı',
    });
    expect(senseLevel(note('gadget'), null, undefined, data)).toMatchObject({ cefr: 'B2', source: 'freq' });
    // Missing from data that covers Zipf >= 3: rare.
    expect(senseLevel(note('quixotry'), null, undefined, data)).toMatchObject({ cefr: 'C1', source: 'freq' });
    expect(senseLevel(note('gadget'), null, undefined, null)).toBeNull();
  });

  it('a root/affix card (İP6) has no computed level', () => {
    expect(senseLevel({ term_norm: 'spect', term_type: 'affix' }, { pos: 'root' }, undefined, data)).toBeNull();
  });

  it('noteLevel: first sense with a level, then the override', () => {
    const lexOf = (id: string) => (id === 'l-adj' ? lex({ id, lemma_norm: 'light', pos: 'adjective' }) : undefined);
    const senses = [
      { pos: null, lexicon_sense_id: 'missing' },
      { pos: 'adjective', lexicon_sense_id: 'l-adj' },
    ];
    // The first sense has no pos: the easiest entry (A1); it has a level, so it is used.
    expect(noteLevel(note('light'), senses, lexOf, data)?.cefr).toBe('A1');
    expect(noteLevel(note('light'), senses.slice(1), lexOf, data)?.cefr).toBe('A2');
    const own = noteLevel(note('light', 'C2'), senses.slice(1), lexOf, data)!;
    expect(own).toMatchObject({ cefr: 'C2', source: 'user', auto: { cefr: 'A2', source: 'cefrj' } });
    expect(noteLevel(note('zzz'), [], lexOf, null)).toBeNull();
    expect(noteLevel(note('zzz', 'B1'), [], lexOf, null)).toMatchObject({ cefr: 'B1', source: 'user', auto: null });
  });

  it('withOverride and levelSortKey', () => {
    expect(withOverride(null, null)).toBeNull();
    const auto = { cefr: 'B1' as const, source: 'freq' as const, list_cefr: null, reason_tr: null };
    expect(withOverride(auto, null)).toEqual({ ...auto, auto });
    expect(levelSortKey(withOverride(auto, 'A2'))).toBe(1);
    expect(levelSortKey(null)).toBe(6);
  });
});
