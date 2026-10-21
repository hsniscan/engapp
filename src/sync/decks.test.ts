// decks through the sync engine (FakeServer mirrors 20261022000400_decks.sql): two devices,
// a backend without the table yet, and the one-time re-pull after an app update.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addNoteWithSenses,
  createDeck,
  db,
  deleteDeck,
  getMeta,
  listDecks,
  META,
  PULL_BACKFILL_KEY,
  setMeta,
  setNoteTags,
  updateDeck,
  updateSettings,
} from '@/data';
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
  await updateSettings({ timezone: 'Europe/Istanbul' }, T);
  return saveDevice();
}

const sync = (server: FakeServer, now: number) => runSync(server, { now: () => now });

let server: FakeServer;
beforeEach(async () => {
  server = new FakeServer(USER);
  await resetDb();
});

describe('decks sync', () => {
  it('a deck made on one device shows up, changes and disappears on the other', async () => {
    let a = await newDevice('dev-a');
    let deckId = '';
    a = await onDevice(a, async () => {
      deckId = (
        await createDeck({ name: 'İş', filter: { v: 1, tags: ['iş'], states: ['struggling'] } }, T)
      ).id;
      await sync(server, T + MIN);
      expect(await db.outbox.count()).toBe(0);
    });
    expect(server.rowsOf('decks')).toEqual([
      expect.objectContaining({
        id: deckId,
        user_id: USER,
        name: 'İş',
        filter: { v: 1, tags: ['iş'], states: ['struggling'] },
      }),
    ]);

    let b = await newDevice('dev-b');
    b = await onDevice(b, async () => {
      await sync(server, T + 2 * MIN);
      expect((await listDecks()).map((d) => d.name)).toEqual(['İş']);
      await updateDeck(deckId, { name: 'Ofis' }, T + 3 * MIN);
      await sync(server, T + 3 * MIN);
    });

    a = await onDevice(a, async () => {
      await sync(server, T + 4 * MIN);
      expect((await listDecks()).map((d) => d.name)).toEqual(['Ofis']);
      await deleteDeck(deckId, T + 5 * MIN);
      await sync(server, T + 5 * MIN);
    });
    await onDevice(b, async () => {
      await sync(server, T + 6 * MIN);
      expect(await listDecks()).toEqual([]);
      expect((await db.decks.get(deckId))?.deleted_at).toBe(T + 5 * MIN);
    });
  });

  it('bulk tags reach the other device as ordinary note updates', async () => {
    let a = await newDevice('dev-a');
    a = await onDevice(a, async () => {
      const ids = [];
      for (const term of ['desk', 'pen', 'chair'])
        ids.push((await addNoteWithSenses({ term, senses: [{ meaning_tr: term }] }, T)).note.id);
      await setNoteTags(ids, { add: ['iş'] }, T + 1);
      await sync(server, T + MIN);
    });
    await onDevice(await newDevice('dev-b'), async () => {
      await sync(server, T + 2 * MIN);
      expect((await db.notes.toArray()).map((n) => n.tags)).toEqual([['iş'], ['iş'], ['iş']]);
    });
    expect(a).toBeTruthy();
  });

  it('waits without burning attempts while the backend has no decks table, then sends', async () => {
    server.decksSupported = false;
    let a = await newDevice('dev-a');
    a = await onDevice(a, async () => {
      await addNoteWithSenses({ term: 'cope', senses: [{ meaning_tr: 'başa çıkmak' }] }, T);
      await createDeck({ name: 'Yeni', filter: { v: 1, states: ['new'] } }, T);
      for (let i = 1; i <= 8; i++) await sync(server, T + i * MIN);
      // Everything else synced; the deck waits with no failed attempts.
      expect(server.rowsOf('notes')).toHaveLength(1);
      const queued = await db.outbox.toArray();
      expect(queued.map((o) => [o.table, o.attempts])).toEqual([['decks', 0]]);
      expect(server.calls.registry).toBe(8);
    });

    // The migration is applied: the next run confirms the table once and sends the deck.
    server.decksSupported = true;
    await onDevice(a, async () => {
      await sync(server, T + 10 * MIN);
      expect(await db.outbox.count()).toBe(0);
      expect(await getMeta(META.serverTables)).toEqual(['decks']);
      await createDeck({ name: 'Two', filter: { v: 1 } }, T + 11 * MIN);
      await sync(server, T + 11 * MIN);
      await sync(server, T + 12 * MIN);
    });
    expect(server.rowsOf('decks')).toHaveLength(2);
    expect(server.calls.registry).toBe(9);
  });

  it('a backend from before practice (no registry at all) also just makes decks wait', async () => {
    server.practiceSupported = false;
    server.decksSupported = false;
    await onDevice(await newDevice('dev-a'), async () => {
      await createDeck({ name: 'D', filter: { v: 1 } }, T);
      await sync(server, T + MIN);
      expect((await db.outbox.toArray()).map((o) => [o.table, o.attempts])).toEqual([['decks', 0]]);
    });
  });

  it('re-pulls decks once on a device whose older app skipped them', async () => {
    let a = await newDevice('dev-a');
    a = await onDevice(a, async () => {
      await createDeck({ name: 'Eski', filter: { v: 1, tags: ['x'] } }, T);
      await addNoteWithSenses({ term: 'cope', senses: [{ meaning_tr: 'başa çıkmak' }] }, T);
      await sync(server, T + MIN);
    });

    // Device B pulled everything with an app that did not know decks: its cursor is past the
    // deck row but it has no deck. The app update (Dexie v8) then records the backfill.
    await onDevice(await newDevice('dev-b'), async () => {
      await sync(server, T + 2 * MIN);
      await db.decks.clear();
      await db.transaction('rw', db.meta, () => setMeta(PULL_BACKFILL_KEY, ['decks']));
      const pullsBefore = server.calls.pull;
      await sync(server, T + 3 * MIN);
      expect((await listDecks()).map((d) => d.name)).toEqual(['Eski']);
      expect(await getMeta(PULL_BACKFILL_KEY)).toEqual([]);
      expect(await db.notes.count()).toBe(1);
      // Only once.
      await db.decks.clear();
      const pullsAfter = server.calls.pull;
      expect(pullsAfter).toBeGreaterThan(pullsBefore + 1);
      await sync(server, T + 4 * MIN);
      expect(server.calls.pull).toBe(pullsAfter + 1);
      expect(await listDecks()).toEqual([]);
    });
    expect(a).toBeTruthy();
  });
});
