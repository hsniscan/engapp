// The reader's synced tables (texts → user_texts, encounters → user_encounters; decision 0043)
// through the sync engine and the data layer. FakeServer mirrors 20261101000100_reader.sql.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addNoteWithSenses,
  answerCard,
  db,
  deleteText,
  getEncounterSummary,
  getSettings,
  getText,
  lastUnfinishedText,
  listTexts,
  META,
  recordReaderEncounters,
  saveReadingProgress,
  saveText,
  setMeta,
  setTextFeedback,
  setTextFinished,
  updateSettings,
} from '@/data';
import { CardState, Rating, type Card } from '@/domain/types';
import { resetDb } from '@/test/db';
import { localTableName, serverTableName } from './api';
import { runSync } from './engine';
import { FakeServer, onDevice, saveDevice, type DeviceImage } from './testing/fakeServer';

const T = Date.UTC(2026, 10, 2, 9);
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

const recognition = async (noteId: string): Promise<Card> =>
  (await db.cards.where('note_id').equals(noteId).toArray()).find(
    (c) => c.card_type === 'recognition',
  )!;

const sync = (server: FakeServer, now: number) => runSync(server, { now: () => now });

let server: FakeServer;
beforeEach(() => {
  server = new FakeServer(USER);
});

describe('texts', () => {
  it('saveText queues the row; progress, finishing and deleting are synced edits', async () => {
    await newDevice('dev-a');
    const id = await saveText(
      { kind: 'paste', title: 'Walk', body: 'I went for a walk. It was nice.' },
      T,
    );
    expect(
      (await db.outbox.toArray()).filter((o) => o.table === 'texts').map((o) => o.row_id),
    ).toEqual([id]);
    expect((await getText(id))!.user_id).toBe(USER);

    await saveReadingProgress(id, 19, 30_000, T + MIN);
    await saveReadingProgress(id, 19, 0, T + 2 * MIN); // nothing changed: no write
    expect(await getText(id)).toMatchObject({
      progress_offset: 19,
      read_ms: 30_000,
      updated_at: T + MIN,
    });
    await saveReadingProgress(id, 9999, 1, T + 3 * MIN);
    expect((await getText(id))!.progress_offset).toBe('I went for a walk. It was nice.'.length);

    expect((await lastUnfinishedText())?.id).toBe(id);
    await setTextFinished(id, true, T + 4 * MIN);
    expect(await lastUnfinishedText()).toBeNull();
    await setTextFinished(id, false, T + 5 * MIN);
    expect(await getText(id)).toMatchObject({ finished_at: null, progress_offset: 0 });

    await deleteText(id, T + 6 * MIN);
    expect(await getText(id)).toBeUndefined();
    expect(await listTexts()).toEqual([]);
    expect((await db.texts.get(id))!.deleted_at).toBe(T + 6 * MIN);
  });

  it('feedback nudges the reading offset once per text and can be changed', async () => {
    await newDevice('dev-a');
    const a = await saveText({ kind: 'paste', title: 'A', body: 'a' }, T);
    const b = await saveText({ kind: 'paste', title: 'B', body: 'b' }, T);
    expect(await setTextFeedback(a, 'hard', T + 1)).toBe(0.1);
    expect(await setTextFeedback(a, 'hard', T + 2)).toBe(0.1);
    expect(await setTextFeedback(b, 'hard', T + 3)).toBe(0.2);
    expect(await setTextFeedback(a, 'easy', T + 4)).toBe(0);
    expect(await setTextFeedback(a, null, T + 5)).toBe(0.1);
    expect((await getSettings(T + 6)).reading_offset).toBe(0.1);
    expect((await getText(a))!.feedback).toBeNull();
    for (let i = 0; i < 20; i++) {
      const id = await saveText({ kind: 'paste', title: `x${i}`, body: 'x' }, T + 10 + i);
      await setTextFeedback(id, 'easy', T + 10 + i);
    }
    expect((await getSettings(T + 100)).reading_offset).toBe(-0.5);
  });

  it('a text read on one device continues on the other; the server names are user_texts / user_encounters', async () => {
    expect(serverTableName('texts')).toBe('user_texts');
    expect(serverTableName('encounters')).toBe('user_encounters');
    expect(localTableName('user_texts')).toBe('texts');
    expect(serverTableName('notes')).toBe('notes');
    const a = await newDevice('dev-a');
    const b = await newDevice('dev-b');
    let id = '';
    await onDevice(a, async () => {
      id = await saveText(
        { kind: 'pdf', title: 'Book', body: 'One. Two. Three.', source_url: 'book.pdf' },
        T,
      );
      await saveReadingProgress(id, 5, 60_000, T + MIN);
      await sync(server, T + 2 * MIN);
      expect(await db.outbox.count()).toBe(0);
    });
    expect(server.rowsOf('texts')).toHaveLength(1);
    await onDevice(b, async () => {
      await sync(server, T + 3 * MIN);
      expect(await getText(id)).toMatchObject({
        title: 'Book',
        progress_offset: 5,
        read_ms: 60_000,
        user_id: USER,
      });
    });
  });

  it('wait in the outbox until the server lists the table', async () => {
    server.registry.delete('texts');
    const a = await newDevice('dev-a');
    await onDevice(a, async () => {
      await saveText({ kind: 'paste', title: 'A', body: 'a' }, T);
      await sync(server, T + MIN);
      expect((await db.outbox.toArray()).map((o) => [o.table, o.attempts])).toEqual([['texts', 0]]);
      server.registry.add('texts');
      await sync(server, T + 12 * MIN);
      expect(await db.outbox.count()).toBe(0);
    });
    expect(server.rowsOf('texts')).toHaveLength(1);
  });
});

describe('encounters', () => {
  it('count a reader opening once per note, however often the screen renders', async () => {
    await newDevice('dev-a');
    const n1 = (
      await addNoteWithSenses({ term: 'cope', senses: [{ meaning_tr: 'başa çıkmak' }] }, T)
    ).note.id;
    const n2 = (
      await addNoteWithSenses({ term: 'thrive', senses: [{ meaning_tr: 'gelişmek' }] }, T)
    ).note.id;
    const text = await saveText(
      { kind: 'paste', title: 'A', body: 'I cope and thrive. I cope.' },
      T,
    );
    expect(await recordReaderEncounters(text, 'open-1', [n1, n2, n1], T + MIN)).toBe(2);
    expect(await recordReaderEncounters(text, 'open-1', [n1, n2], T + 2 * MIN)).toBe(0);
    expect(await recordReaderEncounters(text, 'open-2', [n1], T + 3 * MIN)).toBe(1);
    expect(await getEncounterSummary(n1)).toEqual({ cards: 0, texts: 2, total: 2 });
    expect(await getEncounterSummary(n2)).toEqual({ cards: 0, texts: 1, total: 1 });
    expect(await db.encounters.count()).toBe(2); // one row per note, day, source and device
  });

  it('answering a card counts a review encounter without changing FSRS or the log', async () => {
    await newDevice('dev-a');
    const note = (
      await addNoteWithSenses({ term: 'cope', senses: [{ meaning_tr: 'başa çıkmak' }] }, T)
    ).note.id;
    const card = await recognition(note);
    const r = await answerCard(
      { card_id: card.id, rating: Rating.Good, duration_ms: 1000 },
      T + MIN,
    );
    expect(r.card.state).toBe(CardState.Learning);
    const log = (await db.review_logs.toArray())[0]!;
    expect(Object.keys(log).sort()).not.toContain('encounters');
    expect(await getEncounterSummary(note)).toEqual({ cards: 1, texts: 0, total: 1 });
    await answerCard({ card_id: card.id, rating: Rating.Good, duration_ms: 1000 }, T + 20 * MIN);
    expect(await getEncounterSummary(note)).toEqual({ cards: 2, texts: 0, total: 2 });
  });

  it('two devices counting the same word the same day never overwrite each other', async () => {
    const a = await newDevice('dev-a');
    let note = '';
    let text = '';
    const a2 = await onDevice(a, async () => {
      note = (await addNoteWithSenses({ term: 'cope', senses: [{ meaning_tr: 'başa çıkmak' }] }, T))
        .note.id;
      text = await saveText({ kind: 'paste', title: 'A', body: 'I cope.' }, T);
      await sync(server, T + MIN);
    });
    const b = await newDevice('dev-b');
    const b2 = await onDevice(b, async () => {
      await sync(server, T + 2 * MIN);
      await recordReaderEncounters(text, 'open-b', [note], T + 3 * MIN);
      await sync(server, T + 4 * MIN);
    });
    await onDevice(a2, async () => {
      await recordReaderEncounters(text, 'open-a1', [note], T + 3 * MIN);
      await recordReaderEncounters(text, 'open-a2', [note], T + 5 * MIN);
      await sync(server, T + 20 * MIN);
      expect(await getEncounterSummary(note)).toEqual({ cards: 0, texts: 3, total: 3 });
    });
    await onDevice(b2, async () => {
      await sync(server, T + 21 * MIN);
      expect(await getEncounterSummary(note)).toEqual({ cards: 0, texts: 3, total: 3 });
    });
    expect(
      server
        .rowsOf('encounters')
        .map((r) => r.device_id)
        .sort(),
    ).toEqual(['dev-a', 'dev-b']);
  });
});
