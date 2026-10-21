// @vitest-environment node
//
// Integration test against a running local stack (Postgres with the migrations applied,
// PostgREST, GoTrue, and the ai-extract / ai-enrich functions served with
// GEMINI_API_BASE pointing at a fake Gemini that answers with the recorded fixtures).
// Skipped unless SUPABASE_TEST_URL is set. See docs/setup-backend.md, "Local testing".
//
//   SUPABASE_TEST_URL          e.g. http://127.0.0.1:54321
//   SUPABASE_TEST_ANON_KEY     legacy anon JWT of the local stack
//   SUPABASE_TEST_SERVICE_KEY  legacy service_role JWT of the local stack
//   SUPABASE_TEST_JWT_SECRET   HS256 JWT secret of the local stack (to mint user tokens)

import { createHmac, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { getLexiconSenses, pullChanges, pullLexicon, pushBatch } from '@/sync/api';
import { AiClientError, enrichTerm, extractChunk } from '@/ai/client';
import { CHUNK } from '../../functions/_shared/testing/gemini-fixtures.ts';

const URL_ = process.env.SUPABASE_TEST_URL;
const ANON = process.env.SUPABASE_TEST_ANON_KEY ?? '';
const SERVICE = process.env.SUPABASE_TEST_SERVICE_KEY ?? '';
const SECRET = process.env.SUPABASE_TEST_JWT_SECRET ?? '';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function userJwt(sub: string): string {
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const p = b64({
    sub,
    role: 'authenticated',
    aud: 'authenticated',
    is_anonymous: false,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  return `${h}.${p}.${createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`;
}
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

interface TestUser {
  id: string;
  token: string;
  db: SupabaseClient;
}

async function createUser(): Promise<TestUser> {
  const res = await fetch(`${URL_}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE,
      authorization: `Bearer ${SERVICE}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email: `${randomUUID()}@test.local`, email_confirm: true }),
  });
  const user = (await res.json()) as { id: string };
  expect(res.status, JSON.stringify(user)).toBe(200);
  const token = userJwt(user.id);
  return {
    id: user.id,
    token,
    db: createClient(URL_!, ANON, {
      ...opts,
      global: { headers: { Authorization: `Bearer ${token}` } },
    }),
  };
}

const hlc = (ms: number) => `${String(ms).padStart(15, '0')}:00000:itest`;
const now = Date.now();
function noteRow(id: string, term: string) {
  return {
    id,
    user_id: null,
    term,
    term_norm: term,
    term_type: 'word',
    lexicon_term_id: null,
    ipa: null,
    tags: ['t'],
    possible_duplicate: false,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    hlc: hlc(now),
  };
}

describe.skipIf(!URL_)('local stack', () => {
  let a: TestUser;
  let b: TestUser;
  let admin: SupabaseClient;
  const config = () => ({ url: URL_!, key: ANON });
  const fakeCalls = async () =>
    ((await (await fetch(`${URL_}/fake-gemini/calls`)).json()) as { calls: number }).calls;

  beforeAll(async () => {
    admin = createClient(URL_!, SERVICE, opts);
    // Fresh lexicon for the fixture terms, so match/insert assertions are exact.
    await admin.from('lexicon_terms').delete().in('lemma_norm', ['give up', 'bank', 'turn down']);
    a = await createUser();
    b = await createUser();
  });

  it('push -> pull round trip; rows pass the client schemas', async () => {
    const noteId = randomUUID();
    const logId = randomUUID();
    const push = await pushBatch(
      [
        { table: 'notes', op: 'upsert', payload: noteRow(noteId, 'reluctant') },
        {
          table: 'review_logs',
          op: 'upsert',
          payload: {
            id: logId,
            user_id: null,
            card_id: randomUUID(),
            rating: 3,
            reviewed_at: now,
            duration_ms: 1200,
            device_id: 'd',
            undo_of: null,
            shown_sense_id: null,
            created_at: now,
            hlc: hlc(now),
          },
        },
        {
          table: 'settings',
          op: 'upsert',
          payload: {
            id: 'settings',
            user_id: null,
            daily_new_limit: 10,
            request_retention: 0.9,
            timezone: 'Europe/Istanbul',
            day_start_hour: 4,
            theme: 'system',
            voice: 'en-US',
            level: 'B1',
            fsrs_params: null,
            last_backup_at: null,
            created_at: now,
            updated_at: now,
            deleted_at: null,
            hlc: hlc(now),
          },
        },
      ],
      a.db,
    );
    expect(push).toEqual({ acked: [noteId, logId, 'settings'], stale: [], rejected: [] });
    // idempotent
    expect(
      (
        await pushBatch(
          [
            {
              table: 'review_logs',
              op: 'upsert',
              payload: {
                id: logId,
                user_id: null,
                card_id: randomUUID(),
                rating: 1,
                reviewed_at: now,
                duration_ms: 1,
                device_id: 'd',
                undo_of: null,
                shown_sense_id: null,
                created_at: now,
                hlc: hlc(now),
              },
            },
          ],
          a.db,
        )
      ).acked,
    ).toEqual([logId]);

    const pulled = await pullChanges(0, 500, a.db);
    expect(pulled.invalid).toEqual([]);
    expect(pulled.rows.map((r) => r.table).sort()).toEqual(['notes', 'review_logs', 'settings']);
    const note = pulled.rows.find((r) => r.table === 'notes')!.row;
    expect(note).toMatchObject({ id: noteId, user_id: a.id, tags: ['t'] });
    expect(
      (pulled.rows.find((r) => r.table === 'review_logs')!.row as { rating: number }).rating,
    ).toBe(3);

    const page = await pullChanges(0, 1, a.db);
    expect(page.has_more).toBe(true);
    expect((await pullChanges(pulled.next_seq, 500, a.db)).rows).toEqual([]);
  });

  it('isolates users', async () => {
    expect((await pullChanges(0, 500, b.db)).rows).toEqual([]);
    expect((await b.db.from('notes').select('id')).data).toEqual([]);
    const upd = await b.db.from('notes').update({ term: 'hacked' }).neq('term', '').select();
    expect(upd.data ?? []).toEqual([]);
    const logUpd = await a.db.from('review_logs').update({ rating: 1 }).neq('rating', 0);
    expect(logUpd.error?.code).toBe('42501');
    const lex = await a.db
      .from('lexicon_terms')
      .insert({ lemma: 'evil', lemma_norm: 'evil', term_type: 'word' });
    expect(lex.error?.code).toBe('42501');
  });

  it('ai-extract: model once, then the server chunk cache', async () => {
    const before = await fakeCalls();
    const deps = { config: config(), getAccessToken: async () => a.token };
    const first = await extractChunk({ text: CHUNK, level: 'B1' }, deps);
    expect(first).toMatchObject({ cache_hit: false, ai_called: true });
    expect(first.candidates.map((c) => [c.term, c.match])).toEqual([
      ['give up', 'new_term'],
      ['bank', 'new_term'],
      ['turn down', 'new_term'],
    ]);
    const second = await extractChunk({ text: CHUNK, level: 'B1' }, deps);
    expect(second.cache_hit).toBe(true);
    expect(await fakeCalls()).toBe(before + 1);

    // The lexicon holds no user text.
    const rows = (await admin.from('lexicon_senses').select('*')).data!;
    expect(JSON.stringify(rows)).not.toContain('Maria');

    // lexicon_pull / lexicon_get for senses the user references
    const lexId = first.candidates[1]!.lexicon.id;
    const senseId = randomUUID();
    await pushBatch(
      [
        {
          table: 'senses',
          op: 'upsert',
          payload: {
            id: senseId,
            user_id: null,
            note_id: randomUUID(),
            sense_no: 1,
            lexicon_sense_id: lexId,
            pos: 'noun',
            gloss_en: null,
            meaning_tr: 'kıyı',
            meaning_tr_override: null,
            source_sentence: 'x',
            span: [0, 1],
            source_id: null,
            created_at: now,
            updated_at: now,
            deleted_at: null,
            hlc: hlc(now),
          },
        },
      ],
      a.db,
    );
    const lp = await pullLexicon(0, 500, a.db);
    expect(lp.rows.map((r) => r.id)).toEqual([lexId]);
    expect((await getLexiconSenses([lexId], b.db))[0]!.meaning_tr).toBe('kıyı');
    expect((await pullLexicon(0, 500, b.db)).rows).toEqual([]);
  });

  it('two users extracting the same new senses at once create one lexicon row each', async () => {
    await admin.from('lexicon_terms').delete().in('lemma_norm', ['give up', 'bank', 'turn down']);
    const [ra, rb] = await Promise.all([
      extractChunk(
        { text: CHUNK, level: 'C1' },
        { config: config(), getAccessToken: async () => a.token },
      ),
      extractChunk(
        { text: CHUNK, level: 'C1' },
        { config: config(), getAccessToken: async () => b.token },
      ),
    ]);
    expect(ra.candidates.map((c) => c.lexicon.id)).toEqual(rb.candidates.map((c) => c.lexicon.id));
    const terms = (
      await admin
        .from('lexicon_terms')
        .select('id')
        .in('lemma_norm', ['give up', 'bank', 'turn down'])
    ).data!;
    expect(terms).toHaveLength(3);
    const senses = (
      await admin
        .from('lexicon_senses')
        .select('id')
        .in(
          'term_id',
          terms.map((t) => t.id),
        )
    ).data!;
    expect(senses).toHaveLength(3);
  });

  it('ai-enrich answers from the lexicon without the model', async () => {
    const before = await fakeCalls();
    const res = await enrichTerm(
      { term: 'gave up' },
      { config: config(), getAccessToken: async () => b.token },
    );
    expect(res).toMatchObject({ ai_called: false, term: { lemma: 'give up' } });
    expect(await fakeCalls()).toBe(before);
  });

  it('enforces the daily limit and authentication', async () => {
    await admin
      .from('ai_usage')
      .upsert({ user_id: a.id, day: new Date().toISOString().slice(0, 10), calls: 5 });
    const err = await extractChunk(
      { text: 'A completely different chunk of text.', level: 'B1' },
      { config: config(), getAccessToken: async () => a.token },
    ).catch((e: unknown) => e);
    expect((err as AiClientError).code).toBe('daily_limit');

    const anonAsUser = await enrichTerm(
      { term: 'bank' },
      { config: config(), getAccessToken: async () => ANON },
    ).catch((e: unknown) => e);
    expect((anonAsUser as AiClientError).code).toBe('unauthorized');
    const forged = await enrichTerm(
      { term: 'bank' },
      { config: config(), getAccessToken: async () => a.token.slice(0, -2) + 'xx' },
    ).catch((e: unknown) => e);
    expect((forged as AiClientError).code).toBe('unauthorized');
  });
});
