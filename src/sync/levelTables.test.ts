// level_tests and known_terms through the sync engine, backups and account switches
// (FakeServer mirrors supabase/migrations/20261022000500_level_test.sql).
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addNoteWithSenses,
  adoptGuestData,
  db,
  exportBackup,
  getKnownTermKeys,
  getMeta,
  markKnown,
  META,
  restoreBackup,
  saveLevelTest,
  setMeta,
  stuckOutboxCount,
  unmarkKnown,
  updateSettings,
} from '@/data';
import { copyCardsFromOtherAccount, discardLocalData } from '@/data/account';
import { saveText } from '@/data/texts';
import { LEVELS } from '@/domain/levelTest';
import type { CefrLevel } from '@/domain/types';
import { resetDb } from '@/test/db';
import { REGISTRY_RECHECK_MS, runSync } from './engine';
import { FakeServer, onDevice, saveDevice, type DeviceImage } from './testing/fakeServer';

const T = Date.UTC(2026, 9, 21, 9);
const MIN = 60_000;
const USER = 'user-1';

const ratios = Object.fromEntries(LEVELS.map((b, i) => [b, Math.max(0, 1 - i * 0.2)])) as Record<CefrLevel, number>;
const testInput = {
  items: [
    { w: 'cope', band: 'B1' as const, pseudo: false, answer: 'yes' as const },
    { w: 'plinder', band: null, pseudo: true, answer: 'no' as const },
  ],
  level: 'B2' as const,
  ratios,
  reliable: true,
  falseAlarm: 0,
  vocabEstimate: 4200,
  bankVersion: 'bank-test',
  durationMs: 240_000,
};

async function newDevice(deviceId: string, userId: string | null = USER): Promise<DeviceImage> {
  await resetDb();
  await db.transaction('rw', db.meta, async () => {
    await setMeta(META.deviceId, deviceId);
    if (userId) await setMeta(META.userId, userId);
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

describe('level tables sync', () => {
  it('a test, its level and known words reach a second device; a removed word stays removed', async () => {
    const a = await newDevice('dev-a');
    const afterA = await onDevice(a, async () => {
      await saveLevelTest(testInput, T + MIN);
      await markKnown('give up', 'preview', T + 2 * MIN);
      await sync(server, T + 3 * MIN);
      expect(await db.outbox.count()).toBe(0);
    });
    expect(server.rowsOf('level_tests')).toHaveLength(1);
    expect(server.rowsOf('known_terms').map((r) => r.term_norm).sort()).toEqual(['cope', 'give up']);

    const b = await newDevice('dev-b');
    const afterB = await onDevice(b, async () => {
      await sync(server, T + 4 * MIN);
      expect(await db.level_tests.count()).toBe(1);
      expect(await getKnownTermKeys()).toEqual(new Set(['cope', 'give up']));
      expect((await db.settings.get('settings'))?.level).toBe('B2');
      await unmarkKnown('cope', T + 5 * MIN);
      await sync(server, T + 6 * MIN);
    });
    void afterB;
    await onDevice(afterA, async () => {
      await sync(server, T + 7 * MIN);
      expect(await getKnownTermKeys()).toEqual(new Set(['give up']));
    });
  });

  it('level tests are insert-only on the server', async () => {
    const a = await newDevice('dev-a');
    await onDevice(a, async () => {
      const t = await saveLevelTest(testInput, T);
      const res = await server.pushBatch([{ table: 'level_tests', op: 'delete', payload: t }]);
      expect(res.rejected).toHaveLength(1);
      await server.pushBatch([{ table: 'level_tests', op: 'upsert', payload: t }]);
      await server.pushBatch([{ table: 'level_tests', op: 'upsert', payload: { ...t, result_level: 'C2' } }]);
    });
    expect(server.rowsOf('level_tests').map((r) => r.result_level)).toEqual(['B2']);
  });

  it('wait in the outbox, without failed attempts, until the server registry lists them', async () => {
    server.registry.delete('level_tests');
    server.registry.delete('known_terms');
    const a = await newDevice('dev-a');
    const after = await onDevice(a, async () => {
      await addNoteWithSenses({ term: 'cope', senses: [{ meaning_tr: 'başa çıkmak' }] }, T);
      await saveLevelTest(testInput, T + MIN);
      await markKnown('give up', 'manual', T + MIN);
      await sync(server, T + 2 * MIN);
      // Within the recheck interval the registry is not asked again.
      await sync(server, T + 3 * MIN);
      expect(server.calls.registry).toBe(1);
      const waiting = await db.outbox.toArray();
      expect(new Set(waiting.map((o) => o.table))).toEqual(new Set(['level_tests', 'known_terms']));
      expect(waiting.every((o) => o.attempts === 0)).toBe(true);
      expect(await stuckOutboxCount()).toBe(0);
    });
    expect(server.rowsOf('notes')).toHaveLength(1);
    expect(server.rowsOf('level_tests')).toHaveLength(0);

    // The migration lands; after the recheck interval the rows go.
    server.registry.add('level_tests');
    server.registry.add('known_terms');
    await onDevice(after, async () => {
      await sync(server, T + 3 * MIN + REGISTRY_RECHECK_MS);
      expect(await db.outbox.count()).toBe(0);
      expect(await getMeta<string[]>(META.serverTables)).toContain('level_tests');
    });
    expect(server.rowsOf('level_tests')).toHaveLength(1);
    expect(server.rowsOf('known_terms')).toHaveLength(1);
  });

  it('a table that starts waiting after a registry check is asked about at once (v0.5.1)', async () => {
    server.registry.delete('known_terms');
    const a = await newDevice('dev-a');
    await onDevice(a, async () => {
      // A saved text waits for the registry and is confirmed on the first check …
      await saveText({ kind: 'paste', title: 'A text', body: 'The cat sat on the mat.' }, T);
      await sync(server, T + MIN);
      expect(server.calls.registry).toBe(1);
      // … then a known word waits: its table was not part of that check, so it is asked now,
      // not ten minutes later.
      server.registry.add('known_terms');
      await markKnown('give up', 'manual', T + 2 * MIN);
      await sync(server, T + 3 * MIN);
      expect(server.calls.registry).toBe(2);
      expect(await db.outbox.count()).toBe(0);
    });
    expect(server.rowsOf('known_terms')).toHaveLength(1);
  });

  it('a guest’s tests and known words go with the guest data to the account', async () => {
    const g = await newDevice('dev-g', null);
    await onDevice(g, async () => {
      await saveLevelTest(testInput, T);
      await markKnown('give up', 'manual', T);
      await db.outbox.clear();
      await adoptGuestData(USER, T + MIN);
      await sync(server, T + 2 * MIN);
    });
    expect(server.rowsOf('level_tests')).toHaveLength(1);
    expect(server.rowsOf('known_terms').map((r) => r.user_id)).toEqual([USER, USER]);
  });

  it('never moves to another account (decision 0009): copying cards leaves tests and known words behind', async () => {
    const a = await newDevice('dev-a', 'other-user');
    await onDevice(a, async () => {
      await addNoteWithSenses({ term: 'cope', senses: [{ meaning_tr: 'başa çıkmak' }] }, T);
      await saveLevelTest(testInput, T + MIN);
      await markKnown('give up', 'manual', T + MIN);
      await copyCardsFromOtherAccount(USER, { rows: [], nextSeq: 0 }, T + 2 * MIN);
      expect(await db.notes.count()).toBe(1);
      expect(await db.level_tests.count()).toBe(0);
      expect(await db.known_terms.count()).toBe(0);
      expect((await db.settings.get('settings'))?.level ?? 'B1').toBe('B1');
      expect((await db.outbox.toArray()).some((o) => o.table === 'level_tests' || o.table === 'known_terms')).toBe(false);
      await addNoteWithSenses({ term: 'x', senses: [{ meaning_tr: 'y' }] }, T + 3 * MIN);
      await discardLocalData(USER);
      expect(await db.level_tests.count()).toBe(0);
    });
  });
});

describe('backups', () => {
  it('round-trip level tests and known words; an older file without them keeps the local ones', async () => {
    await newDevice('dev-a');
    await saveLevelTest(testInput, T);
    await markKnown('give up', 'manual', T);
    const backup = await exportBackup(T + MIN);
    expect(backup.tables.level_tests).toHaveLength(1);
    expect(backup.tables.known_terms).toHaveLength(2);

    await resetDb();
    await restoreBackup(JSON.stringify(backup), 'merge', T + 2 * MIN);
    expect(await db.level_tests.count()).toBe(1);
    expect(await getKnownTermKeys()).toEqual(new Set(['cope', 'give up']));

    // An older file (no level tables): overwrite keeps local known words and tests.
    const { level_tests: _a, known_terms: _b, ...old } = backup.tables;
    const { backupChecksum } = await import('@/domain/backup');
    const oldFile = { ...backup, schema_version: 4, tables: old, checksum: await backupChecksum(old) };
    await restoreBackup(JSON.stringify(oldFile), 'overwrite', T + 3 * MIN);
    expect(await getKnownTermKeys()).toEqual(new Set(['cope', 'give up']));
    expect(await db.level_tests.count()).toBe(1);
  });
});
