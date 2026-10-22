import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CEFR, levelRank } from './level';
import type { CefrLevel } from './types';
import {
  countByLevel,
  filterBank,
  mixTargets,
  ownedStatus,
  pickLevelMix,
  wordBankId,
  type OwnedTerms,
  type WordBankEntry,
} from './wordBank';

const entry = (
  lemma: string,
  cefr: CefrLevel,
  zipf: number | null = 4,
  pos = 'noun',
  meanings = ['anlam'],
): WordBankEntry => ({
  id: wordBankId(lemma, pos),
  lemma_norm: lemma,
  pos,
  lemma,
  cefr,
  list_source: levelRank(cefr) >= 4 ? 'octanove' : 'cefrj',
  zipf,
  lexicon_term_id: null,
  senses: meanings.map((m) => ({
    meaning_tr: m,
    example_en: `A ${lemma}.`,
    example_tr: 'Bir.',
    sense_id: null,
  })),
});

const none: OwnedTerms = { known: new Set(), carded: new Set() };
const ALL = { level: null, pos: null, query: '', showOwned: false } as const;

describe('filterBank', () => {
  const bank = [
    entry('apple', 'A1', 5, 'noun', ['elma']),
    entry('apply', 'B1', 4.5, 'verb', ['başvurmak', 'uygulamak']),
    entry('pineapple', 'B1', 3.5, 'noun', ['ananas']),
    entry('istanbul', 'A2', 4, 'noun', ['İstanbul']),
    entry('run', 'A1', 5.5, 'verb', ['koşmak']),
    entry('run', 'A2', 4.8, 'noun', ['koşu']),
  ];

  it('filters by level and part of speech, most frequent first', () => {
    expect(filterBank(bank, { ...ALL, level: 'A1' }, none).map((i) => i.entry.id)).toEqual([
      'run|verb',
      'apple|noun',
    ]);
    expect(filterBank(bank, { ...ALL, pos: 'verb' }, none).map((i) => i.entry.id)).toEqual([
      'run|verb',
      'apply|verb',
    ]);
  });

  it('searches English words first, then Turkish meanings (Turkish case rules)', () => {
    expect(
      filterBank(bank, { ...ALL, query: 'apple' }, none).map((i) => i.entry.lemma_norm),
    ).toEqual(['apple', 'pineapple']);
    expect(filterBank(bank, { ...ALL, query: 'app' }, none).map((i) => i.entry.lemma_norm)).toEqual(
      ['apple', 'apply', 'pineapple'],
    );
    expect(
      filterBank(bank, { ...ALL, query: 'UYGULA' }, none).map((i) => i.entry.lemma_norm),
    ).toEqual(['apply']);
    expect(filterBank(bank, { ...ALL, query: 'İSTANBUL' }, none).map((i) => i.entry.lemma)).toEqual(
      ['istanbul'],
    );
    expect(
      filterBank(bank, { ...ALL, query: 'basvur' }, none).map((i) => i.entry.lemma_norm),
    ).toEqual(['apply']);
    expect(filterBank(bank, { ...ALL, query: 'zzz' }, none)).toEqual([]);
  });

  it('hides known and carded words unless asked, and marks them', () => {
    const owned: OwnedTerms = { known: new Set(['apple', 'run']), carded: new Set(['run']) };
    expect(
      filterBank(bank, ALL, owned)
        .map((i) => i.entry.lemma_norm)
        .sort(),
    ).toEqual(['apply', 'istanbul', 'pineapple']);
    const shown = filterBank(bank, { ...ALL, showOwned: true }, owned);
    expect(shown.find((i) => i.entry.id === 'apple|noun')!.owned).toBe('known');
    expect(shown.find((i) => i.entry.id === 'run|verb')!.owned).toBe('carded');
    expect(countByLevel(bank, owned)).toEqual({ A1: 0, A2: 1, B1: 2, B2: 0, C1: 0, C2: 0 });
  });

  it('owned status uses the note key (case and typography folded)', () => {
    expect(
      ownedStatus({ lemma_norm: "o'clock" }, { known: new Set(["o'clock"]), carded: new Set() }),
    ).toBe('known');
  });
});

describe('pickLevelMix', () => {
  const many = (cefr: CefrLevel, k: number, prefix = cefr.toLowerCase()) =>
    Array.from({ length: k }, (_, i) => entry(`${prefix}w${i}`, cefr, 6 - i / 100));
  const full = CEFR.flatMap((l) => many(l, 30));
  const counts = (xs: WordBankEntry[]) => {
    const c: Record<string, number> = {};
    for (const e of xs) c[e.cefr] = (c[e.cefr] ?? 0) + 1;
    return c;
  };

  it('the owner’s rule for 10 words at B1: 6 B1, 1 B2, 3 lower (nearest first), most frequent first', () => {
    expect(mixTargets('B1', 10)).toEqual({ own: 6, up: 1, lower: 3 });
    const got = pickLevelMix(full, none, 'B1', 10);
    expect(counts(got)).toEqual({ A2: 3, B1: 6, B2: 1 });
    expect(got.filter((e) => e.cefr === 'B1').map((e) => e.lemma_norm)).toEqual([
      'b1w0',
      'b1w1',
      'b1w2',
      'b1w3',
      'b1w4',
      'b1w5',
    ]);
  });

  it('A1 has nothing lower: the rest comes from A1; C2 has nothing above', () => {
    expect(counts(pickLevelMix(full, none, 'A1', 10))).toEqual({ A1: 9, A2: 1 });
    expect(counts(pickLevelMix(full, none, 'C2', 10))).toEqual({ C1: 4, C2: 6 });
  });

  it('never picks known or carded words, one entry per lemma', () => {
    const bank = [...many('B1', 8), entry('b1w0', 'B1', 7, 'verb'), ...many('A2', 5)];
    const owned: OwnedTerms = { known: new Set(['b1w1']), carded: new Set(['b1w2']) };
    const got = pickLevelMix(bank, owned, 'B1', 10);
    expect(got.map((e) => e.lemma_norm)).not.toContain('b1w1');
    expect(got.map((e) => e.lemma_norm)).not.toContain('b1w2');
    expect(new Set(got.map((e) => e.lemma_norm)).size).toBe(got.length);
  });

  it('property: never above X+1, X+1 within its share, own level as planned, nothing owned', () => {
    const level = fc.constantFrom(...CEFR);
    const bankArb = fc.array(
      fc.record({
        lemma: fc.stringMatching(/^[a-z]{1,6}$/),
        cefr: level,
        zipf: fc.option(fc.double({ min: 0, max: 8, noNaN: true }), { nil: null }),
        pos: fc.constantFrom('noun', 'verb'),
      }),
      { maxLength: 120 },
    );
    fc.assert(
      fc.property(
        bankArb,
        level,
        fc.integer({ min: 0, max: 30 }),
        fc.array(fc.stringMatching(/^[a-z]{1,6}$/), { maxLength: 20 }),
        (rows, lvl, n, ownedWords) => {
          const bank = rows.map((r) => entry(r.lemma, r.cefr, r.zipf, r.pos));
          const owned: OwnedTerms = {
            known: new Set(ownedWords.slice(0, 10)),
            carded: new Set(ownedWords.slice(10)),
          };
          const got = pickLevelMix(bank, owned, lvl, n);
          const x = levelRank(lvl);
          const t = mixTargets(lvl, n);
          expect(got.length).toBeLessThanOrEqual(n);
          expect(new Set(got.map((e) => e.lemma_norm)).size).toBe(got.length);
          for (const e of got) {
            expect(levelRank(e.cefr)).toBeLessThanOrEqual(x + 1);
            expect(ownedStatus(e, owned)).toBeNull();
            expect(bank).toContain(e);
          }
          const up = got.filter((e) => levelRank(e.cefr) === x + 1).length;
          expect(up).toBeLessThanOrEqual(Math.floor(n * 0.1));
          // Availability per level (distinct lemmas, best entry each, not owned).
          const free = new Map<string, number>();
          for (const e of [...bank].sort(
            (a, b) =>
              (b.zipf ?? -1) - (a.zipf ?? -1) ||
              a.lemma_norm.localeCompare(b.lemma_norm, 'en') ||
              a.pos.localeCompare(b.pos),
          ))
            if (!free.has(e.lemma_norm) && !ownedStatus(e, owned))
              free.set(e.lemma_norm, levelRank(e.cefr));
          const avail = (pred: (r: number) => boolean) => [...free.values()].filter(pred).length;
          const ownAvail = avail((r) => r === x);
          const lowerAvail = avail((r) => r < x);
          const upAvail = avail((r) => r === x + 1);
          const own = got.filter((e) => levelRank(e.cefr) === x).length;
          expect(own).toBeGreaterThanOrEqual(Math.min(t.own, ownAvail));
          // As many as can be had under the rule.
          expect(got.length).toBe(Math.min(n, ownAvail + lowerAvail + Math.min(t.up, upAvail)));
          // With plenty of every level, the own level is about 55 %.
          if (ownAvail >= n && lowerAvail >= n && x > 0) expect(own).toBe(t.own);
        },
      ),
    );
  });
});
