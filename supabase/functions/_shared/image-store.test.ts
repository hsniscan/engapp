// @vitest-environment node
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { SupabaseImageStore } from './image-store.ts';

/** A fake PostgREST table that, like the hosted API, returns at most 1000 rows per request. */
function fakeDb(total: number) {
  const ranges: [number, number][] = [];
  const rows = Array.from({ length: total }, (_, i) => ({
    sense_id: `s${String(i).padStart(5, '0')}`,
    source: 'auto',
    priority: 0,
    attempt: 1,
    problem: null,
    batch_id: null,
    hold_id: null,
  }));
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    range: (from: number, to: number) => {
      ranges.push([from, to]);
      const end = Math.min(to + 1, from + 1000);
      return Promise.resolve({ data: rows.slice(from, end), error: null });
    },
  };
  return { db: { from: () => builder } as unknown as SupabaseClient, ranges };
}

describe('SupabaseImageStore requests', () => {
  it('reads a batch bigger than the API row limit in pages', async () => {
    const { db, ranges } = fakeDb(2500);
    const rows = await new SupabaseImageStore(db).queued(2000);
    expect(rows).toHaveLength(2000);
    expect(new Set(rows.map((r) => r.sense_id)).size).toBe(2000);
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it('stops at the last short page', async () => {
    const { db, ranges } = fakeDb(1200);
    expect(await new SupabaseImageStore(db).submitted()).toHaveLength(1200);
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it('asks for no more than the limit', async () => {
    const { db, ranges } = fakeDb(50);
    expect(await new SupabaseImageStore(db).queued(10)).toHaveLength(10);
    expect(ranges).toEqual([[0, 9]]);
  });
});
