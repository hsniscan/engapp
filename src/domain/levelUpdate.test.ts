import { describe, expect, it } from 'vitest';
import { makeLog } from '@/test/factories';
import type { DayConfig } from './day';
import {
  bandRatios,
  cardEvidence,
  collectEvidence,
  priorFor,
  ratiosAt,
  weekStartMs,
  weeklyLevelUpdate,
  type EvidenceNote,
  type LevelTestRecord,
  type WeeklyInput,
} from './levelUpdate';
import { vocabSize } from './vocabSize';
import { Rating, type CefrLevel, type RatingValue } from './types';

const cfg: DayConfig = { timezone: 'Europe/Istanbul', day_start_hour: 4 };
const H = 3_600_000;
const D = 24 * H;
// Monday 2026-10-05 04:00 in Istanbul (UTC+3) = 01:00 UTC.
const MON = Date.UTC(2026, 9, 5, 1);

let seq = 0;
function note(band: CefrLevel | null, ratings: RatingValue[], at: number, practice: EvidenceNote['practice'] = []): EvidenceNote {
  const id = `n${++seq}`;
  return {
    id,
    term_norm: `w${seq}`,
    band,
    logs: ratings.map((rating, i) => makeLog({ card_id: `c-${id}`, rating, reviewed_at: at + i * H })),
    practice,
  };
}
/** n words of `band` that reached Öğrenildi without a lapse, at `at` + 2 h. */
const learned = (band: CefrLevel, n: number, at: number) =>
  Array.from({ length: n }, () => ({
    ...note(band, [Rating.Good, Rating.Good, Rating.Good], at),
    learned: { at: at + 2 * H, lapsedBefore: false },
  }));

describe('evidence', () => {
  it('reads the first answers of the recognition card', () => {
    const at = MON;
    expect(cardEvidence([makeLog({ card_id: 'c', rating: Rating.Easy, reviewed_at: at })])).toMatchObject({ known: 1, kind: 'easy_first' });
    expect(cardEvidence([Rating.Good, Rating.Good].map((r, i) => makeLog({ card_id: 'c', rating: r, reviewed_at: at + i })))).toBeNull();
    // Three answers on one day are no longer "learned" (ADR 0041): it takes Öğrenildi.
    const three = [Rating.Good, Rating.Hard, Rating.Good].map((r, i) => makeLog({ card_id: 'c', rating: r, reviewed_at: at + i }));
    expect(cardEvidence(three)).toBeNull();
    expect(cardEvidence(three, { at: at + 11 * D, lapsedBefore: false })).toMatchObject({ known: 1, kind: 'learned', at: at + 11 * D });
    // A lapse before Öğrenildi: no evidence either way.
    expect(cardEvidence(three, { at: at + 20 * D, lapsedBefore: true })).toBeNull();
    // Not yet at `until`.
    expect(cardEvidence(three, { at: at + 11 * D, lapsedBefore: false }, at + 10 * D)).toBeNull();
    expect(
      cardEvidence([Rating.Again, Rating.Good, Rating.Again].map((r, i) => makeLog({ card_id: 'c', rating: r, reviewed_at: at + i }))),
    ).toMatchObject({ unknown: 1, kind: 'lapses', at: at + 2 });
    // Later lapses do not change the evidence of a word learned before them.
    expect(
      cardEvidence(
        [Rating.Good, Rating.Good, Rating.Good, Rating.Again, Rating.Again].map((r, i) => makeLog({ card_id: 'c', rating: r, reviewed_at: at + i })),
        { at: at + 2, lapsedBefore: false },
      ),
    ).toMatchObject({ known: 1 });
  });

  it('ignores undone answers', () => {
    const easy = makeLog({ card_id: 'c', rating: Rating.Easy, reviewed_at: MON });
    const undo = makeLog({ card_id: 'c', rating: Rating.Easy, reviewed_at: MON + 1, undo_of: easy.id });
    expect(cardEvidence([easy, undo])).toBeNull();
  });

  it('counts each word once: card, then "Biliyorum", then practice at half weight', () => {
    const a = note('B1', [Rating.Easy], MON);
    const b = note('B1', [], MON, [
      { practiced_at: MON + H, result: 'known' },
      { practiced_at: MON + 2 * H, result: 'unknown' },
    ]);
    const known = [
      { term_norm: a.term_norm, source: 'manual', created_at: MON, band: 'B1' as const },
      { term_norm: 'other', source: 'preview', created_at: MON, band: 'B2' as const },
      { term_norm: 'fromtest', source: 'test', created_at: MON, band: 'B2' as const },
    ];
    const ev = collectEvidence([a, b], known, 0, MON + D);
    expect(ev.map((e) => [e.kind, e.band, e.known, e.unknown])).toEqual([
      ['easy_first', 'B1', 1, 0],
      ['practice', 'B1', 0, 0.5],
      ['marked', 'B2', 1, 0],
    ]);
    // Nothing after `until`, nothing at or before `since`.
    expect(collectEvidence([a, b], known, MON + D, MON + 2 * D)).toEqual([]);
  });

  it('ratio = (w·prior + known) / (w + known + unknown)', () => {
    const prior = priorFor(null, 'B1');
    expect(prior.B1).toEqual({ ratio: 0.9, weight: 10 });
    expect(prior.B2).toEqual({ ratio: 0.3, weight: 10 });
    const r = bandRatios(prior, collectEvidence(learned('B2', 30, MON), [], 0, MON + D));
    expect(r.B2.ratio).toBeCloseTo((3 + 30) / 40);
    const test = priorFor({ ratios: { B1: 0.85, B2: 0.5 }, tested: ['B1', 'B2'] }, 'B1');
    expect(test.B2).toEqual({ ratio: 0.5, weight: 20 });
  });
});

describe('weekly update', () => {
  const base = (over: Partial<WeeklyInput>): WeeklyInput => ({
    level: 'B1',
    tests: [],
    notes: [],
    knownTerms: [],
    locked: false,
    source: 'default',
    updatedAt: null,
    now: MON + 2 * D,
    cfg,
    ...over,
  });

  it('weeks start on Monday at day_start_hour, local time', () => {
    expect(weekStartMs(MON + 3 * D, cfg)).toBe(MON);
    expect(weekStartMs(MON - 1, cfg)).toBe(MON - 7 * D);
    // Monday 03:59 local still belongs to the previous week (day starts at 04:00).
    expect(weekStartMs(MON + 7 * D - 60_000, cfg)).toBe(MON);
  });

  it('moves up only after two consecutive weeks at ≥ 80 %', () => {
    // 40 B2 words learned in the week before last: both instants see them.
    const notes = learned('B2', 40, MON - 10 * D);
    const out = weeklyLevelUpdate(base({ notes }));
    expect(out.status).toBe('changed');
    if (out.status === 'changed') {
      expect(out.change).toMatchObject({ from: 'B1', to: 'B2', band: 'B2', known: 40, unknown: 0, week: MON });
      expect(out.change.ratio).toBeGreaterThanOrEqual(0.8);
    }
  });

  it('one good week is not enough (no flicker)', () => {
    // Learned last week only: this week's start sees them, last week's does not.
    const notes = learned('B2', 40, MON - 3 * D);
    expect(weeklyLevelUpdate(base({ notes })).status).toBe('kept');
    // A week later both instants see them.
    expect(weeklyLevelUpdate(base({ notes, now: MON + 8 * D })).status).toBe('changed');
  });

  it('moves down after two weeks below 60 % of the own level', () => {
    const notes = Array.from({ length: 30 }, () => note('B1', [Rating.Again, Rating.Again], MON - 10 * D));
    const out = weeklyLevelUpdate(base({ notes }));
    expect(out).toMatchObject({ status: 'changed', change: { from: 'B1', to: 'A2', band: 'B1', unknown: 30 } });
  });

  it('never moves more than one level, never while locked, never right after a change', () => {
    const notes = [...learned('B2', 80, MON - 20 * D), ...learned('C1', 80, MON - 20 * D)];
    const out = weeklyLevelUpdate(base({ notes }));
    expect(out).toMatchObject({ status: 'changed', change: { to: 'B2' } });
    expect(weeklyLevelUpdate(base({ notes, locked: true })).status).toBe('locked');
    // The weekly update moved it this week: next run is next week at the earliest.
    expect(weeklyLevelUpdate(base({ notes, level: 'B2', source: 'auto', updatedAt: MON + D })).status).toBe('too_soon');
    // Next week: last week's start is before that change's week? No: it equals it, so it may move again.
    expect(weeklyLevelUpdate(base({ notes, level: 'B2', source: 'auto', updatedAt: MON + D, now: MON + 8 * D })).status).toBe('changed');
    // A test or a manual choice waits for two week starts after it.
    expect(weeklyLevelUpdate(base({ notes, level: 'B2', source: 'test', updatedAt: MON - 3 * D })).status).toBe('too_soon');
    expect(weeklyLevelUpdate(base({ notes, level: 'B2', source: 'manual', updatedAt: MON - 8 * D })).status).toBe('changed');
  });

  it('a test is the prior; evidence before it does not count again', () => {
    const test: LevelTestRecord = { taken_at: MON - 9 * D, ratios: { A1: 1, A2: 0.95, B1: 0.85, B2: 0.4, C1: 0.2, C2: 0.1 }, tested: ['B1', 'B2'], reliable: true };
    const before = learned('B2', 40, MON - 12 * D);
    const r = ratiosAt({ level: 'B1', tests: [test], notes: before, knownTerms: [] }, MON);
    expect(r.B2).toMatchObject({ ratio: 0.4, known: 0 });
    // An unreliable test is ignored.
    const r2 = ratiosAt({ level: 'B1', tests: [{ ...test, reliable: false }], notes: before, knownTerms: [] }, MON);
    expect(r2.B2.known).toBe(40);
  });

  it('stays put with no evidence', () => {
    expect(weeklyLevelUpdate(base({})).status).toBe('kept');
    expect(weeklyLevelUpdate(base({ level: 'C2' })).status).toBe('kept');
    expect(weeklyLevelUpdate(base({ level: 'A1' })).status).toBe('kept');
  });
});

describe('vocabulary size', () => {
  const sizes = { A1: 1084, A2: 1272, B1: 2174, B2: 2490, C1: 929, C2: 896 } as const;

  it('sums size × ratio, adds outside words and rounds to tens', () => {
    const v = vocabSize('B1', { A1: 1, A2: 0.9, B1: 0.8, B2: 0.5, C1: 0.2, C2: 0 }, sizes, 37);
    const exact = 1084 + 1272 * 0.9 + 2174 * 0.8 + 2490 * 0.5 + 929 * 0.2 + 37;
    expect(v.estimate).toBe(Math.round(exact / 10) * 10);
    expect(v.next).toBe('B2');
    // 80 % of B2 = 1992; known 1245 → 747 to go, rounded up to tens.
    expect(v.toNext).toBe(750);
    expect(v.nextRatio).toBe(0.5);
  });

  it('nothing left when the next level is already at 80 %; no next level at C2', () => {
    expect(vocabSize('B1', { A1: 1, A2: 1, B1: 1, B2: 0.85, C1: 0, C2: 0 }, sizes, 0).toNext).toBe(0);
    const top = vocabSize('C2', { A1: 1, A2: 1, B1: 1, B2: 1, C1: 1, C2: 1 }, sizes, 0);
    expect(top).toMatchObject({ next: null, toNext: null });
  });

  it('a few missing words still show as ~10, never 0', () => {
    expect(vocabSize('B1', { A1: 1, A2: 1, B1: 1, B2: 0.799, C1: 0, C2: 0 }, sizes, 0).toNext).toBe(10);
  });
});
