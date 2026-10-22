import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from '@/test/db';
import { db } from '@/data/db';
import { fetchWordBank, WORD_BANK_REFRESH_MS, type WordBankFetchDeps } from './fetcher';

const T = Date.UTC(2026, 9, 22, 9);

const row = (lemma: string, seq: number, retired = false) => ({
  lemma_norm: lemma,
  pos: 'noun',
  lemma,
  cefr: 'A1',
  zipf: 5,
  lexicon_term_id: null,
  senses: [{ meaning_tr: 'x', example_en: `A ${lemma}.`, example_tr: 'Bir x.', sense_id: null }],
  retired,
  server_seq: seq,
});

/** A server holding `rows`, paging like PostgREST (server_seq > after, ascending, limit). */
function server(rows: ReturnType<typeof row>[], pageSize?: number) {
  const calls: number[] = [];
  const deps: WordBankFetchDeps = {
    fetchPage: async (after, limit) => {
      calls.push(after);
      return rows
        .filter((r) => r.server_seq > after)
        .sort((a, b) => a.server_seq - b.server_seq)
        .slice(0, pageSize ?? limit);
    },
    isOnline: () => true,
    now: () => T,
  };
  return { deps, calls };
}

beforeEach(async () => {
  await resetDb();
});

describe('fetchWordBank', () => {
  it('downloads every page, then only what changed', async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => row(`w${i}`, i + 1));
    const s = server(rows);
    expect(await fetchWordBank(s.deps)).toEqual({ status: 'done', stored: 2500, removed: 0 });
    expect(s.calls).toEqual([0, 1000, 2000]);
    expect(await db.word_bank.count()).toBe(2500);

    // Within a day: nothing asked. Forced (or a day later): only rows after the cursor.
    expect(await fetchWordBank(s.deps)).toEqual({ status: 'fresh' });
    rows.push(row('w0', 2501, true), row('new', 2502));
    s.calls.length = 0;
    expect(await fetchWordBank({ ...s.deps, now: () => T + WORD_BANK_REFRESH_MS })).toEqual({
      status: 'done',
      stored: 1,
      removed: 1,
    });
    expect(s.calls).toEqual([2500]);
    expect(await db.word_bank.get('w0|noun')).toBeUndefined();
    expect(await db.word_bank.get('new|noun')).toBeDefined();
  });

  it('does nothing offline or without a backend, and never throws', async () => {
    const s = server([row('a', 1)]);
    expect(await fetchWordBank({ ...s.deps, isOnline: () => false })).toEqual({
      status: 'offline',
    });
    expect(await fetchWordBank({ ...s.deps, fetchPage: null })).toEqual({ status: 'no_backend' });
    const failing = { ...s.deps, fetchPage: async () => Promise.reject(new Error('HTTP 503')) };
    expect(await fetchWordBank(failing)).toEqual({ status: 'failed', error: 'HTTP 503' });
    expect(await db.word_bank.count()).toBe(0);
  });
});
