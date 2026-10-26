// Outbox compaction (decision 0025) never changes what sync does: the same device synced
// with and without compaction leaves the server and the device in the same state.
import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addNoteWithSenses,
  answerCard,
  db,
  exportBackup,
  restoreBackup,
  setMeta,
  META,
  undoAnswer,
  updateSettings,
} from '@/data';
import { claimLocalData } from '@/data/account';
import { editNote, softDeleteNote } from '@/data/actions';
import type { BackupFile } from '@/domain/backup';
import type { Card, OutboxRow, RatingValue } from '@/domain/types';
import { resetDb } from '@/test/db';
import { runSync, type SyncTransport } from './engine';
import { FakeServer, loadDevice, saveDevice, type DeviceImage } from './testing/fakeServer';

// Compaction can be switched off to get the "without compaction" twin of a run (the app
// compacts inside restoreBackup and adoptGuestData too).
const ctl = vi.hoisted(() => ({ off: false, real: null as null | typeof import('@/data/outbox') }));
vi.mock('@/data/outbox', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/data/outbox')>();
  ctl.real = real;
  return {
    ...real,
    compactOutbox: (opts?: { guest?: boolean }) => (ctl.off ? Promise.resolve(0) : real.compactOutbox(opts)),
    compactGuestOutbox: () => (ctl.off ? Promise.resolve(0) : real.compactGuestOutbox()),
  };
});
const compactOutbox = (opts?: { guest?: boolean }) => ctl.real!.compactOutbox(opts);
const compactGuestOutbox = () => ctl.real!.compactGuestOutbox();

const T = Date.UTC(2026, 9, 21, 9);
const MIN = 60_000;
const USER = 'user-1';

type Op =
  | { k: 'add'; term: string }
  | { k: 'tag'; i: number; tag: string }
  | { k: 'del'; i: number }
  | { k: 'answer'; i: number; rating: RatingValue }
  | { k: 'undo' }
  | { k: 'backup' }
  | { k: 'restore' }
  | { k: 'compact' };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 3, arbitrary: fc.record({ k: fc.constant('add' as const), term: fc.constantFrom('bank', 'shore', 'give up', 'run', 'cope', 'thrive') }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant('tag' as const), i: fc.nat(9), tag: fc.constantFrom('a', 'b', 'c') }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant('del' as const), i: fc.nat(9) }) },
  { weight: 4, arbitrary: fc.record({ k: fc.constant('answer' as const), i: fc.nat(9), rating: fc.constantFrom<RatingValue>(1, 2, 3, 4) }) },
  { weight: 1, arbitrary: fc.constant({ k: 'undo' as const }) },
  { weight: 1, arbitrary: fc.constant({ k: 'backup' as const }) },
  { weight: 1, arbitrary: fc.constant({ k: 'restore' as const }) },
  { weight: 2, arbitrary: fc.constant({ k: 'compact' as const }) },
);

async function newDevice(userId: string | null = null): Promise<void> {
  await resetDb();
  await db.transaction('rw', db.meta, async () => {
    await setMeta(META.deviceId, 'dev-a');
    if (userId) await setMeta(META.userId, userId);
  });
  await updateSettings({ timezone: 'Europe/Istanbul' }, T);
}

async function liveNoteIds(): Promise<string[]> {
  return (await db.notes.orderBy('id').toArray()).filter((n) => n.deleted_at === null).map((n) => n.id);
}

/**
 * Run `ops` as a guest with the app's own compaction switched off; 'compact' (and the end of
 * each restore, as the app does) compacts the guest outbox explicitly. Every outbox row ever
 * written is collected before, so the caller gets the outbox as it would be without any
 * compaction too (a guest never pushes: nothing else removes or changes outbox rows).
 */
async function runGuest(ops: Op[]): Promise<{ compacted: DeviceImage; uncompacted: DeviceImage; t: number }> {
  let t = T;
  const written = new Map<number, OutboxRow>();
  const compactNow = async () => {
    for (const r of await db.outbox.toArray()) written.set(r.seq!, r);
    await compactGuestOutbox();
  };
  let backup: BackupFile | null = null;
  const answered: string[] = [];
  ctl.off = true;
  try {
    for (const op of ops) {
      t += MIN;
      const notes = await liveNoteIds();
      const pick = (i: number) => (notes.length ? notes[i % notes.length]! : null);
      switch (op.k) {
        case 'add':
          await addNoteWithSenses({ term: op.term, senses: [{ meaning_tr: `${op.term} tr` }] }, t);
          break;
        case 'tag': {
          const id = pick(op.i);
          if (id) await editNote(id, { tags: [op.tag] }, t);
          break;
        }
        case 'del': {
          const id = pick(op.i);
          if (id) await softDeleteNote(id, t);
          break;
        }
        case 'answer': {
          const id = pick(op.i);
          const card = id
            ? (await db.cards.where('note_id').equals(id).toArray()).find((c: Card) => c.card_type === 'recognition' && c.deleted_at === null)
            : undefined;
          if (card) answered.push((await answerCard({ card_id: card.id, rating: op.rating, duration_ms: 1000 }, t)).log.id);
          break;
        }
        case 'undo': {
          const id = answered.pop();
          if (id) await undoAnswer(id, t).catch(() => undefined); // no longer undoable: skip
          break;
        }
        case 'backup':
          backup = await exportBackup(t);
          break;
        case 'restore':
          if (backup) {
            await restoreBackup(backup, 'overwrite', t);
            await compactNow();
          }
          break;
        case 'compact':
          await compactNow();
          break;
      }
    }
  } finally {
    ctl.off = false;
  }
  for (const r of await db.outbox.toArray()) written.set(r.seq!, r);
  const compacted = await saveDevice();
  const uncompacted = { ...compacted, outbox: [...written.values()].sort((a, b) => a.seq! - b.seq!) };
  return { compacted, uncompacted, t };
}

const serverRows = (s: FakeServer) =>
  [...s.rows.values()]
    .map((r) => ({ table: r.table, row: r.row }))
    .sort((a, b) => (`${a.table}:${a.row.id}` < `${b.table}:${b.row.id}` ? -1 : 1));

/** Sign in on this device image (first sign-in), sync, return the server and the device. */
async function signInAndSync(img: DeviceImage, now: number, compaction: boolean) {
  const server = new FakeServer(USER);
  await loadDevice(img);
  ctl.off = !compaction;
  try {
    await claimLocalData(USER, now);
    await runSync(server, { now: () => now + MIN });
  } finally {
    ctl.off = false;
  }
  expect(await db.outbox.count()).toBe(0);
  const device = await saveDevice();
  delete device.outbox;
  delete device.meta; // cursors are server sequence numbers; the rows are compared below
  return { rows: serverRows(server), device };
}

/** An independent copy of a FakeServer's stored rows and sequence. */
function forkServer(s: FakeServer): FakeServer {
  const copy = new FakeServer(USER);
  for (const [k, v] of s.rows) copy.rows.set(k, structuredClone(v));
  (copy as unknown as { seq: number }).seq = (s as unknown as { seq: number }).seq;
  return copy;
}

beforeEach(async () => {
  ctl.off = false;
  await resetDb();
});

describe('guest outbox compaction', () => {
  it('property: first sign-in syncs the same with and without compaction', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { minLength: 1, maxLength: 25 }), async (ops) => {
        await newDevice();
        const { compacted, uncompacted, t } = await runGuest(ops);
        if (ops.at(-1)?.k === 'compact') {
          // One entry per mutable row, none for logs (they are queued again at sign-in).
          const kept = compacted.outbox as OutboxRow[];
          expect(new Set(kept.map((r) => `${r.table}:${r.row_id}`)).size).toBe(kept.length);
          expect(kept.filter((r) => r.table === 'review_logs')).toHaveLength(0);
        }

        const a = await signInAndSync(uncompacted, t + MIN, false);
        const b = await signInAndSync(compacted, t + MIN, true);
        expect(b.rows).toEqual(a.rows);
        expect(b.device).toEqual(a.device);

        // Nothing lost: every local row is on the server with the same HLC, tombstones too.
        const server = new Map(b.rows.map((r) => [`${r.table}:${r.row.id}`, r.row]));
        for (const table of ['notes', 'senses', 'cards', 'settings', 'review_logs'] as const) {
          for (const row of b.device[table] as { id: string; hlc: string; deleted_at?: number | null }[]) {
            const remote = server.get(`${table}:${row.id}`);
            expect(remote, `${table}:${row.id}`).toBeDefined();
            expect(remote!.hlc).toBe(row.hlc);
            if (table !== 'review_logs') expect(remote!.deleted_at ?? null).toBe(row.deleted_at ?? null);
          }
        }
      }),
      { numRuns: 15 },
    );
  }, 180_000);

  it('a long guest history compacts to one entry per row', async () => {
    await newDevice();
    let t = T;
    for (let i = 0; i < 10; i++) await addNoteWithSenses({ term: `word${i}`, senses: [{ meaning_tr: `kelime${i}` }] }, (t += MIN));
    const recognition = await db.cards.where('card_type').equals('recognition').toArray();
    for (let i = 0; i < 300; i++) {
      await answerCard({ card_id: recognition[i % recognition.length]!.id, rating: 3, duration_ms: 1000 }, (t += 10 * MIN));
    }
    const before = await db.outbox.count();
    await compactGuestOutbox();
    const rows =
      (await db.notes.count()) +
      (await db.senses.count()) +
      (await db.cards.count()) +
      (await db.settings.count()) +
      (await db.encounters.count()); // one review encounter row per word and day (decision 0043)
    expect(before).toBeGreaterThan(600);
    expect(await db.outbox.count()).toBe(rows);
  }, 120_000);

  it('once an account is linked, compaction keeps logs and drops only covered entries', async () => {
    await newDevice(USER);
    const a = await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] }, T);
    const card = (await db.cards.where('note_id').equals(a.note.id).toArray()).find((c) => c.card_type === 'recognition')!;
    await answerCard({ card_id: card.id, rating: 3, duration_ms: 1000 }, T + MIN);
    await editNote(a.note.id, { tags: ['x'] }, T + 2 * MIN);
    expect(await compactGuestOutbox()).toBe(2); // the note's and the card's older entries
    const left = await db.outbox.toArray();
    expect(left.filter((r) => r.table === 'review_logs')).toHaveLength(1);
    expect(left.find((r) => r.table === 'notes')!.payload).toEqual(await db.notes.get(a.note.id));
  });
});

describe('compaction of a signed-in outbox', () => {
  /** Linked device: a rejected row in backoff, a tombstone, several edits per row. */
  async function linkedDevice(): Promise<{ img: DeviceImage; server: FakeServer }> {
    const server = new FakeServer(USER);
    await newDevice(USER);
    const a = await addNoteWithSenses({ term: 'bank', senses: [{ meaning_tr: 'banka' }] }, T);
    const b = await addNoteWithSenses({ term: 'shore', senses: [{ meaning_tr: 'kıyı' }] }, T);
    server.faults.rejectIds = new Set([a.note.id]);
    await runSync(server, { now: () => T + MIN });
    server.faults.rejectIds = undefined;
    // Within the 5 s backoff of the rejected row.
    await editNote(a.note.id, { tags: ['x'] }, T + MIN + 1000);
    await editNote(a.note.id, { tags: ['y'] }, T + MIN + 2000);
    await editNote(b.note.id, { tags: ['z'] }, T + MIN + 2000);
    await softDeleteNote(b.note.id, T + MIN + 3000);
    return { img: await saveDevice(), server };
  }

  it('keeps the backoff of a failed row and syncs the same as without compaction', async () => {
    const { img, server } = await linkedDevice();
    const results = [];
    for (const compact of [false, true]) {
      const s = forkServer(server);
      await loadDevice(img);
      if (compact) {
        const before = await db.outbox.toArray();
        const failed = before.find((r) => r.attempts > 0)!;
        const group = before.filter((r) => r.table === failed.table && r.row_id === failed.row_id);
        expect(group.length).toBeGreaterThan(1);
        expect(await compactOutbox()).toBeGreaterThan(0);
        const kept = (await db.outbox.toArray()).filter((r) => r.table === failed.table && r.row_id === failed.row_id);
        expect(kept).toHaveLength(1);
        expect(kept[0]).toMatchObject({
          seq: Math.max(...group.map((r) => r.seq!)),
          attempts: Math.max(...group.map((r) => r.attempts)),
          next_attempt_at: Math.max(...group.map((r) => r.next_attempt_at)),
        });
      }
      // Before the backoff ends the failed row waits; a forced run sends it.
      await runSync(s, { now: () => T + MIN + 4000 });
      const waiting = [...new Set((await db.outbox.toArray()).map((r) => `${r.table}:${r.row_id}`))].sort();
      const midway = serverRows(s);
      await runSync(s, { now: () => T + 2 * MIN, force: true });
      results.push({ waiting, midway, rows: serverRows(s), outbox: await db.outbox.count() });
    }
    expect(results[0]!.waiting.length).toBeGreaterThan(0);
    expect(results[1]).toEqual(results[0]);
    expect(results[1]!.outbox).toBe(0);
  });

  it('is safe while a push is in flight', async () => {
    const { img, server } = await linkedDevice();
    const results = [];
    for (const compact of [false, true]) {
      const s = forkServer(server);
      await loadDevice(img);
      const note = (await db.notes.toArray()).find((n) => n.term === 'bank')!;
      let first = true;
      const transport: SyncTransport = {
        pullChanges: s.pullChanges.bind(s),
        pullLexicon: s.pullLexicon.bind(s),
        getLexiconSenses: s.getLexiconSenses.bind(s),
        pullLexiconExamples: s.pullLexiconExamples.bind(s),
        listSyncTables: s.listSyncTables.bind(s),
        pushBatch: async (items) => {
          if (first) {
            first = false;
            // A write lands between taking the batch and its ack, then compaction runs.
            await editNote(note.id, { tags: ['late'] }, T + 6 * MIN);
            if (compact) await compactOutbox();
          }
          return s.pushBatch(items);
        },
      };
      await runSync(transport, { now: () => T + 7 * MIN, force: true });
      results.push({ rows: serverRows(s), outbox: await db.outbox.count(), tags: (await db.notes.get(note.id))!.tags });
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[0]!.tags).toEqual(['late']);
    expect(results[0]!.outbox).toBe(0);
  });
});
