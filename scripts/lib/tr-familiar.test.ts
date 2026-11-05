// @vitest-environment node
// Familiar international words (decision 0073): the loan-word spellings, the candidate rules,
// the review file, and the committed data (tr-familiar.tsv, its migration and the client level
// file) agreeing with each other. The full rebuild from the wordfreq wheel is
// `node scripts/build-tr-familiar.ts --check` (it downloads the pinned wheel once).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseLevelTable } from '../../supabase/functions/_shared/graded-coverage.ts';
import { listLevel } from '../../supabase/functions/_shared/level.ts';
import { falseFriendLemmas } from '../build-tr-familiar.ts';
import {
  applyReview,
  easierLevel,
  FAMILIAR_REASON_PREFIX,
  familiarMigration,
  findFamiliar,
  isRejected,
  parseFamiliarTsv,
  parseReview,
  turkishSpellings,
  type ListEntry,
} from './tr-familiar.ts';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

describe('turkishSpellings', () => {
  it.each([
    ['microphone', 'mikrofon'],
    ['penicillin', 'penisilin'],
    ['catalogue', 'katalog'],
    ['bureaucracy', 'bürokrasi'],
    ['panorama', 'panorama'],
    ['manicure', 'manikür'],
    ['mechanism', 'mekanizma'],
    ['democracy', 'demokrasi'],
    ['psychology', 'psikoloji'],
    ['university', 'üniversite'],
    ['television', 'televizyon'],
    ['helicopter', 'helikopter'],
    ['strategy', 'strateji'],
    ['organisation', 'organizasyon'],
  ])('%s can be spelled %s', (en, tr) => {
    expect(turkishSpellings(en)).toContain(tr);
  });

  it('only spells plain lower-case words', () => {
    expect(turkishSpellings('bus stop')).toEqual([]);
    expect(turkishSpellings("o'clock")).toEqual([]);
  });
});

describe('findFamiliar', () => {
  const list: ListEntry[] = [
    { lemma_norm: 'microphone', pos: 'noun', cefr: 'B2', source: 'cefrj' },
    { lemma_norm: 'television', pos: 'noun', cefr: 'A1', source: 'cefrj' }, // A1: cannot get easier
    { lemma_norm: 'actual', pos: 'adjective', cefr: 'B1', source: 'cefrj' }, // false friend
    { lemma_norm: 'forest', pos: 'noun', cefr: 'A2', source: 'cefrj' }, // English inside Turkish text
    { lemma_norm: 'panorama', pos: 'noun', cefr: 'C1', source: 'octanove' },
    { lemma_norm: 'chess', pos: 'noun', cefr: 'A2', source: 'cefrj' }, // "kes": too short
    { lemma_norm: 'penicillin', pos: 'noun', cefr: 'B2', source: 'cefrj' }, // rare in Turkish here
  ];
  const turkish = new Map([
    ['mikrofon', 3.9],
    ['televizyon', 4.8],
    ['aktüel', 3.5],
    ['forest', 3.3],
    ['panorama', 3.48],
    ['kes', 4.3],
    ['penisilin', 2.0],
  ]);
  const english = new Map([
    ['forest', 4.7],
    ['panorama', 3.39],
  ]);
  const found = findFamiliar(list, { turkish, english, falseFriends: new Set(['actual']) });

  it('keeps common Turkish loan words, one step easier', () => {
    expect(found.map((f) => [f.lemma_norm, f.cefr, f.cefr_tr, f.tr])).toEqual([
      ['microphone', 'B2', 'B1', 'mikrofon'],
      ['panorama', 'C1', 'B2', 'panorama'],
    ]);
  });

  it('never goes below A1', () => {
    expect(easierLevel('A1')).toBe('A1');
    expect(easierLevel('A2')).toBe('A1');
  });
});

describe('review file', () => {
  const review = parseReview('# c\nchemical\t*\tchance\npolice\t*\t=polis\naddress\tverb\tpartial\n');
  const m = (lemma_norm: string, pos: string, tr: string) => ({
    lemma_norm,
    pos,
    source: 'cefrj' as const,
    cefr: 'B1' as const,
    cefr_tr: 'A2' as const,
    tr,
    tr_zipf: 3,
  });

  it('rejects, renames or keeps a candidate', () => {
    const kept = applyReview(
      [m('chemical', 'noun', 'kemik'), m('police', 'noun', 'polise'), m('address', 'noun', 'adres'), m('address', 'verb', 'adres')],
      review,
    );
    expect(kept.map((k) => `${k.lemma_norm}/${k.pos}>${k.tr}`)).toEqual(['police/noun>polis', 'address/noun>adres']);
    expect(isRejected(review, { lemma_norm: 'chemical', pos: 'noun' })).toBe(true);
    expect(isRejected(review, { lemma_norm: 'police', pos: 'noun' })).toBe(false);
  });
});

describe('committed data', () => {
  const rows = parseFamiliarTsv(read('data/levels/tr-familiar.tsv'));
  const refs = new Set(
    read('data/levels/ref-word-levels.tsv')
      .split('\n')
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => l.split('\t').slice(0, 4).join('\t')),
  );
  const review = parseReview(read('data/levels/tr-familiar-review.tsv'));
  const falseFriends = falseFriendLemmas(read('data/reference/false-friends.en-tr.md'));

  it('has a few hundred words, including the known examples', () => {
    expect(rows.length).toBeGreaterThan(300);
    const lemmas = new Set(rows.map((r) => r.lemma_norm));
    for (const w of ['microphone', 'penicillin', 'catalogue', 'bureaucracy', 'panorama', 'manicure', 'mechanism'])
      expect(lemmas).toContain(w);
  });

  it('only holds list entries at their list level, one step easier, never a false friend or a rejected word', () => {
    expect(falseFriends.size).toBeGreaterThan(100);
    for (const r of rows) {
      expect(refs.has([r.lemma_norm, r.pos, r.cefr, r.source].join('\t')), r.lemma_norm).toBe(true);
      expect(r.cefr_tr).toBe(easierLevel(r.cefr));
      expect(r.cefr).not.toBe('A1');
      expect(falseFriends.has(r.lemma_norm), r.lemma_norm).toBe(false);
      expect(isRejected(review, r), r.lemma_norm).toBe(false);
    }
  });

  it('the migration is generated from the same rows', () => {
    expect(read('supabase/migrations/20261106000300_tr_familiar_levels.sql')).toBe(familiarMigration(rows));
  });

  it('the client level file carries every familiar word', () => {
    const text = read('data/levels/client-levels.tsv');
    const table = parseLevelTable(text);
    for (const r of rows) {
      const level = listLevel(
        table.get(r.lemma_norm)?.refs.filter((e) => e.pos === r.pos && e.source === r.source),
        r.pos,
      );
      expect(level?.cefr, r.lemma_norm).toBe(r.cefr_tr);
    }
    expect(text).toContain(`\nmicrophone\t3.72\tn:B2:j:B1:${FAMILIAR_REASON_PREFIX}mikrofon\n`);
  });
});
