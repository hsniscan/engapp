import { beforeEach, describe, expect, it } from 'vitest';
import {
  addNoteWithSenses,
  answerCard,
  db,
  ensureSettings,
  getCurrentUserId,
  updateSettings,
} from '@/data';
import { SyncEngine } from '@/sync/engine';
import { FakeServer, loadDevice, onDevice, saveDevice } from '@/sync/testing/fakeServer';
import { Rating } from '@/domain/types';
import { resetDb } from '@/test/db';
import { configureLink, getLinkState, linkAccount, resetLinkForTesting, resolveLink } from './link';

const T = Date.UTC(2026, 9, 21, 9);
const USER = 'user-1';
let server: FakeServer;

function engine() {
  return new SyncEngine({
    transport: server,
    getSessionUserId: async () => USER,
    isOnline: () => true,
    now: () => T + 60_000,
  });
}

/** Device 1 of the account already synced "cope" and a review. */
async function accountWithData() {
  await resetDb();
  configureLink({ transport: server, engine: engine() });
  await updateSettings({ daily_new_limit: 25 }, T);
  const a = await addNoteWithSenses({ term: 'cope', senses: [{ meaning_tr: 'başa çıkmak' }] }, T);
  const rec = (await db.cards.where('note_id').equals(a.note.id).toArray()).find(
    (c) => c.card_type === 'recognition',
  )!;
  await answerCard({ card_id: rec.id, rating: Rating.Good, duration_ms: 2000 }, T);
  await linkAccount(USER);
  expect(getLinkState()).toMatchObject({ phase: 'done' });
  expect(server.rowsOf('notes')).toHaveLength(1);
}

/** A guest device with its own data. */
async function guestDevice() {
  await resetDb();
  await ensureSettings(T);
  await addNoteWithSenses({ term: 'cope', senses: [{ meaning_tr: 'üstesinden gelmek' }] }, T + 1);
  await addNoteWithSenses({ term: 'thrive', senses: [{ meaning_tr: 'gelişmek' }] }, T + 2);
}

beforeEach(async () => {
  server = new FakeServer(USER);
  resetLinkForTesting();
  await resetDb();
});

describe('account linking', () => {
  it('first sign-in with an empty account: guest data is adopted and pushed', async () => {
    await guestDevice();
    configureLink({ transport: server, engine: engine() });
    await linkAccount(USER);
    expect(getLinkState()).toMatchObject({ phase: 'done', duplicates: 0 });
    expect(await getCurrentUserId()).toBe(USER);
    expect(await db.outbox.count()).toBe(0);
    expect(server.rowsOf('notes')).toHaveLength(2);
    expect((await db.notes.toArray()).every((n) => n.user_id === USER)).toBe(true);
  });

  it('same account again: just syncs, no question', async () => {
    await accountWithData();
    resetLinkForTesting();
    await linkAccount(USER);
    expect(getLinkState()).toEqual({ phase: 'idle' });
  });

  it('second device with only default settings takes the account as it is (account settings win)', async () => {
    await accountWithData();
    await resetDb();
    await ensureSettings(T + 5);
    configureLink({ transport: server, engine: engine() });
    await linkAccount(USER);
    expect(getLinkState()).toMatchObject({ phase: 'done' });
    expect((await db.settings.get('settings'))!.daily_new_limit).toBe(25);
    expect(await db.notes.count()).toBe(1);
  });

  it('second device with data asks; "birleştir" keeps both and flags the duplicate term', async () => {
    await accountWithData();
    await guestDevice();
    configureLink({ transport: server, engine: engine() });
    await linkAccount(USER);
    expect(getLinkState()).toMatchObject({ phase: 'choose', otherAccount: false });
    await resolveLink('merge');
    expect(getLinkState()).toMatchObject({ phase: 'done', duplicates: 2 });
    const cope = await db.notes.where('term_norm').equals('cope').toArray();
    expect(cope).toHaveLength(2);
    expect(cope.every((n) => n.possible_duplicate)).toBe(true);
    expect(await db.notes.where('term_norm').equals('thrive').count()).toBe(1);
    expect(await db.review_logs.count()).toBe(1);
    expect((await db.settings.get('settings'))!.daily_new_limit).toBe(25); // account settings kept
    expect(server.rowsOf('notes')).toHaveLength(3);
  });

  it('"yerel veriyi at" replaces this device with the account', async () => {
    await accountWithData();
    await guestDevice();
    configureLink({ transport: server, engine: engine() });
    await linkAccount(USER);
    await resolveLink('discard_local');
    expect(getLinkState()).toMatchObject({ phase: 'done' });
    const notes = await db.notes.toArray();
    expect(notes.map((n) => n.term)).toEqual(['cope']);
    expect(server.rowsOf('notes')).toHaveLength(1);
    expect(await db.review_logs.count()).toBe(1);
  });

  it('"hesaptakini at" tombstones the account rows and uploads this device', async () => {
    await accountWithData();
    const accountNoteId = server.rowsOf('notes')[0]!.id;
    await guestDevice();
    configureLink({ transport: server, engine: engine() });
    await linkAccount(USER);
    await resolveLink('discard_account');
    expect(getLinkState()).toMatchObject({ phase: 'done' });
    const live = server.rowsOf('notes').filter((n) => n.deleted_at == null);
    expect(live.map((n) => n.term).sort()).toEqual(['cope', 'thrive']);
    expect(server.rowsOf('notes').find((n) => n.id === accountNoteId)!.deleted_at).not.toBeNull();
    // Another device pulling now sees only this device's notes.
    const local = await saveDevice();
    await resetDb();
    configureLink({ transport: server, engine: engine() });
    await linkAccount(USER);
    expect(
      (await db.notes.filter((n) => n.deleted_at === null).toArray()).map((n) => n.term).sort(),
    ).toEqual(['cope', 'thrive']);
    await loadDevice(local);
  });

  it('a device used by another account asks too and re-stamps the rows on merge', async () => {
    await guestDevice();
    const img = await onDevice(await saveDevice(), async () => {
      await db.transaction('rw', db.meta, () =>
        db.meta.put({ key: 'user_id', value: 'someone-else' }),
      );
    });
    await accountWithData();
    await loadDevice(img);
    configureLink({ transport: server, engine: engine() });
    await linkAccount(USER);
    expect(getLinkState()).toMatchObject({ phase: 'choose', otherAccount: true });
    await resolveLink('merge');
    expect((await db.notes.toArray()).every((n) => n.user_id === USER)).toBe(true);
  });

  it("another account's data is never copied silently into an empty account", async () => {
    await guestDevice();
    await db.transaction('rw', db.meta, () =>
      db.meta.put({ key: 'user_id', value: 'someone-else' }),
    );
    configureLink({ transport: server, engine: engine() });
    await linkAccount(USER); // the server account is empty
    expect(getLinkState()).toMatchObject({ phase: 'choose', otherAccount: true });
    expect(server.rowsOf('notes')).toHaveLength(0);
  });

  it('a failed check (offline) shows an error that can be retried', async () => {
    await guestDevice();
    server.faults.offline = true;
    configureLink({ transport: server, engine: engine() });
    await linkAccount(USER);
    expect(getLinkState()).toMatchObject({ phase: 'error' });
    expect(await getCurrentUserId()).toBeNull(); // nothing changed locally
  });
});
