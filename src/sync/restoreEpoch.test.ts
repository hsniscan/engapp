// Decision 0075: a database restore must not silently break sync (restore epoch, re-push of
// what the backup missed), rows refused for a nearly full server wait without getting stuck,
// and library texts travel by reference.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addNoteWithSenses,
  answerCard,
  db,
  editNote,
  getMeta,
  META,
  saveReadingProgress,
  saveText,
  setMeta,
  STUCK_ATTEMPTS,
  stuckOutboxCount,
  updateSettings,
} from '@/data';
import { Rating } from '@/domain/types';
import { resetDb } from '@/test/db';
import { SyncApiError } from './api';
import {
  FULL_RESYNC_KEY,
  INITIAL_EPOCH,
  RESTORE_RESYNC_KEY,
  restoreDetected,
  runSync,
  SYNC_EPOCH_KEY,
  SYNC_HELD_KEY,
  type SyncHeld,
} from './engine';
import { FakeServer, onDevice, saveDevice, type DeviceImage } from './testing/fakeServer';

const T = Date.UTC(2026, 10, 6, 9);
const MIN = 60_000;
const USER = 'user-1';

async function newDevice(deviceId: string): Promise<DeviceImage> {
  await resetDb();
  await db.transaction('rw', db.meta, async () => {
    await setMeta(META.deviceId, deviceId);
    await setMeta(META.userId, USER);
  });
  await updateSettings({ timezone: 'Europe/Istanbul' }, T);
  return saveDevice();
}

const sync = (server: FakeServer, now: number, force = false) => runSync(server, { now: () => now, force });
const noteTerms = (server: FakeServer) => server.rowsOf('notes').map((n) => n.term).sort();

let server: FakeServer;
beforeEach(async () => {
  server = new FakeServer(USER);
  await resetDb();
});

describe('restoreDetected', () => {
  it('compares the epoch, and the cursor with the sequence head', () => {
    expect(restoreDetected(1, { epoch: 1, seqHead: 50 }, 40)).toBe(false);
    expect(restoreDetected(1, { epoch: 7, seqHead: 50 }, 40)).toBe(true);
    // The after-restore step did not run: the sequence is behind the device.
    expect(restoreDetected(1, { epoch: 1, seqHead: 30 }, 40)).toBe(true);
    // An older backend says nothing.
    expect(restoreDetected(1, {}, 40)).toBe(false);
    expect(restoreDetected(undefined, {}, 40)).toBe(false);
    // Never saw an epoch: only a restored database counts, and only for a device that pulled.
    expect(restoreDetected(undefined, { epoch: INITIAL_EPOCH, seqHead: 50 }, 40)).toBe(false);
    expect(restoreDetected(undefined, { epoch: 9, seqHead: 50 }, 40)).toBe(true);
    expect(restoreDetected(undefined, { epoch: 9, seqHead: 50 }, 0)).toBe(false);
  });
});

describe('restore epoch (decision 0075)', () => {
  it('stores the first epoch it sees without a resync', async () => {
    await newDevice('dev-a');
    await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] }, T);
    const r = await sync(server, T + MIN);
    expect(r.fullResync).toBe(false);
    expect(await getMeta(SYNC_EPOCH_KEY)).toBe(INITIAL_EPOCH);
    const again = await sync(server, T + 2 * MIN);
    expect(again.fullResync).toBe(false);
  });

  it('a restore simulation: rows acked after the backup come back from the devices', async () => {
    let a = await newDevice('dev-a');
    let b = await newDevice('dev-b');
    let early = '';
    a = await onDevice(a, async () => {
      early = (await addNoteWithSenses({ term: 'before', senses: [{ meaning_tr: 'önce' }] }, T)).note.id;
      await sync(server, T + MIN);
    });
    const backup = server.backup();

    // After the backup: a new note with an answer, and an edit of the older note, all acked.
    let late = '';
    a = await onDevice(a, async () => {
      const n = await addNoteWithSenses({ term: 'after', senses: [{ meaning_tr: 'sonra' }] }, T + 2 * MIN);
      late = n.note.id;
      const card = (await db.cards.where('note_id').equals(late).toArray())[0]!;
      await answerCard({ card_id: card.id, rating: Rating.Good, duration_ms: 2000 }, T + 3 * MIN);
      await editNote(early, { tags: ['edited'] }, T + 4 * MIN);
      await sync(server, T + 5 * MIN);
      expect(await db.outbox.count()).toBe(0);
    });
    // Device B pulls everything, then device A is lost (only B still has the late rows).
    b = await onDevice(b, async () => {
      await sync(server, T + 6 * MIN);
      expect(await db.notes.count()).toBe(2);
    });
    const logsBefore = server.rowsOf('review_logs').length;
    expect(logsBefore).toBe(1);

    // The database fails and is restored from the backup; the runbook runs sync_after_restore.
    server.restore(backup, { afterRestore: true });
    expect(noteTerms(server)).toEqual(['before']);
    expect(server.rowsOf('review_logs')).toHaveLength(0);

    b = await onDevice(b, async () => {
      const r = await sync(server, T + 7 * MIN);
      expect(r.fullResync).toBe(true);
      expect(r.requeued).toBeGreaterThan(0);
      expect(r.removed).toBe(0);
      expect(await db.notes.count()).toBe(2); // nothing deleted locally
      expect(await db.outbox.count()).toBe(0); // and everything pushed again
      expect(await getMeta(SYNC_EPOCH_KEY)).toBe(server.epoch);
      expect(await getMeta(RESTORE_RESYNC_KEY)).toBeUndefined();
    });
    expect(noteTerms(server)).toEqual(['after', 'before']);
    expect(server.rowsOf('review_logs')).toHaveLength(1);
    expect(server.rowsOf('notes').find((n) => n.id === early)?.tags).toEqual(['edited']);

    // A new device after the restore gets all of it.
    await onDevice(await newDevice('dev-c'), async () => {
      await sync(server, T + 8 * MIN);
      expect((await db.notes.toArray()).map((n) => n.term).sort()).toEqual(['after', 'before']);
      expect(await db.review_logs.count()).toBe(1);
    });

    // The next run of B is an ordinary one.
    await onDevice(b, async () => {
      const r = await sync(server, T + 9 * MIN);
      expect(r.fullResync).toBe(false);
      expect(r.requeued).toBe(0);
    });
  });

  it('new rows after a restore reach devices whose cursor is past the backup', async () => {
    let a = await newDevice('dev-a');
    let b = await newDevice('dev-b');
    a = await onDevice(a, async () => {
      await addNoteWithSenses({ term: 'one', senses: [{ meaning_tr: 'bir' }] }, T);
      await sync(server, T + MIN);
    });
    const backup = server.backup();
    a = await onDevice(a, async () => {
      for (const term of ['two', 'three', 'four']) await addNoteWithSenses({ term, senses: [{ meaning_tr: term }] }, T + 2 * MIN);
      await sync(server, T + 3 * MIN);
    });
    b = await onDevice(b, () => sync(server, T + 4 * MIN).then(() => undefined));
    // Restored WITHOUT the after-restore step: the epoch is unchanged, the sequence went back.
    server.restore(backup);
    // A third device writes; its rows get sequence values B has already passed.
    await onDevice(await newDevice('dev-c'), async () => {
      await addNoteWithSenses({ term: 'five', senses: [{ meaning_tr: 'beş' }] }, T + 5 * MIN);
      await sync(server, T + 6 * MIN);
    });
    b = await onDevice(b, async () => {
      const r = await sync(server, T + 7 * MIN);
      expect(r.fullResync).toBe(true); // the cursor was above the sequence head
      expect((await db.notes.toArray()).map((n) => n.term).sort()).toEqual(['five', 'four', 'one', 'three', 'two']);
    });
    expect(noteTerms(server)).toEqual(['five', 'four', 'one', 'three', 'two']);
  });

  it('an interrupted restore resync starts over in restore mode', async () => {
    let a = await newDevice('dev-a');
    a = await onDevice(a, async () => {
      await addNoteWithSenses({ term: 'one', senses: [{ meaning_tr: 'bir' }] }, T);
      await sync(server, T + MIN);
    });
    const backup = server.backup();
    a = await onDevice(a, async () => {
      await addNoteWithSenses({ term: 'two', senses: [{ meaning_tr: 'iki' }] }, T + 2 * MIN);
      await sync(server, T + 3 * MIN);
    });
    server.restore(backup, { afterRestore: true });
    await onDevice(a, async () => {
      const pull = server.pullChanges.bind(server);
      let calls = 0;
      server.pullChanges = async (since, limit, from) => {
        // The first page (epoch check) answers, the full pull then fails.
        if (++calls === 2) throw new SyncApiError('network', 'Failed to fetch');
        return pull(since, limit, from);
      };
      await expect(sync(server, T + 4 * MIN)).rejects.toThrow();
      expect(await getMeta(FULL_RESYNC_KEY)).toBe(true);
      expect(await getMeta(RESTORE_RESYNC_KEY)).toBe(server.epoch);
      server.pullChanges = pull;
      const r = await sync(server, T + 5 * MIN);
      expect(r.requeued).toBeGreaterThan(0);
      expect(await db.notes.count()).toBe(2);
    });
    expect(noteTerms(server)).toEqual(['one', 'two']);
  });

  it('a full resync for purged tombstones that meets a restore deletes nothing', async () => {
    let a = await newDevice('dev-a');
    a = await onDevice(a, async () => {
      await addNoteWithSenses({ term: 'one', senses: [{ meaning_tr: 'bir' }] }, T);
      await sync(server, T + MIN);
    });
    const backup = server.backup();
    a = await onDevice(a, async () => {
      await addNoteWithSenses({ term: 'two', senses: [{ meaning_tr: 'iki' }] }, T + 2 * MIN);
      await sync(server, T + 3 * MIN);
      // Long offline: the horizon asked for a full resync before the restore was seen.
      await db.transaction('rw', db.meta, () => setMeta(FULL_RESYNC_KEY, true));
    });
    server.restore(backup, { afterRestore: true });
    await onDevice(a, async () => {
      const r = await sync(server, T + 4 * MIN);
      expect(r.removed).toBe(0);
      expect(r.requeued).toBeGreaterThan(0);
      expect(await db.notes.count()).toBe(2);
      expect(await getMeta(SYNC_EPOCH_KEY)).toBe(server.epoch);
    });
    expect(noteTerms(server)).toEqual(['one', 'two']);
  });

  it('a device that never saw an epoch recovers when the server was restored', async () => {
    let a = await newDevice('dev-a');
    a = await onDevice(a, async () => {
      await addNoteWithSenses({ term: 'one', senses: [{ meaning_tr: 'bir' }] }, T);
      await sync(server, T + MIN);
      await db.meta.delete(SYNC_EPOCH_KEY); // an app version from before the epoch
    });
    server.restore(server.backup(), { afterRestore: true });
    server.rows.clear(); // the backup was older than the device's rows
    await onDevice(a, async () => {
      const r = await sync(server, T + 2 * MIN);
      expect(r.fullResync).toBe(true);
    });
    expect(noteTerms(server)).toEqual(['one']);
  });

  it('an older backend without an epoch changes nothing', async () => {
    server.epoch = undefined;
    await newDevice('dev-a');
    await addNoteWithSenses({ term: 'one', senses: [{ meaning_tr: 'bir' }] }, T);
    const r = await sync(server, T + MIN);
    expect(r.fullResync).toBe(false);
    expect(await getMeta(SYNC_EPOCH_KEY)).toBeUndefined();
  });
});

describe('rows held by a nearly full server (decision 0075)', () => {
  it('a new text waits without getting stuck while answers keep syncing', async () => {
    await newDevice('dev-a');
    server.storageFull = true;
    const textId = await saveText({ kind: 'paste', title: 'Long read', body: 'Some text to read.' }, T);
    const n = await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] }, T);
    const card = (await db.cards.where('note_id').equals(n.note.id).toArray())[0]!;
    await answerCard({ card_id: card.id, rating: Rating.Good, duration_ms: 1000 }, T + 1);
    const r = await sync(server, T + MIN);
    expect(r.held).toBe(1);
    expect(r.rejected).toBe(0);
    expect(server.rowsOf('review_logs')).toHaveLength(1);
    expect(server.rowsOf('texts')).toHaveLength(0);
    const held = await getMeta<SyncHeld>(SYNC_HELD_KEY);
    expect(held?.reason).toBe('storage');
    expect(held?.rows).toEqual([`texts\u0000${textId}`]);

    // Forced syncs ("Şimdi senkronla") try again but never count it as a failed attempt.
    for (let i = 0; i < STUCK_ATTEMPTS + 2; i++) await sync(server, T + 2 * MIN + i, true);
    expect(await stuckOutboxCount()).toBe(0);
    // Not offered again before the hold ends in a normal run.
    const pushesBefore = server.calls.push;
    await sync(server, T + 30 * MIN);
    expect(server.calls.push).toBe(pushesBefore);

    // Space was freed: the text goes out and the note disappears.
    server.storageFull = false;
    await sync(server, T + 7 * 60 * MIN);
    expect(server.rowsOf('texts')).toHaveLength(1);
    expect(await getMeta(SYNC_HELD_KEY)).toBeUndefined();
  });
});

describe('library texts by reference (decision 0075)', () => {
  const sentences = [
    { en: 'The cat sat.', tr: 'Kedi oturdu.', audio_key: null, p: 0 },
    { en: 'It was warm.', tr: 'Hava sıcaktı.', audio_key: null, p: 0 },
  ];

  it('pushes no body, keeps the local copy, and fills a new device from its library cache', async () => {
    let a = await newDevice('dev-a');
    let textId = '';
    a = await onDevice(a, async () => {
      textId = await saveText({ kind: 'graded', title: 'Cat', body: 'The cat sat. It was warm.', graded_id: 'g-1' }, T);
      await sync(server, T + MIN);
    });
    const stored = server.rowsOf('texts')[0]!;
    expect(stored.body).toBe('');
    expect(stored.graded_id).toBe('g-1');
    expect(server.pushed.filter((p) => p.table === 'texts').every((p) => (p.payload as { body: string }).body === '')).toBe(true);

    // Progress on device A: device B, which has the library text cached, pulls the row.
    let b = await newDevice('dev-b');
    b = await onDevice(b, async () => {
      await db.graded_bodies.put({ id: 'g-1', title: 'Cat', sentences, glosses: [], fetched_at: T });
      await sync(server, T + 2 * MIN);
      expect((await db.texts.get(textId))?.body).toBe('The cat sat. It was warm.');
      expect(await db.outbox.count()).toBe(0); // filled locally, nothing to push
    });

    // A's own copy survives the echo of its own write and of B's later progress.
    await onDevice(b, async () => {
      await saveReadingProgress(textId, 5, 1000, T + 3 * MIN);
      await sync(server, T + 3 * MIN);
    });
    await onDevice(a, async () => {
      await sync(server, T + 4 * MIN);
      const row = await db.texts.get(textId);
      expect(row?.body).toBe('The cat sat. It was warm.');
      expect(row?.progress_offset).toBe(5);
    });
  });
});
