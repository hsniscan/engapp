// Example sentences through the sync engine: content_feedback / user_content sync per user
// (FakeServer mirrors 20261022000100_examples.sql), lexicon_examples come down the
// examples cursor, and content rows wait for a server that has the tables.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addNoteWithSenses,
  db,
  getMeta,
  getSenseExamples,
  META,
  saveExampleEdit,
  setExampleVerdict,
  setMeta,
  stuckOutboxCount,
  updateSettings,
} from '@/data';
import type { LexiconExample } from '@/domain/types';
import { resetDb } from '@/test/db';
import { runSync } from './engine';
import { FakeServer, onDevice, saveDevice, type DeviceImage } from './testing/fakeServer';

const T = Date.UTC(2026, 9, 22, 9);
const MIN = 60_000;

const ex = (p: Partial<LexiconExample> & { id: string }): LexiconExample => ({
  sense_id: 'ls-cope',
  context: 'daily',
  level_band: 'B1',
  text_en: 'We had to cope with the delay.',
  span: [10, 14],
  translations: { tr: 'Gecikmeyle başa çıkmak zorunda kaldık.' },
  status: 'active',
  updated_at: 1,
  ...p,
});

async function newDevice(deviceId: string): Promise<DeviceImage> {
  await resetDb();
  await db.transaction('rw', db.meta, async () => {
    await setMeta(META.deviceId, deviceId);
    await setMeta(META.userId, 'user-1');
  });
  await updateSettings({ timezone: 'Europe/Istanbul' }, T);
  return saveDevice();
}

const sync = (server: FakeServer, now: number) => runSync(server, { now: () => now });

beforeEach(resetDb);

describe('example sentences and sync', () => {
  it('pulls the sentences of the user’s lexicon senses, and drops retired ones', async () => {
    const server = new FakeServer();
    server.addExample(ex({ id: 'e1' }));
    server.addExample(ex({ id: 'other', sense_id: 'ls-other' }));
    let a = await newDevice('A');
    a = await onDevice(a, async () => {
      await addNoteWithSenses({ term: 'cope', senses: [{ meaning_tr: 'başa çıkmak', lexicon_sense_id: 'ls-cope' }] }, T);
      await sync(server, T + MIN);
      expect((await db.lexicon_examples.toArray()).map((e) => e.id)).toEqual(['e1']);
      expect(await getMeta(META.serverExamples)).toBe(true);
      expect(await getMeta<number>(META.lexiconExamplesCursor)).toBeGreaterThan(0);

      server.addExample(ex({ id: 'e1', status: 'retired' }));
      await sync(server, T + 2 * MIN);
      expect(await db.lexicon_examples.count()).toBe(0);
    });
  });

  it('likes, rejections and edits reach the other device; un-liking syncs as a tombstone', async () => {
    const server = new FakeServer();
    server.addExample(ex({ id: 'e1' }));
    server.addExample(ex({ id: 'e2', text_en: 'She copes well.', span: [4, 9] }));
    let a = await newDevice('A');
    let b = await newDevice('B');
    a = await onDevice(a, async () => {
      await addNoteWithSenses({ term: 'cope', senses: [{ meaning_tr: 'başa çıkmak', lexicon_sense_id: 'ls-cope' }] }, T);
      await sync(server, T + MIN); // learns the server has the tables
      await setExampleVerdict('e1', 'like', T + 2 * MIN);
      await setExampleVerdict('e2', 'reject', T + 2 * MIN);
      await saveExampleEdit('e1', 'I had to cope with the delay.', {}, T + 2 * MIN);
      await sync(server, T + 3 * MIN);
      expect(await db.outbox.count()).toBe(0);
    });
    expect(server.rowsOf('content_feedback')).toHaveLength(2);
    expect(server.rowsOf('user_content')).toHaveLength(1);

    b = await onDevice(b, async () => {
      await sync(server, T + 4 * MIN);
      const view = await getSenseExamples('ls-cope', T + 4 * MIN);
      const items = view.examples.byContext.get('daily')!;
      expect(items.map((i) => [i.id, i.verdict, i.text])).toEqual([['e1', 'like', 'I had to cope with the delay.']]);
      await setExampleVerdict('e1', null, T + 5 * MIN);
      await sync(server, T + 5 * MIN);
    });

    a = await onDevice(a, async () => {
      await sync(server, T + 6 * MIN);
      const items = (await getSenseExamples('ls-cope', T)).examples.byContext.get('daily')!;
      expect(items[0]!.verdict).toBeNull();
    });
  });

  it('the same verdict written on two devices is one row (deterministic id, last writer wins)', async () => {
    const server = new FakeServer();
    server.addExample(ex({ id: 'e1' }));
    let a = await newDevice('A');
    let b = await newDevice('B');
    for (const [img, verdict, at] of [
      [a, 'like', T + MIN],
      [b, 'skip', T + 2 * MIN],
    ] as const) {
      const out = await onDevice(img, async () => {
        await addNoteWithSenses({ term: 'cope', senses: [{ meaning_tr: 'başa çıkmak', lexicon_sense_id: 'ls-cope' }] }, at);
        await sync(server, at);
        await setExampleVerdict('e1', verdict, at + 1);
        await sync(server, at + 2);
      });
      if (img === a) a = out;
      else b = out;
    }
    expect(server.rowsOf('content_feedback')).toHaveLength(1);
    expect(server.rowsOf('content_feedback')[0]!.verdict).toBe('skip');
    await onDevice(a, async () => {
      await sync(server, T + 10 * MIN);
      expect((await db.content_feedback.toArray()).map((f) => f.verdict)).toEqual(['skip']);
    });
  });

  it('content rows wait in the outbox for a server that has the tables (no failed attempts)', async () => {
    const server = new FakeServer();
    server.examplesSupported = false;
    let a = await newDevice('A');
    a = await onDevice(a, async () => {
      await addNoteWithSenses({ term: 'cope', senses: [{ meaning_tr: 'başa çıkmak', lexicon_sense_id: 'ls-cope' }] }, T);
      await db.lexicon_examples.put(ex({ id: 'e1' }));
      await setExampleVerdict('e1', 'like', T);
      await sync(server, T + MIN);
      await sync(server, T + 2 * MIN);
      expect(await getMeta(META.serverExamples)).toBeFalsy();
      const waiting = await db.outbox.where('table').equals('content_feedback').toArray();
      expect(waiting).toHaveLength(1);
      expect(waiting[0]!.attempts).toBe(0);
      expect(await stuckOutboxCount()).toBe(0);
      expect(server.rowsOf('notes')).toHaveLength(1);

      server.examplesSupported = true; // the migration is deployed
      await sync(server, T + 3 * MIN);
      expect(await db.outbox.count()).toBe(0);
      expect(server.rowsOf('content_feedback')).toHaveLength(1);
    });
  });

  it('a transport without examples (older test doubles) syncs as before', async () => {
    const server = new FakeServer();
    const legacy = {
      pushBatch: server.pushBatch.bind(server),
      pullChanges: server.pullChanges.bind(server),
      pullLexicon: server.pullLexicon.bind(server),
      getLexiconSenses: server.getLexiconSenses.bind(server),
    };
    await newDevice('A');
    await addNoteWithSenses({ term: 'cope', senses: [{ meaning_tr: 'başa çıkmak' }] }, T);
    const report = await runSync(legacy, { now: () => T + MIN });
    expect(report.pushed).toBeGreaterThan(0);
    expect(server.calls.examplesPull).toBe(0);
  });
});
