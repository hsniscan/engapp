// practice_logs through the sync engine (FakeServer mirrors 20261021000900_practice.sql).
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addNoteWithSenses,
  adoptGuestData,
  answerCard,
  db,
  exportBackup,
  getMeta,
  META,
  recordPractice,
  restoreBackup,
  setMeta,
  stuckOutboxCount,
  updateSettings,
} from '@/data';
import { Rating, type Card } from '@/domain/types';
import { resetDb } from '@/test/db';
import { runSync } from './engine';
import { FakeServer, onDevice, saveDevice, type DeviceImage } from './testing/fakeServer';

const T = Date.UTC(2026, 9, 21, 9);
const MIN = 60_000;
const USER = 'user-1';

async function newDevice(deviceId: string, userId: string | null = USER): Promise<DeviceImage> {
  await resetDb();
  await db.transaction('rw', db.meta, async () => {
    await setMeta(META.deviceId, deviceId);
    if (userId) await setMeta(META.userId, userId);
  });
  await updateSettings({ timezone: 'Europe/Istanbul' }, T);
  return saveDevice();
}

async function recognition(noteId: string): Promise<Card> {
  return (await db.cards.where('note_id').equals(noteId).toArray()).find(
    (c) => c.card_type === 'recognition',
  )!;
}

/** A device with one studied card and two practice answers on it. */
async function practisedDevice(deviceId: string): Promise<{ img: DeviceImage; cardId: string }> {
  await newDevice(deviceId);
  const r = await addNoteWithSenses({ term: 'cope', senses: [{ meaning_tr: 'başa çıkmak' }] }, T);
  const card = await recognition(r.note.id);
  await answerCard({ card_id: card.id, rating: Rating.Easy, duration_ms: 1000 }, T + MIN);
  await recordPractice(
    { card_id: card.id, result: 'unknown', mode: 'recent', session_id: 's1', duration_ms: 800 },
    T + 2 * MIN,
  );
  await recordPractice(
    { card_id: card.id, result: 'known', mode: 'recent', session_id: 's1', duration_ms: 700 },
    T + 3 * MIN,
  );
  return { img: await saveDevice(), cardId: card.id };
}

const sync = (server: FakeServer, now: number) => runSync(server, { now: () => now });

let server: FakeServer;
beforeEach(async () => {
  server = new FakeServer(USER);
  await resetDb();
});

describe('practice_logs sync', () => {
  it('reach the server and a second device, which changes no card for them', async () => {
    const { img } = await practisedDevice('dev-a');
    await onDevice(img, async () => {
      await sync(server, T + 5 * MIN);
      expect(await db.outbox.count()).toBe(0);
    });
    expect(
      server
        .rowsOf('practice_logs')
        .map((r) => r.result)
        .sort(),
    ).toEqual(['known', 'unknown']);
    expect(server.rowsOf('practice_logs').every((r) => r.user_id === USER)).toBe(true);

    const b = await newDevice('dev-b');
    await onDevice(b, async () => {
      await sync(server, T + 6 * MIN);
      expect(await db.practice_logs.count()).toBe(2);
      // Pulled rows are not queued again, and pulling them recomputed nothing.
      const cardsBefore = await db.cards.toArray();
      const outboxBefore = await db.outbox.count();
      await sync(server, T + 7 * MIN);
      expect(await db.cards.toArray()).toEqual(cardsBefore);
      expect(await db.outbox.count()).toBe(outboxBefore);
      expect(await getMeta(META.serverPractice)).toBe(true);
    });
  });

  it('a repeated push is a no-op (insert-only)', async () => {
    const { img } = await practisedDevice('dev-a');
    await onDevice(img, async () => {
      const queued = (await db.outbox.toArray()).filter((o) => o.table === 'practice_logs');
      await setMeta(META.serverPractice, true);
      await server.pushBatch(queued.map((o) => ({ table: o.table, op: o.op, payload: o.payload })));
      await server.pushBatch(
        queued.map((o) => ({
          table: o.table,
          op: o.op,
          payload: { ...(o.payload as object), result: 'known' },
        })),
      );
    });
    expect(
      server
        .rowsOf('practice_logs')
        .map((r) => r.result)
        .sort(),
    ).toEqual(['known', 'unknown']);
  });

  it('wait in the outbox, without failed attempts, until the server has the table', async () => {
    server.practiceSupported = false;
    const { img } = await practisedDevice('dev-a');
    const after = await onDevice(img, async () => {
      await sync(server, T + 5 * MIN);
      await sync(server, T + 10 * MIN);
      const waiting = await db.outbox.toArray();
      expect(waiting.map((o) => o.table)).toEqual(['practice_logs', 'practice_logs']);
      expect(waiting.every((o) => o.attempts === 0)).toBe(true);
      expect(await stuckOutboxCount()).toBe(0);
      expect(await getMeta(META.serverPractice)).toBeFalsy();
    });
    expect(server.rowsOf('notes')).toHaveLength(1);
    expect(server.rowsOf('practice_logs')).toHaveLength(0);

    // The migration lands: the next sync pulls through v3 and then pushes the logs.
    server.practiceSupported = true;
    await onDevice(after, async () => {
      await sync(server, T + 15 * MIN);
      expect(await db.outbox.count()).toBe(0);
    });
    expect(server.rowsOf('practice_logs')).toHaveLength(2);
  });

  it('a full resync keeps local practice logs', async () => {
    const { img } = await practisedDevice('dev-a');
    await onDevice(img, async () => {
      await sync(server, T + 5 * MIN);
      await setMeta('full_resync_pending', true);
      await sync(server, T + 6 * MIN);
      expect(await db.practice_logs.count()).toBe(2);
    });
  });

  it('guest practice logs are queued when the guest signs in', async () => {
    await newDevice('dev-g', null);
    const r = await addNoteWithSenses({ term: 'cope', senses: [{ meaning_tr: 'başa çıkmak' }] }, T);
    const card = await recognition(r.note.id);
    await answerCard({ card_id: card.id, rating: Rating.Easy, duration_ms: 1000 }, T + MIN);
    await recordPractice(
      { card_id: card.id, result: 'known', mode: 'hard', session_id: 's', duration_ms: 500 },
      T + 2 * MIN,
    );
    await db.outbox.clear(); // a guest never pushes; only adoption queues rows
    await adoptGuestData(USER, T + 3 * MIN);
    expect((await db.outbox.toArray()).filter((o) => o.table === 'practice_logs')).toHaveLength(1);
    await sync(server, T + 4 * MIN);
    expect(server.rowsOf('practice_logs')).toHaveLength(1);
  });
});

describe('practice_logs in backups', () => {
  it('round-trip through export and restore', async () => {
    const { img } = await practisedDevice('dev-a');
    let backup!: Awaited<ReturnType<typeof exportBackup>>;
    await onDevice(img, async () => {
      backup = await exportBackup(T + 10 * MIN);
    });
    expect(backup.schema_version).toBe(3);
    expect(backup.tables.practice_logs).toHaveLength(2);

    await newDevice('dev-r');
    const res = await restoreBackup(JSON.parse(JSON.stringify(backup)), 'merge', T + 11 * MIN);
    expect(res.logsAdded).toBe(1);
    expect((await db.practice_logs.toArray()).map((p) => p.id).sort()).toEqual(
      backup.tables.practice_logs!.map((p) => p.id).sort(),
    );
    // Restored logs are queued for the account.
    expect((await db.outbox.toArray()).filter((o) => o.table === 'practice_logs')).toHaveLength(2);
    // Restoring again adds nothing.
    await restoreBackup(backup, 'merge', T + 12 * MIN);
    expect(await db.practice_logs.count()).toBe(2);
  });
});
