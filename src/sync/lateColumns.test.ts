// Columns added in v0.2 (notes.level_override, the settings level fields, interests, topics)
// on a device that pulled them while it still ran v0.1/İP1: that version stripped them, the
// Dexie upgrade filled unset values under the same HLC, and the device's next edit would push
// those values over the real ones. The v11 re-pull and the same-HLC merge
// (domain/syncMerge.ts) restore them. The FakeServer keeps columns a push leaves out, like
// _sync_upsert (20261021001100_word_levels.sql).
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addNoteWithSenses,
  db,
  PULL_BACKFILL_KEY,
  setLevelOverride,
  setMeta,
  META,
  updateSettings,
} from '@/data';
import { setNoteTags } from '@/data/decks';
import type { Note, Settings } from '@/domain/types';
import { resetDb } from '@/test/db';
import { runSync } from './engine';
import { FakeServer, onDevice, saveDevice, type DeviceImage } from './testing/fakeServer';

const T = Date.UTC(2026, 9, 21, 9);
const MIN = 60_000;
const USER = 'user-1';

async function newDevice(deviceId: string): Promise<DeviceImage> {
  await resetDb();
  await db.transaction('rw', db.meta, async () => {
    await setMeta(META.deviceId, deviceId);
    await setMeta(META.userId, USER);
  });
  return saveDevice();
}

const sync = (server: FakeServer, now: number) => runSync(server, { now: () => now });

/** What v0.1/İP1 kept of the rows it pulled, after the v4/v9 fill-ins (HLCs unchanged). */
async function asIfPulledByOldVersion(): Promise<void> {
  await db.notes.toCollection().modify((n: Note) => {
    n.level_override = null;
  });
  await db.settings.toCollection().modify((s: Settings) => {
    s.level_source = s.level !== 'B1' ? 'manual' : 'default';
    s.level_locked = false;
    s.level_updated_at = null;
    s.level_change = null;
    delete s.interests;
  });
}

let server: FakeServer;
let noteId: string;
beforeEach(async () => {
  server = new FakeServer(USER);
  const a = await newDevice('dev-a');
  await onDevice(a, async () => {
    await updateSettings({ timezone: 'Europe/Istanbul', level: 'C1', interests: ['tech'] }, T);
    await updateSettings({ level_locked: true }, T + 1);
    const res = await addNoteWithSenses(
      { term: 'cope', senses: [{ meaning_tr: 'başa çıkmak', pos: 'verb' }] },
      T + 2,
    );
    noteId = res.note.id;
    await setLevelOverride(noteId, 'B2', T + 3);
    await sync(server, T + MIN);
  });
});

const serverNote = () => server.rowsOf('notes').find((r) => r.id === noteId)!;
const serverSettings = () => server.rowsOf('settings')[0]!;

describe('columns an older app version dropped', () => {
  it('a device updated from v0.1 gets them back once and its next edit keeps them', async () => {
    let b = await newDevice('dev-b');
    b = await onDevice(b, async () => {
      await sync(server, T + 2 * MIN);
      await asIfPulledByOldVersion();
      // The v11 upgrade records the re-pull (the device had pulled before).
      await db.transaction('rw', db.meta, () =>
        setMeta(PULL_BACKFILL_KEY, ['notes', 'settings', 'sources']),
      );
    });
    await onDevice(b, async () => {
      await sync(server, T + 3 * MIN);
      expect((await db.notes.get(noteId))?.level_override).toBe('B2');
      expect(await db.settings.get('settings')).toMatchObject({
        level: 'C1',
        level_source: 'manual',
        level_locked: true,
        interests: ['tech'],
      });
      expect(await db.meta.get(PULL_BACKFILL_KEY)).toMatchObject({ value: [] });

      await setNoteTags([noteId], { add: ['iş'] }, T + 4 * MIN);
      await updateSettings({ theme: 'dark' }, T + 4 * MIN);
      await sync(server, T + 5 * MIN);
    });
    expect(serverNote()).toMatchObject({ tags: ['iş'], level_override: 'B2' });
    expect(serverSettings()).toMatchObject({
      theme: 'dark',
      level_locked: true,
      interests: ['tech'],
    });
  });

  it('without the re-pull, the stripped values would have reached the server (the bug)', async () => {
    let b = await newDevice('dev-b');
    b = await onDevice(b, async () => {
      await sync(server, T + 2 * MIN);
      await asIfPulledByOldVersion();
    });
    await onDevice(b, async () => {
      await setNoteTags([noteId], { add: ['iş'] }, T + 4 * MIN);
      await sync(server, T + 5 * MIN);
    });
    expect(serverNote()).toMatchObject({ tags: ['iş'], level_override: null });
  });

  it("the echo of an old version's queued push fills the column the push left out", async () => {
    let b = await newDevice('dev-b');
    b = await onDevice(b, async () => {
      await sync(server, T + 2 * MIN);
      await asIfPulledByOldVersion();
      // An edit made by the old version: its payload has no level_override at all.
      const note = (await db.notes.get(noteId))!;
      const { level_override: _, ...old } = {
        ...note,
        tags: ['eski'],
        hlc: `00${T + 3 * MIN}:00000:dev-b`,
        updated_at: T + 3 * MIN,
      };
      await db.notes.put(old as Note);
      await db.outbox.add({
        table: 'notes',
        row_id: noteId,
        op: 'upsert',
        payload: old,
        attempts: 0,
        next_attempt_at: 0,
      });
    });
    await onDevice(b, async () => {
      await sync(server, T + 4 * MIN);
      expect(serverNote()).toMatchObject({ tags: ['eski'], level_override: 'B2' });
      expect((await db.notes.get(noteId))?.level_override).toBe('B2');
    });
  });
});
