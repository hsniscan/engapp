// @vitest-environment node
//
// The sync engine against a real Postgres + PostgREST with the migrations applied
// (supabase/migrations). Skipped unless SYNC_IT_REST_URL is set:
//
//   SYNC_IT_REST_URL     PostgREST base URL, e.g. http://127.0.0.1:3000 (or <gateway>/rest/v1)
//   SYNC_IT_JWT_SECRET   HS256 secret PostgREST verifies (to mint user tokens)
//   SYNC_IT_PG           postgres URL with rights on auth.users (users are created with psql)
//
// Run: SYNC_IT_REST_URL=… SYNC_IT_JWT_SECRET=… SYNC_IT_PG=… pnpm vitest run src/sync/engine.integration.test.ts
import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { addNoteWithSenses, answerCard, db, editNote, META, setMeta, softDeleteNote, updateSettings } from '@/data';
import { pickFsrs } from '@/domain/fsrs';
import { Rating } from '@/domain/types';
import { resetDb } from '@/test/db';
import { getLexiconSenses, pullChanges, pullLexicon, pushBatch } from './api';
import { runSync, type SyncTransport } from './engine';
import { loadDevice, onDevice, saveDevice, type DeviceImage } from './testing/fakeServer';

const REST = process.env.SYNC_IT_REST_URL;
const SECRET = process.env.SYNC_IT_JWT_SECRET ?? '';
const PG = process.env.SYNC_IT_PG ?? '';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(sub: string): string {
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const p = b64({ sub, role: 'authenticated', aud: 'authenticated', is_anonymous: false, exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`;
}

function createUser(): string {
  const id = randomUUID();
  execFileSync('psql', [PG, '-v', 'ON_ERROR_STOP=1', '-qc', `insert into auth.users (id, email, aud, role) values ('${id}', '${id}@it.local', 'authenticated', 'authenticated')`]);
  return id;
}

function transportFor(userId: string): SyncTransport {
  const base = 'http://gateway.invalid';
  const client = createClient(base, 'anon', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${jwt(userId)}` },
      fetch: (input, init) => fetch(String(input instanceof Request ? input.url : input).replace(`${base}/rest/v1`, REST!), init),
    },
  });
  return {
    pushBatch: (items) => pushBatch(items, client),
    pullChanges: (since, limit) => pullChanges(since, limit, client),
    pullLexicon: (since, limit) => pullLexicon(since, limit, client),
    getLexiconSenses: (ids) => getLexiconSenses(ids, client),
  };
}

const T = Date.now() - 10 * 86_400_000;
const MIN = 60_000;
const DAY = 86_400_000;

async function device(id: string, userId: string): Promise<DeviceImage> {
  await resetDb();
  await db.transaction('rw', db.meta, async () => {
    await setMeta(META.deviceId, id);
    await setMeta(META.userId, userId);
  });
  await updateSettings({ timezone: 'Europe/Istanbul' }, T);
  return saveDevice();
}

describe.skipIf(!REST)('sync engine against Postgres + PostgREST', () => {
  let user: string;
  let t: SyncTransport;
  beforeAll(() => {
    user = createUser();
    t = transportFor(user);
  });

  it('two devices: notes travel, offline answers merge, deletes win by HLC, cursors settle', async () => {
    let a = await device('it-dev-a', user);
    let noteId = '';
    let otherId = '';
    a = await onDevice(a, async () => {
      for (let i = 0; i < 60; i++) await addNoteWithSenses({ term: `itword${i}`, senses: [{ meaning_tr: `anlam${i}` }] }, T);
      noteId = (await addNoteWithSenses({ term: 'cope', senses: [{ meaning_tr: 'başa çıkmak' }] }, T)).note.id;
      otherId = (await addNoteWithSenses({ term: 'thrive', senses: [{ meaning_tr: 'gelişmek' }] }, T)).note.id;
      const r = await runSync(t, { now: () => T + MIN });
      expect(r.pushed).toBeGreaterThan(100); // two or more batches
      expect(await db.outbox.count()).toBe(0);
    });
    let b = await device('it-dev-b', user);
    b = await onDevice(b, async () => {
      const r = await runSync(t, { now: () => T + 2 * MIN });
      expect(r.pulled).toBeGreaterThan(100);
      expect(await db.notes.count()).toBe(62);
    });

    const cardOf = async () => (await db.cards.where('note_id').equals(noteId).toArray()).find((c) => c.card_type === 'recognition')!.id;
    let cardId = '';
    a = await onDevice(a, async () => {
      cardId = await cardOf();
      await answerCard({ card_id: cardId, rating: Rating.Good, duration_ms: 2000 }, T + DAY);
      await softDeleteNote(otherId, T + DAY + 5 * MIN);
    });
    b = await onDevice(b, async () => {
      await answerCard({ card_id: cardId, rating: Rating.Hard, duration_ms: 2000 }, T + DAY + MIN);
      await editNote(otherId, { tags: ['b-edit'] }, T + DAY + 2 * MIN); // older than A's delete
    });
    for (let round = 0; round < 2; round++) {
      a = await onDevice(a, async () => void (await runSync(t, { now: () => T + DAY + 10 * MIN })));
      b = await onDevice(b, async () => void (await runSync(t, { now: () => T + DAY + 11 * MIN })));
    }
    const facts = async (img: DeviceImage) => {
      await loadDevice(img);
      return {
        logs: (await db.review_logs.where('card_id').equals(cardId).toArray()).map((l) => l.id).sort(),
        card: pickFsrs((await db.cards.get(cardId))!),
        deleted: (await db.notes.get(otherId))!.deleted_at !== null,
        outbox: await db.outbox.count(),
      };
    };
    const fa = await facts(a);
    const fb = await facts(b);
    expect(fa.logs).toHaveLength(2);
    expect(fb).toEqual(fa);
    expect(fa.deleted).toBe(true);
    expect(fa.outbox).toBe(0);

    // Same batch twice (e.g. a lost response): nothing changes on the server.
    await loadDevice(a);
    const note = (await db.notes.get(noteId))!;
    const again = await t.pushBatch([{ table: 'notes', op: 'upsert', payload: note }]);
    expect(again.stale).toEqual([note.id]);
  }, 60_000);
});
