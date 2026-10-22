import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  cleanContrastText,
  confusionRowId,
  contrastKey,
  contrastTerm,
  contrastTerms,
  damerauLevenshtein,
  pairKey,
  pickerTerms,
  rankPairs,
  scanConfusables,
  suggestedPairs,
  type ConfusableTerm,
} from './confusables';
import type { NoteTermType } from './types';

let n = 0;
function term(t: string, meanings: string[], type: NoteTermType = t.includes(' ') ? 'phrase' : 'word'): ConfusableTerm {
  const id = `n${++n}`;
  return {
    note_id: id,
    term: t,
    term_norm: t.toLowerCase(),
    term_type: type,
    senses: meanings.map((m, i) => ({ id: `${id}-s${i + 1}`, meaning: m, lexicon_sense_id: null })),
  };
}

/** Plain dynamic-programming reference (optimal string alignment). */
function osa(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  return d[a.length]![b.length]!;
}

describe('damerauLevenshtein', () => {
  it('counts substitutions, insertions, deletions and adjacent swaps', () => {
    expect(damerauLevenshtein('affect', 'effect')).toBe(1);
    expect(damerauLevenshtein('accept', 'except')).toBe(2);
    expect(damerauLevenshtein('form', 'from')).toBe(1);
    expect(damerauLevenshtein('quiet', 'quite')).toBe(1);
    expect(damerauLevenshtein('', 'abc')).toBe(3);
    expect(damerauLevenshtein('abc', 'abc')).toBe(0);
  });

  it('matches the reference, and the cut-off never hides a distance within it', () => {
    fc.assert(
      fc.property(fc.string({ unit: fc.constantFrom('a', 'b', 'c', 'd'), maxLength: 9 }), fc.string({ unit: fc.constantFrom('a', 'b', 'c', 'd'), maxLength: 9 }), (a, b) => {
        const ref = osa(a, b);
        expect(damerauLevenshtein(a, b)).toBe(ref);
        const capped = damerauLevenshtein(a, b, 2);
        if (ref <= 2) expect(capped).toBe(ref);
        else expect(capped).toBeGreaterThan(2);
      }),
      { numRuns: 400 },
    );
  });
});

describe('scanConfusables', () => {
  it('finds look-alike spellings (≤ 2 edits, 5+ letters) and shared Turkish meanings', () => {
    const affect = term('affect', ['etkilemek']);
    const effect = term('effect', ['etki, sonuç']);
    const accept = term('accept', ['kabul etmek']);
    const except = term('except', ['hariç']);
    const influence = term('influence', ['etkilemek, tesir etmek']);
    const lose = term('lose', ['kaybetmek']);
    const loose = term('loose', ['gevşek']);
    const pairs = scanConfusables([affect, effect, accept, except, influence, lose, loose]);
    const names = pairs.map((p) => `${p.a.term}/${p.b.term}:${p.reason}`);
    expect(names).toContain('affect/effect:spelling');
    expect(names).toContain('accept/except:spelling');
    expect(names).toContain('affect/influence:meaning');
    // "lose" has 4 letters: below the spelling rule (a user can still report the pair).
    expect(names.some((x) => x.startsWith('loose/lose') || x.startsWith('lose/loose'))).toBe(false);
    // The meaning pair names the senses that share the meaning.
    const meaning = pairs.find((p) => p.reason === 'meaning')!;
    expect([meaning.a.sense_id, meaning.b.sense_id].sort()).toEqual([affect.senses[0]!.id, influence.senses[0]!.id].sort());
  });

  it('leaves out one word family, derivations, roots and contrast cards', () => {
    const employ = term('employ', ['istihdam etmek']);
    const employer = term('employer', ['işveren']);
    const adapt = term('adapt', ['uyarlamak']);
    const adopt = term('adopt', ['benimsemek']);
    const spect = term('-spect-', ['bakmak'], 'affix');
    const inspect = term('inspect', ['bakmak'], 'word');
    const contrast = term('adapt ↔ adopt', ['x'], 'contrast');
    const families: Record<string, number> = { adapt: 7, adopt: 7 };
    const pairs = scanConfusables([employ, employer, adapt, adopt, spect, inspect, contrast], {
      familyOf: (t) => families[t] ?? null,
    });
    expect(pairs).toEqual([]);
    // Without the family data the two look-alikes are a pair.
    expect(scanConfusables([adapt, adopt]).map((p) => p.reason)).toEqual(['spelling']);
  });

  it('ignores meanings too common to be telling', () => {
    const many = Array.from({ length: 12 }, (_, i) => term(`verbum${String.fromCharCode(97 + i)}x${i}`, ['olmak']));
    expect(scanConfusables(many).filter((p) => p.reason === 'meaning')).toEqual([]);
  });

  it('is deterministic, order-independent and fast enough for a large library', () => {
    // 5 000 real English lemmas (the client level file), one meaning each.
    const lemmas = readFileSync('data/levels/client-levels.tsv', 'utf8')
      .split('\n')
      .filter((l) => l && !l.startsWith('#'))
      .slice(0, 5000)
      .map((l) => l.split('\t')[0]!);
    const words = lemmas.map((w, i) => term(w, [`anlam ${i}`]));
    const t0 = performance.now();
    const a = scanConfusables(words);
    const ms = performance.now() - t0;
    const b = scanConfusables([...words].reverse());
    expect(a.map((p) => p.key)).toEqual(b.map((p) => p.key));
    expect(a.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(3000);
  });
});

describe('pairs, keys and the picker', () => {
  it('keys are order-independent', async () => {
    expect(pairKey('Effect', 'affect')).toBe(pairKey('affect', 'effect'));
    expect(contrastKey('b-id', 'a-id')).toBe('a-id|b-id');
    expect(await confusionRowId('effect', 'Affect')).toBe(await confusionRowId('affect', 'effect'));
  });

  it('builds and parses the contrast term', () => {
    expect(contrastTerm('effect', 'affect')).toBe('affect ↔ effect');
    expect(contrastTerms('affect ↔ effect')).toEqual(['affect', 'effect']);
    expect(contrastTerms('affect')).toBeNull();
    expect(cleanContrastText('  bir\n satır  ')).toBe('bir satır');
    expect(cleanContrastText('   ')).toBeNull();
  });

  it('the picker puts near terms first and filters by term or meaning', () => {
    const affect = term('affect', ['etkilemek']);
    const effect = term('effect', ['etki']);
    const influence = term('influence', ['etkilemek']);
    const apple = term('apple', ['elma']);
    const all = [affect, effect, influence, apple];
    const near = scanConfusables(all);
    const list = pickerTerms(all, affect.note_id, '', near);
    expect(list.map((x) => [x.term.term, x.near])).toEqual([
      ['effect', 'spelling'],
      ['influence', 'meaning'],
      ['apple', null],
    ]);
    expect(pickerTerms(all, affect.note_id, 'elm', near).map((x) => x.term.term)).toEqual(['apple']);
  });

  it('suggested pairs: reported first, hidden and carded ones left out', () => {
    const affect = term('affect', ['etkilemek']);
    const effect = term('effect', ['etki']);
    const accept = term('accept', ['kabul etmek']);
    const except = term('except', ['hariç']);
    const scanned = scanConfusables([affect, effect, accept, except]);
    const ae = scanned.find((p) => p.a.term === 'accept')!;
    const reported = [{ ...ae, reason: 'reported' as const }];
    expect(suggestedPairs(scanned, reported, new Set(), new Set()).map((p) => [p.a.term, p.reason])).toEqual([
      ['accept', 'reported'],
      ['affect', 'spelling'],
    ]);
    expect(suggestedPairs(scanned, [], new Set([ae.key]), new Set([pairKey('affect', 'effect')]))).toEqual([]);
  });

  it('ranks: reported first, then pairs the learner forgets; harmless look-alikes stay out', () => {
    const affect = term('affect', ['etkilemek']);
    const effect = term('effect', ['etki']);
    const acorn = term('acorn', ['meşe palamudu']);
    const apron = term('apron', ['önlük']);
    const accept = term('accept', ['kabul etmek']);
    const except = term('except', ['hariç']);
    const scanned = scanConfusables([affect, effect, acorn, apron, accept, except]);
    const lapses: Record<string, number> = { [affect.note_id]: 6, [except.note_id]: 2 };
    const ranked = rankPairs(scanned, (id) => lapses[id] ?? 0);
    expect(ranked.map((p) => p.a.term)).toEqual(['affect', 'accept']);
    const reported = { ...scanned.find((p) => p.a.term === 'acorn')!, reason: 'reported' as const };
    expect(rankPairs([...scanned, reported], (id) => lapses[id] ?? 0)[0]!.a.term).toBe('acorn');
  });
});
