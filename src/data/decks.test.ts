// Smart decks and bulk tags on the local database.
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { LIMITS } from '../domain/limits';
import { Rating } from '../domain/types';
import { resetDb } from '../test/db';
import { addNoteWithSenses, answerCard, setSuspended } from './actions';
import { PULL_BACKFILL_KEY } from './backfill';
import { db, EngDb } from './db';
import {
  countDeckFilter,
  createDeck,
  deleteDeck,
  deleteTag,
  getDeckNoteIds,
  getDeckSummaries,
  listDecks,
  listTags,
  moveDeck,
  renameTag,
  setNoteTags,
  updateDeck,
} from './decks';
import { backupChecksum } from '../domain/backup';
import { ActionError } from './errors';
import { exportBackup, restoreBackup } from './maintenance';
import { getPracticeCards, getPracticeSourceCounts } from './practice';
import { updateSettings } from './settings';

const T = Date.UTC(2026, 9, 21, 9);
const DAY = 86_400_000;

beforeEach(async () => {
  await resetDb();
  await updateSettings({ timezone: 'Europe/Istanbul' }, T - 30 * DAY);
});

async function word(term: string, tags: string[] = [], at = T - 20 * DAY): Promise<string> {
  const r = await addNoteWithSenses({ term, tags, senses: [{ meaning_tr: `${term} anlamı` }] }, at);
  return r.note.id;
}

async function outboxFor(table: string): Promise<number> {
  return db.outbox.filter((o) => o.table === table).count();
}

describe('decks', () => {
  it('create, rename, re-filter and delete go through the outbox', async () => {
    const a = await createDeck({ name: '  İş   kelimeleri ', filter: { v: 1, tags: ['iş'] } }, T);
    const b = await createDeck({ name: 'Yeni', filter: { v: 1, states: ['new'] } }, T + 1);
    expect(a).toMatchObject({ name: 'İş kelimeleri', sort: 1, filter: { v: 1, tags: ['iş'] }, deleted_at: null });
    expect(b.sort).toBe(2);
    await updateDeck(a.id, { name: 'Ofis', filter: { v: 1, tags: ['iş', 'ofis'], tagMode: 'all' } }, T + 2);
    await deleteDeck(b.id, T + 3);
    expect((await listDecks()).map((d) => [d.name, d.filter])).toEqual([
      ['Ofis', { v: 1, tags: ['iş', 'ofis'], tagMode: 'all' }],
    ]);
    expect((await db.decks.get(b.id))?.deleted_at).toBe(T + 3);
    expect(await outboxFor('decks')).toBe(4);
    await expect(createDeck({ name: '  ', filter: { v: 1 } }, T)).rejects.toBeInstanceOf(ActionError);
    await expect(updateDeck(b.id, { name: 'x' }, T)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('keeps a filter from a newer app version unless a new one is given', async () => {
    const d = await createDeck({ name: 'D', filter: { v: 1 } }, T);
    await db.decks.update(d.id, { filter: { v: 2, mood: 'calm' } });
    await updateDeck(d.id, { name: 'Renamed' }, T + 1);
    expect((await db.decks.get(d.id))?.filter).toEqual({ v: 2, mood: 'calm' });
    const [s] = await getDeckSummaries(T + 2);
    expect(s).toMatchObject({ filter: null, count: null });
    expect(await getDeckNoteIds(d.id, T + 2)).toBeNull();
  });

  it('moves decks up and down, renumbering 1..n', async () => {
    const ids = [];
    for (const name of ['A', 'B', 'C']) ids.push((await createDeck({ name, filter: { v: 1 } }, T)).id);
    await moveDeck(ids[2]!, -1, T + 1);
    expect((await listDecks()).map((d) => [d.name, d.sort])).toEqual([['A', 1], ['C', 2], ['B', 3]]);
    await moveDeck(ids[0]!, -1, T + 2); // already first: nothing
    expect((await listDecks()).map((d) => d.name)).toEqual(['A', 'C', 'B']);
  });

  it('evaluates over live notes: tags, status, suspended', async () => {
    const office = await word('desk', ['İş']);
    const travel = await word('ticket', ['seyahat']);
    const both = await word('meeting', ['iş', 'seyahat']);
    await word('apple');
    await setSuspended({ note_id: travel }, true, T - DAY);
    expect(await countDeckFilter({ v: 1, tags: ['iş'] }, T)).toBe(2);
    expect(await countDeckFilter({ v: 1, tags: ['iş', 'seyahat'], tagMode: 'all' }, T)).toBe(1);
    expect(await countDeckFilter({ v: 1, states: ['suspended'] }, T)).toBe(1);
    expect(await countDeckFilter({ v: 1, states: ['new'] }, T)).toBe(3);
    expect(await countDeckFilter({ v: 1, addedWithinDays: 7 }, T)).toBe(0);
    const d = await createDeck({ name: 'İş', filter: { v: 1, tags: ['İŞ'] } }, T);
    expect(await getDeckNoteIds(d.id, T)).toEqual(new Set([office, both]));
  });
});

describe('bulk tags', () => {
  it('adds and removes on many notes in one transaction, one outbox row per changed note', async () => {
    const ids = [await word('a', ['İş']), await word('b'), await word('c', ['spor'])];
    await db.outbox.clear();
    const r = await setNoteTags(ids, { add: ['iş', ' yeni '] }, T);
    expect(r).toEqual({ changed: 3, full: 0 });
    expect((await db.notes.bulkGet(ids)).map((n) => n?.tags)).toEqual([
      ['İş', 'yeni'],
      ['iş', 'yeni'],
      ['spor', 'iş', 'yeni'],
    ]);
    expect(await outboxFor('notes')).toBe(3);
    // Nothing to change: nothing written.
    expect(await setNoteTags(ids, { add: ['YENİ'] }, T + 1)).toEqual({ changed: 0, full: 0 });
    expect(await outboxFor('notes')).toBe(3);
    expect(await setNoteTags(ids, { remove: ['İŞ'] }, T + 2)).toEqual({ changed: 3, full: 0 });
    expect((await listTags()).map((x) => [x.tag, x.count])).toEqual([['yeni', 3], ['spor', 1]]);
  });

  it('leaves notes that would exceed the tag limit unchanged and reports them', async () => {
    const full = Array.from({ length: LIMITS.tags }, (_, i) => `t${i}`);
    const a = await word('a', full);
    const b = await word('b');
    expect(await setNoteTags([a, b], { add: ['extra'] }, T)).toEqual({ changed: 1, full: 1 });
    expect((await db.notes.get(a))?.tags).toEqual(full);
  });

  it('skips deleted notes', async () => {
    const a = await word('a');
    await db.notes.update(a, { deleted_at: T - 1 });
    expect(await setNoteTags([a, 'missing'], { add: ['x'] }, T)).toEqual({ changed: 0, full: 0 });
  });

  it('renames a tag on notes and in the decks that use it; delete keeps decks', async () => {
    const a = await word('a', ['İş', 'spor']);
    const b = await word('b', ['iş', 'çalışma']);
    const d = await createDeck({ name: 'D', filter: { v: 1, tags: ['iş', 'spor'] } }, T);
    expect(await renameTag('iş', 'Çalışma', T + 1)).toBe(2);
    expect((await db.notes.get(a))?.tags).toEqual(['Çalışma', 'spor']);
    expect((await db.notes.get(b))?.tags).toEqual(['Çalışma']);
    expect((await db.decks.get(d.id))?.filter).toEqual({ v: 1, tags: ['Çalışma', 'spor'] });
    expect(await deleteTag('spor', T + 2)).toBe(1);
    expect((await db.decks.get(d.id))?.filter).toEqual({ v: 1, tags: ['Çalışma', 'spor'] });
    await expect(renameTag('x', '  ', T)).rejects.toBeInstanceOf(ActionError);
  });
});

describe('practice from a deck', () => {
  it('lists decks with practicable notes and draws only their cards', async () => {
    const ids = [await word('desk', ['iş']), await word('pen', ['iş']), await word('sea')];
    for (const id of ids) {
      for (const c of await db.cards.where('note_id').equals(id).toArray())
        await answerCard({ card_id: c.id, rating: Rating.Easy, duration_ms: 2000 }, T - 10 * DAY);
    }
    const deck = await createDeck({ name: 'İş', filter: { v: 1, tags: ['iş'] } }, T);
    await createDeck({ name: 'Boş', filter: { v: 1, tags: ['yok'] } }, T);
    const counts = await getPracticeSourceCounts(T);
    expect(counts.decks).toEqual([{ id: deck.id, name: 'İş', count: 2 }]);
    const cards = await getPracticeCards({ source: 'deck', deckId: deck.id }, { size: 20, seed: 's' }, T);
    expect(cards.length).toBeGreaterThan(0);
    const notes = new Set((await db.cards.bulkGet(cards)).map((c) => c!.note_id));
    expect([...notes].sort()).toEqual([ids[0], ids[1]].sort());
    expect(await getPracticeCards({ source: 'deck', deckId: 'gone' }, { size: 20, seed: 's' }, T)).toEqual([]);
  });
});

describe('Dexie v8 upgrade', () => {
  async function v7(name: string, cursor: number | null): Promise<void> {
    const old = new Dexie(name);
    old.version(7).stores({ meta: 'key', notes: 'id' });
    await old.open();
    if (cursor !== null) await old.table('meta').put({ key: 'sync_cursor', value: cursor });
    old.close();
  }

  it('asks for a one-time decks re-pull only on a device that has pulled before', async () => {
    await v7('bf-pulled', 42);
    const d = new EngDb('bf-pulled');
    await d.open();
    expect((await d.meta.get(PULL_BACKFILL_KEY))?.value).toEqual(['decks']);
    d.close();
    await d.delete();

    await v7('bf-fresh', null);
    const f = new EngDb('bf-fresh');
    await f.open();
    expect(await f.meta.get(PULL_BACKFILL_KEY)).toBeUndefined();
    f.close();
    await f.delete();
  });
});

describe('backups (format 4)', () => {
  it('carry decks and restore them; an older file without decks keeps the local ones', async () => {
    await word('desk', ['iş']);
    const d = await createDeck({ name: 'İş', filter: { v: 1, tags: ['iş'] } }, T);
    const file = await exportBackup(T + 1);
    expect(file.schema_version).toBe(4);
    expect(file.tables.decks).toHaveLength(1);

    await resetDb();
    await restoreBackup(JSON.stringify(file), 'merge', T + 2);
    expect((await listDecks()).map((x) => [x.id, x.name])).toEqual([[d.id, 'İş']]);

    // A version 3 file (no decks) restored over this device: decks are not soft-deleted.
    const { decks: _drop, ...v3tables } = file.tables;
    const v3 = { ...file, schema_version: 3, tables: v3tables, checksum: await backupChecksum(v3tables) };
    await restoreBackup(JSON.stringify(v3), 'overwrite', T + 3);
    expect((await listDecks()).map((x) => x.name)).toEqual(['İş']);
  });
});
