import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { SAMPLE_PICTURES } from '@/test/imageSamples';
import { decideReview, downloadImages, fetchReviewQueue, isAppAdmin, listImageManifest, requestImage } from './image';

const config = { url: 'https://p.supabase.co', key: 'pk' };
const token = async () => 'jwt';
const SENSE = '0199f0a0-0000-7000-8000-00000000a001';
const IMG = '0199f0a0-0000-7000-8000-0000000b0001';
const row = {
  id: IMG,
  sense_id: SENSE,
  variant: 0,
  svg: SAMPLE_PICTURES.apple.svg,
  alt_tr: 'Kırmızı bir elma',
  status: 'approved',
  created_at: '2026-10-25T01:30:00Z',
};

describe('requestImage (ai-image)', () => {
  it('sends only the lexicon sense id with the session token', async () => {
    const fetch = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) => new Response(JSON.stringify({ ok: true, image: row })));
    const res = await requestImage(SENSE, { config, getAccessToken: token, fetch: fetch as typeof globalThis.fetch });
    expect(res).toEqual({ ok: true, image: row });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://p.supabase.co/functions/v1/ai-image');
    expect(JSON.parse(String(init!.body))).toEqual({ sense_id: SENSE });
    expect((init!.headers as Record<string, string>).authorization).toBe('Bearer jwt');
  });

  it('passes the four refusals through as answers', async () => {
    for (const reason of ['daily_limit', 'budget', 'not_visual', 'failed'] as const) {
      const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: false, reason })));
      expect(await requestImage(SENSE, { config, getAccessToken: token, fetch })).toEqual({ ok: false, reason });
    }
  });

  it('needs a signed-in user; maps HTTP errors, a dropped connection and a bad answer', async () => {
    await expect(requestImage(SENSE, { config, getAccessToken: async () => null })).rejects.toMatchObject({ code: 'not_signed_in' });
    const limit = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'daily_limit', message: 'x' } }), { status: 429 }));
    await expect(requestImage(SENSE, { config, getAccessToken: token, fetch: limit })).rejects.toMatchObject({ code: 'daily_limit' });
    const down = vi.fn(async () => Promise.reject(new TypeError('Failed to fetch')));
    await expect(requestImage(SENSE, { config, getAccessToken: token, fetch: down })).rejects.toMatchObject({ code: 'offline' });
    const bad = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    await expect(requestImage(SENSE, { config, getAccessToken: token, fetch: bad })).rejects.toMatchObject({ code: 'bad_response' });
    await expect(requestImage('not-a-uuid', { config, getAccessToken: token })).rejects.toThrow();
  });
});

/** A supabase-js stand-in: from(t).select(c).in(col, ids).in('status', …) and rpc(fn, args). */
function fakeClient(tables: { rows: Record<string, unknown>[] }, rpc: Record<string, unknown> = {}) {
  const calls: { table: string; columns: string; filters: [string, unknown[]][] }[] = [];
  const rpcCalls: [string, unknown][] = [];
  const client = {
    from(table: string) {
      return {
        select(columns: string) {
          const call = { table, columns, filters: [] as [string, unknown[]][] };
          calls.push(call);
          const q = {
            in(col: string, values: unknown[]) {
              call.filters.push([col, values]);
              return call.filters.length === 2 ? Promise.resolve(answer()) : q;
            },
          };
          const answer = () => {
            const [[col, ids], [, statuses]] = call.filters as [[string, unknown[]], [string, unknown[]]];
            const data = tables.rows
              .filter((r) => ids.includes(r[col]) && statuses.includes(r.status))
              .map((r) => Object.fromEntries(columns.split(',').map((c) => [c, r[c]])));
            return { data, error: null };
          };
          return q;
        },
      };
    },
    rpc(fn: string, args: unknown) {
      rpcCalls.push([fn, args]);
      return Promise.resolve(fn in rpc ? { data: rpc[fn], error: null } : { data: null, error: { code: 'PGRST202', message: 'missing' } });
    },
  } as unknown as SupabaseClient;
  return { client, calls, rpcCalls };
}

describe('lexicon_images reads', () => {
  it('lists without SVG in chunks, then downloads full rows; rows off the contract are dropped', async () => {
    const senses = Array.from({ length: 170 }, (_, i) => `0199f0a0-0000-7000-8000-00000001${String(i).padStart(4, '0')}`);
    const other = { ...row, id: '0199f0a0-0000-7000-8000-0000000b0002', sense_id: senses[169], status: 'review' };
    const broken = { ...row, id: 'not-a-uuid', sense_id: senses[0] };
    const { client, calls } = fakeClient({ rows: [{ ...row, sense_id: senses[0] }, other, broken, { ...row, id: '0199f0a0-0000-7000-8000-0000000b0003', sense_id: senses[1], status: 'rejected' }] });
    const manifest = await listImageManifest(senses, client);
    expect(manifest.map((m) => m.id).sort()).toEqual([IMG, other.id, 'not-a-uuid'].sort());
    expect(calls.map((c) => [c.table, c.columns, c.filters[0]![1].length, c.filters[1]])).toEqual([
      ['lexicon_images', 'id,sense_id,variant,status,created_at', 80, ['status', ['approved', 'review']]],
      ['lexicon_images', 'id,sense_id,variant,status,created_at', 80, ['status', ['approved', 'review']]],
      ['lexicon_images', 'id,sense_id,variant,status,created_at', 10, ['status', ['approved', 'review']]],
    ]);
    const rows = await downloadImages([IMG, other.id, 'not-a-uuid'], client);
    expect(rows.map((r) => r.id).sort()).toEqual([IMG, other.id].sort());
    expect(rows[0]!.svg).toContain('<svg');
  });

  it('guest builds have no client', async () => {
    await expect(listImageManifest([SENSE], null)).rejects.toMatchObject({ kind: 'not_configured' });
  });
});

describe('admin review functions', () => {
  it('is_app_admin, the queue and a decision', async () => {
    const queue = [{ image: { ...row, status: 'review' }, lemma: 'apple', pos: 'noun', gloss_tr: 'elma' }, { image: { id: 'x' } }];
    const { client, rpcCalls } = fakeClient({ rows: [] }, { is_app_admin: true, image_review_queue: queue, image_review_decide: null });
    expect(await isAppAdmin(client)).toBe(true);
    expect((await fetchReviewQueue(20, client)).map((r) => r.lemma)).toEqual(['apple']);
    await decideReview(IMG, 'reject', 'unclear', client);
    await decideReview(IMG, 'approve', 'unclear', client);
    expect(rpcCalls).toEqual([
      ['is_app_admin', {}],
      ['image_review_queue', { p_limit: 20 }],
      ['image_review_decide', { p_image_id: IMG, p_decision: 'reject', p_reason: 'unclear' }],
      ['image_review_decide', { p_image_id: IMG, p_decision: 'approve', p_reason: null }],
    ]);
    const none = fakeClient({ rows: [] }, { is_app_admin: false });
    expect(await isAppAdmin(none.client)).toBe(false);
    await expect(fetchReviewQueue(20, none.client)).rejects.toMatchObject({ kind: 'server' });
  });
});
