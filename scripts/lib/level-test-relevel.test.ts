// @vitest-environment node
// The level test's bank on the Turkish-learner levels (decision 0073): words move to the level
// the client file gives them, the band sizes are recounted the same way, the run is idempotent,
// and the committed bank is up to date with the committed client file.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseLevelTable } from '../../supabase/functions/_shared/graded-coverage.ts';
import type { RefLookup } from '../../supabase/functions/_shared/level.ts';
import { listLemmas, relevelCommitted } from '../relevel-level-test.ts';
import { bandSizesOf, baseVersion, relevelBank, type LevelTestBank } from './level-test-relevel.ts';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

const word = (w: string) => ({ w, pos: 'noun', tr: w, d: ['a', 'b', 'c'] as [string, string, string] });
const lookupOf = (rows: Record<string, [string, string | null]>): RefLookup => (l) => {
  const r = rows[l];
  if (!r) return undefined;
  return { refs: [{ pos: 'noun', cefr: r[0] as 'B1', source: 'cefrj', tr_cefr: r[1] as 'A2' | null }], zipf: 4 };
};

describe('relevelBank', () => {
  const bank: LevelTestBank = {
    version: 'bank-x',
    band_sizes: { A1: 0, A2: 1, B1: 1, B2: 1, C1: 0, C2: 0 },
    levels: { A1: [], A2: [word('apple')], B1: [word('station')], B2: [word('microphone')], C1: [], C2: [] },
    pseudo: [],
  };
  const lookup = lookupOf({ apple: ['A2', null], station: ['B1', null], microphone: ['B2', 'B1'] });

  it('moves a corrected word and recounts the bands', () => {
    const { bank: out, moved } = relevelBank(bank, lookup, ['apple', 'station', 'microphone']);
    expect(moved).toEqual([{ w: 'microphone', pos: 'noun', from: 'B2', to: 'B1' }]);
    expect(out.levels.B1!.map((w) => w.w)).toEqual(['station', 'microphone']);
    expect(out.levels.B2).toEqual([]);
    expect(out.band_sizes).toMatchObject({ A2: 1, B1: 2, B2: 0 });
    expect(out.version).toMatch(/^bank-x\.tr-[0-9a-f]{6}$/);
    // Idempotent: a second run changes nothing, not even the version.
    const again = relevelBank(out, lookup, ['apple', 'station', 'microphone']);
    expect(again.moved).toEqual([]);
    expect(again.bank).toEqual(out);
    expect(baseVersion(out.version)).toBe('bank-x');
  });
});

describe('committed bank', () => {
  it('is up to date with the client level file (run node scripts/relevel-level-test.ts)', () => {
    const { before, bank, moved } = relevelCommitted();
    expect(moved).toEqual([]);
    expect(bank.version).toBe(before.version);
  });

  it('counts the bands like the original build when the corrections are left out', () => {
    const table = parseLevelTable(read('data/levels/client-levels.tsv'));
    const plain: RefLookup = (l) => {
      const r = table.get(l);
      return r && { ...r, refs: r.refs.map((e) => ({ ...e, tr_cefr: null })) };
    };
    // The sizes the bank was built with (bank-2026-10-1, from the plain list levels).
    expect(bandSizesOf(plain, listLemmas(read('data/levels/ref-word-levels.tsv')))).toEqual({
      A1: 1084,
      A2: 1272,
      B1: 2174,
      B2: 2490,
      C1: 929,
      C2: 896,
    });
  });
});
