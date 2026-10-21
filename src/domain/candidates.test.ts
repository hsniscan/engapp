import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BUCKETS,
  compareCandidates,
  levelBand,
  occurrenceCounter,
  planCandidates,
  selectionQuota,
  targetLevel,
  type CandidateFacts,
} from './candidates';
import { CEFR, levelRank } from './level';
import type { CefrLevel } from './types';

let seq = 0;
const item = (cefr: CefrLevel | null, over: Partial<CandidateFacts> = {}): CandidateFacts => {
  seq++;
  return {
    id: `c${seq}`,
    key: `term${seq}`,
    cefr,
    occurrences: 1,
    zipf: null,
    hasNote: false,
    fromList: false,
    order: seq,
    ...over,
  };
};

const levelArb = fc.constantFrom(...CEFR);
const factsArb = fc.array(
  fc.record({
    cefr: fc.option(levelArb, { nil: null, freq: 8 }),
    occurrences: fc.integer({ min: 1, max: 6 }),
    zipf: fc.option(fc.double({ min: 1, max: 7, noNaN: true }), { nil: null }),
    hasNote: fc.integer({ min: 0, max: 11 }).map((n) => n === 0),
    knownTerm: fc.boolean(),
    fromList: fc.boolean(),
  }),
  { maxLength: 80 },
);

interface Raw {
  cefr: CefrLevel | null;
  occurrences: number;
  zipf: number | null;
  hasNote: boolean;
  knownTerm: boolean;
  fromList: boolean;
}

function build(raw: Raw[]): { items: CandidateFacts[]; known: Set<string> } {
  const items = raw.map((r, i) => ({
    id: `c${i}`,
    key: `k${i}`,
    cefr: r.cefr,
    occurrences: r.occurrences,
    zipf: r.zipf,
    hasNote: r.hasNote, // ~1 in 12
    fromList: r.fromList,
    order: i,
  }));
  const known = new Set<string>(
    raw.flatMap((r, i) => (!r.hasNote && r.knownTerm && i % 5 === 0 ? [`k${i}`] : [])),
  );
  return { items, known };
}

describe('levelBand / targetLevel', () => {
  it('places levels relative to the learner; unknown counts as the next level', () => {
    expect(levelBand('B1', 'B1')).toBe('same');
    expect(levelBand('B2', 'B1')).toBe('next');
    expect(levelBand('C1', 'B1')).toBe('above');
    expect(levelBand('A1', 'B1')).toBe('lower');
    expect(levelBand(null, 'B1')).toBe('next');
    expect(targetLevel('B1')).toBe('B2');
    expect(targetLevel('C2')).toBe('C2');
  });
});

describe('selectionQuota', () => {
  it('small counts: nothing without a word at the level; L+1 only from 10 selected words on', () => {
    expect(selectionQuota(0, 5, 5)).toEqual({ same: 0, next: 0, lower: 0 });
    expect(selectionQuota(1, 5, 5)).toEqual({ same: 1, next: 0, lower: 0 });
    expect(selectionQuota(2, 5, 5)).toEqual({ same: 2, next: 0, lower: 1 });
    expect(selectionQuota(5, 5, 5)).toEqual({ same: 5, next: 0, lower: 4 });
    expect(selectionQuota(6, 5, 5)).toEqual({ same: 6, next: 1, lower: 3 });
    expect(selectionQuota(11, 5, 50)).toEqual({ same: 11, next: 2, lower: 7 });
  });

  it('not enough lower-level words: the gap is never filled with L+1', () => {
    expect(selectionQuota(11, 50, 0)).toEqual({ same: 11, next: 1, lower: 0 });
    expect(selectionQuota(3, 50, 0)).toEqual({ same: 3, next: 0, lower: 0 });
  });

  it('is the largest set that keeps both ratios (brute force on small counts)', () => {
    for (let s = 0; s <= 25; s++)
      for (let n = 0; n <= 6; n++)
        for (let l = 0; l <= 25; l++) {
          let best = 0;
          if (s > 0)
            for (let u = 0; u <= n; u++)
              for (let d = 0; d <= l; d++) {
                const t = s + u + d;
                if (20 * s >= 11 * t && 10 * u <= t) best = Math.max(best, t);
              }
          const q = selectionQuota(s, n, l);
          expect(q.same + q.next + q.lower, `s=${s} n=${n} l=${l}`).toBe(best);
        }
  });
});

describe('planCandidates', () => {
  it('B1: B1 words first, a few B2, the rest A1–A2; C1+ never; known never selected', () => {
    seq = 0;
    const items = [
      ...Array.from({ length: 11 }, () => item('B1')),
      ...Array.from({ length: 4 }, () => item('B2')),
      ...Array.from({ length: 8 }, (_, i) => item(i < 4 ? 'A2' : 'A1')),
      item('C1'),
      item('C2'),
      item('B1', { hasNote: true }),
      item('B1', { key: 'reluctant' }),
    ];
    const plan = planCandidates(items, 'B1', new Set(['reluctant']));
    const level = new Map(items.map((c) => [c.id, c.cefr]));
    const sel = plan.rows.filter((r) => r.selected).map((r) => level.get(r.id));
    expect(sel.filter((l) => l === 'B1')).toHaveLength(11);
    expect(sel.filter((l) => l === 'B2')).toHaveLength(2);
    expect(sel.filter((l) => l === 'A2' || l === 'A1')).toHaveLength(7);
    // The closest lower level first: all four A2 words, then three A1 words.
    expect(sel.filter((l) => l === 'A2')).toHaveLength(4);
    expect(plan.counts).toEqual({ for_you: 22, easy: 1, known: 2, too_hard: 2 });
    expect(
      plan.rows.filter((r) => r.bucket === 'for_you' && !r.selected).map((r) => level.get(r.id)),
    ).toEqual(['B2', 'B2']);
  });

  it('a text without words at the learner level pre-selects nothing', () => {
    seq = 0;
    const plan = planCandidates([item('B2'), item('C1'), item('A2'), item(null)], 'B1');
    expect(plan.selected).toBe(0);
    expect(plan.counts).toEqual({ for_you: 2, easy: 1, known: 0, too_hard: 1 });
  });

  it('sorts each section by occurrences, then frequency, then text order', () => {
    seq = 0;
    const a = item('B1', { occurrences: 1, zipf: 4 });
    const b = item('B1', { occurrences: 3, zipf: 2 });
    const c = item('B1', { occurrences: 1, zipf: 5 });
    const d = item('B1', { occurrences: 1, zipf: null });
    const e = item('B1', { occurrences: 1, zipf: null });
    const plan = planCandidates([a, b, c, d, e], 'B1');
    expect(plan.rows.map((r) => r.id)).toEqual([b.id, c.id, a.id, d.id, e.id]);
    expect(compareCandidates(a, a)).toBe(0);
  });

  it('a vocabulary list keeps its own order inside each section', () => {
    seq = 0;
    const list = [
      item('B1', { fromList: true, zipf: 3 }),
      item('A2', { fromList: true, zipf: 6 }),
      item('B1', { fromList: true, zipf: 5, occurrences: 4 }),
      item('C2', { fromList: true }),
    ];
    const plan = planCandidates(list, 'B1');
    expect(plan.rows).toEqual([
      { id: list[0]!.id, bucket: 'for_you', selected: true },
      { id: list[1]!.id, bucket: 'for_you', selected: true },
      { id: list[2]!.id, bucket: 'for_you', selected: true },
      { id: list[3]!.id, bucket: 'too_hard', selected: false },
    ]);
  });

  it('property: every row once; ratios hold; nothing above L+1 or known is selected; maximal', () => {
    fc.assert(
      fc.property(factsArb, levelArb, (raw, level) => {
        const { items, known } = build(raw);
        const plan = planCandidates(items, level, known);
        const byId = new Map(items.map((c) => [c.id, c]));
        // A partition of the input, in section order.
        expect(plan.rows.map((r) => r.id).sort()).toEqual(items.map((c) => c.id).sort());
        const order = plan.rows.map((r) => BUCKETS.indexOf(r.bucket));
        expect(order).toEqual([...order].sort((x, y) => x - y));

        const sel = plan.rows.filter((r) => r.selected).map((r) => byId.get(r.id)!);
        expect(sel.length).toBe(plan.selected);
        const same = sel.filter((c) => c.cefr === level).length;
        const next = sel.filter((c) => levelBand(c.cefr, level) === 'next').length;
        for (const c of sel) {
          expect(c.hasNote || known.has(c.key)).toBe(false);
          if (c.cefr) expect(levelRank(c.cefr)).toBeLessThanOrEqual(levelRank(level) + 1);
        }
        if (sel.length > 0) {
          expect(same / sel.length).toBeGreaterThanOrEqual(0.55);
          expect(next / sel.length).toBeLessThanOrEqual(0.1);
        }
        // Selected rows are exactly the selected part of "for_you", listed first.
        const forYou = plan.rows.filter((r) => r.bucket === 'for_you');
        expect(forYou.slice(0, plan.selected).every((r) => r.selected)).toBe(true);
        expect(plan.rows.filter((r) => r.selected).every((r) => r.bucket === 'for_you')).toBe(true);
        // Every eligible item at the learner's level is selected; easy rows are lower levels.
        for (const r of plan.rows) {
          const c = byId.get(r.id)!;
          const eligible = !c.hasNote && !known.has(c.key);
          if (eligible && c.cefr === level) expect(r.selected).toBe(true);
          if (r.bucket === 'easy') expect(levelBand(c.cefr, level)).toBe('lower');
          if (r.bucket === 'too_hard') expect(levelBand(c.cefr, level)).toBe('above');
        }
        // Maximal: one more lower or next-level item would break a ratio.
        const t = sel.length;
        if (same > 0) {
          const easyLeft = plan.rows.some((r) => r.bucket === 'easy');
          if (easyLeft) expect(20 * same < 11 * (t + 1)).toBe(true);
          const nextLeft = plan.rows.some((r) => r.bucket === 'for_you' && !r.selected);
          if (nextLeft) expect(20 * same < 11 * (t + 1) || 10 * (next + 1) > t + 1).toBe(true);
        }
      }),
      { numRuns: 400 },
    );
  });

  it('property: never fills with words above L+1 when L words are scarce', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: 0, max: 40 }),
        fc.integer({ min: 0, max: 40 }),
        levelArb,
        (nSame, nAbove, nNext, level) => {
          const r = levelRank(level);
          const above = CEFR[r + 2];
          const items = [
            ...Array.from({ length: nSame }, () => item(level)),
            ...Array.from({ length: nNext }, () => item(CEFR[r + 1] ?? null)),
            ...(above ? Array.from({ length: nAbove }, () => item(above)) : []),
          ];
          const plan = planCandidates(items, level);
          // With < 10 selected words no L+1 word fits in 10 %, and nothing above L+1 ever.
          expect(plan.selected).toBe(nSame);
        },
      ),
    );
  });
});

describe('occurrenceCounter', () => {
  it('counts inflected forms of a word and surfaces of an expression', () => {
    const count = occurrenceCounter(
      'She copes well. Coping is hard; we cope. He gave up. They Gave Up too. Bank, banks.',
    );
    expect(count('cope', 'copes')).toBe(3);
    expect(count('give up', 'gave up')).toBe(2);
    expect(count('bank', 'Bank')).toBe(2);
    expect(count('absent', 'absent')).toBe(1);
    expect(count('take advantage of sth', '')).toBe(1);
  });
});
