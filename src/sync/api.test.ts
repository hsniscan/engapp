import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { pullChanges, pushBatch, SyncApiError, getLexiconSenses } from './api';

function fakeClient(
  reply: { data?: unknown; error?: { code?: string; message: string } | null } | Error,
) {
  const calls: { fn: string; args: unknown }[] = [];
  const client = {
    rpc: async (fn: string, args: unknown) => {
      calls.push({ fn, args });
      if (reply instanceof Error) throw reply;
      return { data: reply.data ?? null, error: reply.error ?? null };
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const note = {
  id: '0190a000-0000-7000-8000-000000000001',
  user_id: 'u',
  term: 'bank',
  term_norm: 'bank',
  term_type: 'word',
  lexicon_term_id: null,
  ipa: null,
  tags: [],
  possible_duplicate: false,
  created_at: 1,
  updated_at: 1,
  deleted_at: null,
  hlc: '001761000000000:00000:dev',
};

describe('sync api', () => {
  it('pushes a batch through sync_push', async () => {
    const { client, calls } = fakeClient({ data: { acked: [note.id], stale: [], rejected: [] } });
    const res = await pushBatch([{ table: 'notes', op: 'upsert', payload: note }], client);
    expect(res.acked).toEqual([note.id]);
    expect(calls[0]).toEqual({
      fn: 'sync_push',
      args: { p_batch: [{ table: 'notes', op: 'upsert', payload: note }] },
    });
  });

  it('refuses batches over 100 rows', async () => {
    const { client } = fakeClient({ data: null });
    const items = Array.from({ length: 101 }, () => ({
      table: 'notes' as const,
      op: 'upsert' as const,
      payload: note,
    }));
    await expect(pushBatch(items, client)).rejects.toThrow(RangeError);
  });

  it('validates pulled rows per table and reports invalid ones', async () => {
    const { client } = fakeClient({
      data: {
        rows: [
          { table: 'notes', seq: 5, row: note },
          { table: 'notes', seq: 6, row: { id: 'broken' } },
          { table: 'mystery', seq: 7, row: { id: 'x' } },
        ],
        next_seq: 7,
        has_more: false,
        full_resync: false,
      },
    });
    const res = await pullChanges(0, 500, client);
    expect(res.rows).toEqual([{ table: 'notes', seq: 5, row: note }]);
    expect(res.invalid.map((i) => i.seq)).toEqual([6, 7]);
    expect(res.next_seq).toBe(7);
  });

  it('classifies errors', async () => {
    await expect(
      pushBatch(
        [{ table: 'notes', op: 'upsert', payload: note }],
        fakeClient({ error: { code: '42501', message: 'unauthorized' } }).client,
      ),
    ).rejects.toMatchObject({ kind: 'not_signed_in' });
    await expect(
      pullChanges(0, 500, fakeClient(new TypeError('Failed to fetch')).client),
    ).rejects.toMatchObject({ kind: 'network' });
    await expect(
      pullChanges(0, 500, fakeClient({ data: { rows: 'x' } }).client),
    ).rejects.toBeInstanceOf(SyncApiError);
    await expect(pullChanges(0, 500, null)).rejects.toMatchObject({ kind: 'not_configured' });
  });

  it('fetches lexicon senses by id', async () => {
    const e = {
      id: 's',
      term_id: 't',
      lemma: 'bank',
      lemma_norm: 'bank',
      term_type: 'word',
      pos: 'noun',
      gloss_en: 'g',
      meaning_tr: 'kıyı',
      ipa: null,
      updated_at: 1,
    };
    const { client, calls } = fakeClient({ data: [e] });
    expect(await getLexiconSenses(['s'], client)).toEqual([e]);
    expect(calls[0]!.fn).toBe('lexicon_get');
  });
});
