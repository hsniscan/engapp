import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { bumpEncounters, nudgeOffset, readingSlice, summarizeEncounters } from './encounters';
import { encounterId, READING_OFFSET_MAX, type EncounterRow, type TextFeedback } from './texts';
import type { SyncedRow } from './types';

const base = (id: string): SyncedRow => ({
  id,
  user_id: null,
  created_at: 1,
  updated_at: 1,
  deleted_at: null,
  hlc: 'h',
});
const row = (
  noteId: string,
  source: EncounterRow['source'],
  n: number,
  device = 'd1',
  deleted: number | null = null,
): EncounterRow => ({
  ...base(encounterId(noteId, '2026-11-01', source, device)),
  note_id: noteId,
  day: '2026-11-01',
  source,
  n,
  device_id: device,
  deleted_at: deleted,
});

describe('bumpEncounters', () => {
  it('starts new rows at 1 and adds 1 to existing ones, once per note', () => {
    const out = bumpEncounters(
      [row('a', 'reader', 2)],
      ['a', 'b', 'b'],
      '2026-11-01',
      'reader',
      'd1',
      base,
    );
    expect(out.map((r) => [r.id, r.n])).toEqual([
      ['a|2026-11-01|reader|d1', 3],
      ['b|2026-11-01|reader|d1', 1],
    ]);
    expect(out[1]).toMatchObject({
      note_id: 'b',
      source: 'reader',
      device_id: 'd1',
      day: '2026-11-01',
    });
  });

  it('a row of another device or source is not touched', () => {
    const out = bumpEncounters(
      [row('a', 'reader', 5, 'd2'), row('a', 'review', 4)],
      ['a'],
      '2026-11-01',
      'reader',
      'd1',
      base,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'a|2026-11-01|reader|d1', n: 1 });
  });
});

describe('summarizeEncounters', () => {
  it('adds the devices up, splits cards and texts, ignores tombstones', () => {
    const rows = [
      row('a', 'review', 2),
      row('a', 'review', 1, 'd2'),
      row('a', 'reader', 3),
      row('a', 'story', 1),
      row('a', 'reader', 9, 'd3', 5),
    ];
    expect(summarizeEncounters(rows)).toEqual({ cards: 3, texts: 4, total: 7 });
  });

  it('shows the answers from before the counter when they are more', () => {
    expect(summarizeEncounters([row('a', 'review', 2)], 10)).toEqual({
      cards: 10,
      texts: 0,
      total: 10,
    });
    expect(summarizeEncounters([], 0)).toEqual({ cards: 0, texts: 0, total: 0 });
  });
});

describe('nudgeOffset', () => {
  it('moves by one step and takes a changed answer back', () => {
    expect(nudgeOffset(0, null, 'hard')).toBe(0.1);
    expect(nudgeOffset(0.1, 'hard', 'easy')).toBe(-0.1);
    expect(nudgeOffset(-0.1, 'easy', null)).toBe(0);
    expect(nudgeOffset(0.2, 'hard', 'hard')).toBe(0.2);
    expect(nudgeOffset(Number.NaN, null, 'easy')).toBe(-0.1);
  });

  it('property: stays within bounds and answering the same twice changes nothing', () => {
    const fb = fc.constantFrom<TextFeedback | null>('hard', 'easy', null);
    fc.assert(
      fc.property(fc.double({ min: -1, max: 1, noNaN: true }), fb, fb, (cur, prev, next) => {
        const v = nudgeOffset(cur, prev, next);
        expect(Math.abs(v)).toBeLessThanOrEqual(READING_OFFSET_MAX);
        expect(nudgeOffset(v, next, next)).toBe(v);
      }),
    );
  });
});

describe('readingSlice', () => {
  it('caps idle gaps and ignores clock jumps backwards', () => {
    expect(readingSlice(0, 30_000)).toBe(30_000);
    expect(readingSlice(0, 60 * 60_000)).toBe(2 * 60_000);
    expect(readingSlice(10, 5)).toBe(0);
  });
});
