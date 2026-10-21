import { beforeEach, describe, expect, it } from 'vitest';
import {
  addNoteWithSenses,
  answerCard,
  db,
  editNote,
  getCursor,
  META,
  setMeta,
  softDeleteNote,
  STUCK_ATTEMPTS,
  stuckOutboxCount,
  updateSettings,
} from '@/data';
import { pickFsrs } from '@/domain/fsrs';
import { Rating, type Card, type LexiconSense } from '@/domain/types';
import { resetDb } from '@/test/db';
import { FULL_RESYNC_KEY, runSync, SyncEngine } from './engine';
import { deriveSyncState } from './status';
import { FakeServer, loadDevice, onDevice, saveDevice, type DeviceImage } from './testing/fakeServer';

const T = Date.UTC(2026, 9, 21, 9);
const MIN = 60_000;
const DAY = 86_400_000;
const USER = 'user-1';

async function newDevice(deviceId: string, now = T): Promise<DeviceImage> {
  await resetDb();
  await db.transaction('rw', db.meta, async () => {
    await setMeta(META.deviceId, deviceId);
    await setMeta(META.userId, USER);
  });
  await updateSettings({ timezone: 'Europe/Istanbul' }, now);
  return saveDevice();
}

async function recognition(noteId: string): Promise<Card> {
  return (await db.cards.where('note_id').equals(noteId).toArray()).find((c) => c.card_type === 'recognition')!;
}

const sync = (server: FakeServer, now: number, force = false) => runSync(server, { now: () => now, force });

let server: FakeServer;
beforeEach(async () => {
  server = new FakeServer(USER);
  await resetDb();
});

describe('push', () => {
  it('pushes in batches of 100 and deletes outbox rows only after the ack', async () => {
    await newDevice('dev-a');
    for (let i = 0; i < 40; i++) await addNoteWithSenses({ term: `word${i}`, senses: [{ meaning_tr: `anlam${i}` }] }, T);
    const queued = await db.outbox.count();
    expect(queued).toBeGreaterThan(100);
    const report = await sync(server, T + MIN);
    expect(server.calls.push).toBeGreaterThanOrEqual(2);
    expect(await db.outbox.count()).toBe(0);
    expect(report.pushed).toBe(server.rows.size);
    expect(server.rowsOf('notes')).toHaveLength(40);
  });

  it('keeps changes made during a push for the next round', async () => {
    await newDevice('dev-a');
    const a = await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] }, T);
    const orig = server.pushBatch.bind(server);
    let edited = false;
    server.pushBatch = async (items) => {
      if (!edited) {
        edited = true;
        await editNote(a.note.id, { tags: ['later'] }, T + 1);
      }
      return orig(items);
    };
    await sync(server, T + MIN);
    expect(await db.outbox.count()).toBe(0);
    expect(server.rowsOf('notes')[0]).toMatchObject({ tags: ['later'] });
  });

  it('same batch pushed twice (lost response) changes nothing on the server', async () => {
    await newDevice('dev-a');
    const a = await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] }, T);
    await answerCard({ card_id: (await recognition(a.note.id)).id, rating: Rating.Good, duration_ms: 1000 }, T + MIN);
    server.faults.networkAfterPush = 1;
    await expect(sync(server, T + 2 * MIN)).rejects.toMatchObject({ kind: 'network' });
    const firstCount = server.rows.size;
    const outboxAfterLoss = await db.outbox.count();
    expect(outboxAfterLoss).toBeGreaterThan(0); // nothing was acked
    const report = await sync(server, T + 3 * MIN);
    expect(server.rows.size).toBe(firstCount);
    expect(report.stale).toBeGreaterThan(0); // equal HLCs are stale no-ops
    expect(server.rowsOf('review_logs')).toHaveLength(1);
    expect(await db.outbox.count()).toBe(0);
  });

  it('connection drop mid-push: acked batches are gone, the rest stays and goes later', async () => {
    await newDevice('dev-a');
    for (let i = 0; i < 40; i++) await addNoteWithSenses({ term: `w${i}`, senses: [{ meaning_tr: `a${i}` }] }, T);
    const total = await db.outbox.count();
    server.faults.dropOnPushCall = 2;
    await expect(sync(server, T + MIN)).rejects.toMatchObject({ kind: 'network' });
    const left = await db.outbox.count();
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThan(total);
    expect(server.rows.size).toBe(100);
    // Network errors are not the rows' fault: no attempts counted.
    expect((await db.outbox.toArray()).every((r) => r.attempts === 0)).toBe(true);
    await sync(server, T + 2 * MIN);
    expect(await db.outbox.count()).toBe(0);
    expect(server.rowsOf('notes')).toHaveLength(40);
  });

  it('rejected rows back off exponentially and are reported as stuck after 10 attempts', async () => {
    await newDevice('dev-a');
    const a = await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] }, T);
    server.faults.rejectIds = new Set([a.note.id]);
    await sync(server, T);
    const row = (await db.outbox.toArray()).find((r) => r.row_id === a.note.id)!;
    expect(row.attempts).toBe(1);
    expect(row.next_attempt_at).toBe(T + 5_000);
    // Not due yet: a normal run skips it, a forced run retries it.
    await sync(server, T + 1_000);
    expect((await db.outbox.toArray()).find((r) => r.row_id === a.note.id)!.attempts).toBe(1);
    let now = T + 1_000;
    for (let i = 1; i < STUCK_ATTEMPTS; i++) {
      now += 2 * 60 * MIN;
      await sync(server, now);
    }
    expect(await stuckOutboxCount()).toBe(1);
    const stuck = (await db.outbox.toArray()).find((r) => r.row_id === a.note.id)!;
    expect(stuck.attempts).toBe(STUCK_ATTEMPTS);
    expect(stuck.next_attempt_at - now).toBe(30 * MIN); // capped
    // The rest of the data still synced.
    expect(server.rowsOf('senses')).toHaveLength(1);
    // Once the server accepts it, it is gone.
    server.faults.rejectIds = new Set();
    await sync(server, now, true);
    expect(await stuckOutboxCount()).toBe(0);
  });
});

describe('two devices', () => {
  async function twoDevices() {
    let a = await newDevice('dev-a');
    let noteId = '';
    a = await onDevice(a, async () => {
      noteId = (await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] }, T)).note.id;
      await sync(server, T + MIN);
    });
    let b = await newDevice('dev-b', T + 2 * MIN);
    b = await onDevice(b, async () => {
      await sync(server, T + 3 * MIN);
    });
    return { a, b, noteId };
  }

  it('both devices answer the same card offline: both logs kept, card recomputed identically', async () => {
    let { a, b, noteId } = await twoDevices();
    let cardId = '';
    a = await onDevice(a, async () => {
      cardId = (await recognition(noteId)).id;
      await answerCard({ card_id: cardId, rating: Rating.Good, duration_ms: 3000 }, T + DAY);
    });
    b = await onDevice(b, async () => {
      expect((await recognition(noteId)).id).toBe(cardId);
      await answerCard({ card_id: cardId, rating: Rating.Again, duration_ms: 3000 }, T + DAY + 10 * MIN);
    });
    // Back online, in any order.
    a = await onDevice(a, () => sync(server, T + DAY + 20 * MIN).then(() => {}));
    b = await onDevice(b, () => sync(server, T + DAY + 21 * MIN).then(() => {}));
    a = await onDevice(a, () => sync(server, T + DAY + 22 * MIN).then(() => {}));

    const read = async (img: DeviceImage) => {
      await loadDevice(img);
      const logs = await db.review_logs.where('card_id').equals(cardId).toArray();
      return { logs: logs.map((l) => l.id).sort(), card: pickFsrs((await db.cards.get(cardId))!), outbox: await db.outbox.count() };
    };
    const ra = await read(a);
    const rb = await read(b);
    expect(ra.logs).toHaveLength(2);
    expect(rb.logs).toEqual(ra.logs);
    expect(rb.card).toEqual(ra.card);
    expect(ra.card.reps).toBe(2);
    expect(server.rowsOf('review_logs')).toHaveLength(2);
    // The server's card equals both devices' card.
    expect(pickFsrs(server.rowsOf('cards').find((c) => c.id === cardId) as unknown as Card)).toEqual(ra.card);
  });

  it('delete vs edit race: the later change wins on both devices (a later edit undeletes)', async () => {
    let { a, b, noteId } = await twoDevices();
    a = await onDevice(a, () => softDeleteNote(noteId, T + DAY));
    b = await onDevice(b, async () => void (await editNote(noteId, { tags: ['edited'] }, T + DAY + MIN)));
    a = await onDevice(a, () => sync(server, T + DAY + 2 * MIN).then(() => {}));
    b = await onDevice(b, () => sync(server, T + DAY + 3 * MIN).then(() => {}));
    a = await onDevice(a, () => sync(server, T + DAY + 4 * MIN).then(() => {}));
    for (const img of [a, b]) {
      await loadDevice(img);
      expect(await db.notes.get(noteId)).toMatchObject({ deleted_at: null, tags: ['edited'] });
    }
    expect(server.rowsOf('notes')[0]).toMatchObject({ deleted_at: null, tags: ['edited'] });
  });

  it('delete vs edit race: a later delete wins over an earlier edit', async () => {
    let { a, b, noteId } = await twoDevices();
    b = await onDevice(b, async () => void (await editNote(noteId, { tags: ['edited'] }, T + DAY)));
    a = await onDevice(a, () => softDeleteNote(noteId, T + DAY + MIN));
    b = await onDevice(b, () => sync(server, T + DAY + 2 * MIN).then(() => {}));
    a = await onDevice(a, () => sync(server, T + DAY + 3 * MIN).then(() => {}));
    b = await onDevice(b, () => sync(server, T + DAY + 4 * MIN).then(() => {}));
    for (const img of [a, b]) {
      await loadDevice(img);
      expect((await db.notes.get(noteId))!.deleted_at).not.toBeNull();
    }
  });

  it('same term added on two devices offline is kept twice and flagged possible_duplicate', async () => {
    let a = await newDevice('dev-a');
    let b = await newDevice('dev-b');
    a = await onDevice(a, async () => void (await addNoteWithSenses({ term: 'cope', senses: [{ meaning_tr: 'başa çıkmak' }] }, T)));
    b = await onDevice(b, async () => void (await addNoteWithSenses({ term: 'cope', senses: [{ meaning_tr: 'üstesinden gelmek' }] }, T + 1)));
    a = await onDevice(a, () => sync(server, T + MIN).then(() => {}));
    b = await onDevice(b, () => sync(server, T + 2 * MIN).then(() => {}));
    a = await onDevice(a, () => sync(server, T + 3 * MIN).then(() => {}));
    for (const img of [a, b]) {
      await loadDevice(img);
      const notes = await db.notes.where('term_norm').equals('cope').toArray();
      expect(notes).toHaveLength(2);
      expect(notes.every((n) => n.possible_duplicate)).toBe(true);
    }
  });

  it('31 days offline: full resync pushes pending changes first, then drops purged rows', async () => {
    let { a, b, noteId } = await twoDevices();
    let keepId = '';
    a = await onDevice(a, async () => {
      keepId = (await addNoteWithSenses({ term: 'river', senses: [{ meaning_tr: 'nehir' }] }, T + 4 * MIN)).note.id;
      await sync(server, T + 5 * MIN);
    });
    b = await onDevice(b, () => sync(server, T + 6 * MIN).then(() => {}));
    // B goes offline. A deletes "bank"; 31 days later the server purges the tombstones.
    a = await onDevice(a, async () => {
      await softDeleteNote(noteId, T + DAY);
      await sync(server, T + DAY + MIN);
    });
    expect(server.purgeTombstones()).toBeGreaterThan(0);
    // Meanwhile B edited "river" offline (pending in its outbox).
    b = await onDevice(b, async () => {
      await editNote(keepId, { tags: ['offline-edit'] }, T + 31 * DAY);
      const report = await sync(server, T + 31 * DAY + MIN);
      expect(report.fullResync).toBe(true);
      expect(report.removed).toBeGreaterThan(0);
      expect(await db.notes.get(noteId)).toBeUndefined(); // the deletion reached B
      expect(await db.cards.where('note_id').equals(noteId).count()).toBe(0);
      expect(await db.notes.get(keepId)).toMatchObject({ tags: ['offline-edit'], deleted_at: null });
      expect(await db.outbox.count()).toBe(0);
      expect(await getCursor(META.syncCursor)).toBeGreaterThan(server.purgedThrough);
      expect((await db.meta.get(FULL_RESYNC_KEY))?.value).toBe(false);
    });
    expect(server.rowsOf('notes').find((n) => n.id === keepId)).toMatchObject({ tags: ['offline-edit'] });
    // Review logs are never removed.
    await loadDevice(b);
    expect(await db.review_logs.count()).toBe(server.rowsOf('review_logs').length);
  });

  it('an interrupted full resync starts over on the next run', async () => {
    const { b } = await twoDevices();
    await loadDevice(b);
    await db.transaction('rw', db.meta, () => setMeta(FULL_RESYNC_KEY, true));
    const report = await sync(server, T + DAY);
    expect(report.fullResync).toBe(true);
    expect((await db.meta.get(FULL_RESYNC_KEY))?.value).toBe(false);
  });
});

describe('pull', () => {
  it('pages of 500 with the cursor stored alongside the rows', async () => {
    let a = await newDevice('dev-a');
    a = await onDevice(a, async () => {
      for (let i = 0; i < 180; i++) await addNoteWithSenses({ term: `t${i}`, senses: [{ meaning_tr: `m${i}` }] }, T);
      await sync(server, T + MIN);
    });
    expect(server.rows.size).toBeGreaterThan(500);
    await newDevice('dev-b');
    const before = server.calls.pull;
    const report = await sync(server, T + 2 * MIN);
    expect(server.calls.pull - before).toBeGreaterThanOrEqual(2);
    expect(await db.notes.count()).toBe(180);
    expect(report.pulled).toBeGreaterThanOrEqual(server.rows.size - 1);
    expect(await getCursor(META.syncCursor)).toBe(Math.max(...[...server.rows.values()].map((r) => r.seq)));
  });

  it('fills lexicon_cache for referenced senses (cursor feed + missing ids)', async () => {
    await newDevice('dev-a');
    const lex: LexiconSense = {
      id: 'lex-1',
      term_id: 'term-1',
      lemma: 'bank',
      lemma_norm: 'bank',
      term_type: 'word',
      pos: 'noun',
      gloss_en: 'the land beside a river',
      meaning_tr: 'kıyı',
      ipa: '/bæŋk/',
      updated_at: T,
    };
    server.addLexicon(lex);
    await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'kıyı', lexicon_sense_id: 'lex-1' }] }, T);
    const r = await sync(server, T + MIN);
    expect(r.lexicon).toBeGreaterThan(0);
    expect(await db.lexicon_cache.get('lex-1')).toMatchObject({ meaning_tr: 'kıyı' });
    expect(await getCursor(META.lexiconCursor)).toBe(1);
  });
});

describe('SyncEngine', () => {
  it('does nothing for guests and when the session is not linked', async () => {
    const e = new SyncEngine({ transport: server, getSessionUserId: async () => null, isOnline: () => true });
    expect(await e.sync()).toEqual({ ok: false, reason: 'guest' });
    const e2 = new SyncEngine({ transport: server, getSessionUserId: async () => 'someone-else', isOnline: () => true });
    await newDevice('dev-a');
    expect(await e2.sync()).toEqual({ ok: false, reason: 'not_linked' });
    expect(server.calls.push + server.calls.pull).toBe(0);
  });

  it('reports offline, errors and recovery in its snapshot', async () => {
    await newDevice('dev-a');
    let online = false;
    const e = new SyncEngine({ transport: server, getSessionUserId: async () => USER, isOnline: () => online, now: () => T });
    expect(await e.sync()).toEqual({ ok: false, reason: 'offline' });
    online = true;
    server.faults.offline = true;
    const out = await e.sync();
    expect(out).toMatchObject({ ok: false, reason: 'error', error: 'network' });
    expect(e.getSnapshot()).toMatchObject({ error: 'network', running: false, active: true });
    server.faults.offline = false;
    expect(await e.sync()).toMatchObject({ ok: true });
    expect(e.getSnapshot().error).toBeNull();
    expect((await db.meta.get('last_sync_at'))?.value).toBe(T);
  });

  it('coalesces concurrent calls and respects the tab runner', async () => {
    await newDevice('dev-a');
    let runs = 0;
    const e = new SyncEngine({
      transport: server,
      getSessionUserId: async () => USER,
      isOnline: () => true,
      runner: {
        run: async (fn) => {
          runs++;
          return fn();
        },
      },
    });
    await Promise.all([e.sync(), e.sync(), e.sync()]);
    await new Promise((r) => setTimeout(r, 50));
    expect(runs).toBe(2); // one run + one follow-up for the calls made during it
    const busy = new SyncEngine({ transport: server, getSessionUserId: async () => USER, isOnline: () => true, runner: { run: async () => undefined } });
    expect(await busy.sync()).toEqual({ ok: false, reason: 'busy' });
  });
});

describe('deriveSyncState', () => {
  const base = { active: true, online: true, running: false, error: null, pending: 0, stuck: 0 } as const;
  it('maps engine facts to the indicator state', () => {
    expect(deriveSyncState({ ...base, active: false })).toBe('offline');
    expect(deriveSyncState({ ...base, online: false, pending: 3 })).toBe('offline');
    expect(deriveSyncState({ ...base, running: true })).toBe('syncing');
    expect(deriveSyncState({ ...base, stuck: 1, pending: 1 })).toBe('error');
    expect(deriveSyncState({ ...base, error: 'server' })).toBe('error');
    expect(deriveSyncState({ ...base, pending: 12 })).toBe('pending');
    expect(deriveSyncState(base)).toBe('synced');
  });
});

describe('review regressions', () => {
  it('a purge during a full resync does not drop the rows of later pages', async () => {
    let a = await newDevice('dev-a');
    let doomed = '';
    a = await onDevice(a, async () => {
      for (let i = 0; i < 180; i++) await addNoteWithSenses({ term: `w${i}`, senses: [{ meaning_tr: `m${i}` }] }, T);
      doomed = (await addNoteWithSenses({ term: 'doomed', senses: [{ meaning_tr: 'x' }] }, T)).note.id;
      await sync(server, T + MIN);
      await softDeleteNote(doomed, T + 2 * MIN);
      await sync(server, T + 3 * MIN);
    });
    let b = await newDevice('dev-b');
    b = await onDevice(b, () => sync(server, T + 4 * MIN).then(() => {}));
    await loadDevice(b);
    expect(await db.notes.filter((n) => n.deleted_at === null).count()).toBe(180);
    await db.transaction('rw', db.meta, () => setMeta(FULL_RESYNC_KEY, true));
    // The daily purge runs right after the first page of the full pull.
    const orig = server.pullChanges.bind(server);
    let calls = 0;
    server.pullChanges = async (since, limit, from) => {
      const page = await orig(since, limit, from);
      if (++calls === 1) server.purgeTombstones();
      return page;
    };
    await sync(server, T + 31 * DAY);
    expect(await db.notes.filter((n) => n.deleted_at === null).count()).toBe(180);
    expect(await db.notes.get(doomed)).toBeUndefined();
    expect((await db.meta.get(FULL_RESYNC_KEY))?.value).toBe(false);
  });

  it('a new device pulls an account with > 500 rows after a tombstone purge (no full_resync on page 2)', async () => {
    let a = await newDevice('dev-a');
    a = await onDevice(a, async () => {
      for (let i = 0; i < 180; i++) await addNoteWithSenses({ term: `w${i}`, senses: [{ meaning_tr: `m${i}` }] }, T);
      const gone = await addNoteWithSenses({ term: 'gone', senses: [{ meaning_tr: 'x' }] }, T);
      await softDeleteNote(gone.note.id, T + MIN);
      await sync(server, T + 2 * MIN);
    });
    expect(server.purgeTombstones()).toBeGreaterThan(0);
    await newDevice('dev-b');
    const report = await sync(server, T + 40 * DAY);
    expect(report.fullResync).toBe(false);
    expect(await db.notes.count()).toBe(180);
    expect(await db.cards.count()).toBe(server.rowsOf('cards').length);
  });

  it('stops when the signed-in session changes during a run (no push into another account)', async () => {
    await newDevice('dev-a');
    for (let i = 0; i < 60; i++) await addNoteWithSenses({ term: `w${i}`, senses: [{ meaning_tr: `m${i}` }] }, T);
    let session: string | null = USER;
    const orig = server.pushBatch.bind(server);
    server.pushBatch = async (items) => {
      const res = await orig(items);
      session = 'user-b'; // another account signs in (e.g. in another tab) mid-run
      return res;
    };
    const e = new SyncEngine({ transport: server, getSessionUserId: async () => session, isOnline: () => true, now: () => T + MIN });
    const out = await e.sync();
    expect(out).toMatchObject({ ok: false, reason: 'error', error: 'auth' });
    expect(server.calls.push).toBe(1);
    expect(server.calls.pull).toBe(0);
    expect(await db.outbox.count()).toBeGreaterThan(0);
  });

  it('a forced run tries a rejected row once, not once per batch', async () => {
    await newDevice('dev-a');
    const bad = await addNoteWithSenses({ term: 'bad', senses: [{ meaning_tr: 'kötü' }] }, T);
    for (let i = 0; i < 60; i++) await addNoteWithSenses({ term: `w${i}`, senses: [{ meaning_tr: `m${i}` }] }, T);
    server.faults.rejectIds = new Set([bad.note.id]);
    await sync(server, T + MIN, true);
    const rows = await db.outbox.where('[table+row_id]').equals(['notes', bad.note.id]).toArray();
    expect(rows.every((r) => r.attempts === 1)).toBe(true);
  });
});
