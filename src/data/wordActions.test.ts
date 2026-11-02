// Bulk word actions, undo, "Biliyorum" and progress reset (v0.5.2, ADR 0063).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Rating } from '../domain/types';
import { resetDb } from '../test/db';
import { addNoteWithSenses, answerCard } from './actions';
import { db } from './db';
import { createDeck, deleteDeck } from './decks';
import { getKnownTermKeys } from './knownTerms';
import { updateSettings } from './settings';
import {
  bulkSetSuspended,
  bulkSoftDeleteNotes,
  markNotesKnown,
  resetNoteProgress,
  restoreDeck,
  restoreNotes,
  undoMarkNotesKnown,
  undoNoteReset,
} from './wordActions';

const T = Date.UTC(2026, 9, 21, 9);
const DAY = 86_400_000;

beforeEach(async () => {
  await resetDb();
  await updateSettings({ timezone: 'Europe/Istanbul' }, T - 30 * DAY);
});

async function word(term: string, at = T - 20 * DAY): Promise<string> {
  const r = await addNoteWithSenses({ term, senses: [{ meaning_tr: `${term} anlamı`, source_sentence: `I like the ${term} here.` }] }, at);
  return r.note.id;
}

describe('bulk word actions', () => {
  it('deletes many notes in one transaction, reports progress and touches only the given ids', async () => {
    const ids = await Promise.all(['apple', 'bread', 'chair', 'door'].map((t) => word(t)));
    const spy = vi.spyOn(db, 'transaction');
    const progress: number[] = [];
    const res = await bulkSoftDeleteNotes(ids.slice(0, 3), { now: T, onProgress: (d) => progress.push(d) });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    expect(res.ids).toHaveLength(3);
    expect(progress.at(-1)).toBe(3);
    const notes = await db.notes.toArray();
    expect(notes.filter((n) => n.deleted_at === T)).toHaveLength(3);
    expect((await db.notes.get(ids[3]!))!.deleted_at).toBeNull();
    const cards = await db.cards.where('note_id').equals(ids[0]!).toArray();
    expect(cards.every((c) => c.deleted_at === T)).toBe(true);
  });

  it('"Geri al" brings back the notes with the senses and cards deleted together', async () => {
    const id = await word('apple');
    const res = await bulkSoftDeleteNotes([id], { now: T });
    await restoreNotes(res.ids, res.at, T + 1000);
    expect((await db.notes.get(id))!.deleted_at).toBeNull();
    const cards = await db.cards.where('note_id').equals(id).toArray();
    expect(cards.every((c) => c.deleted_at === null)).toBe(true);
    expect((await db.senses.where('note_id').equals(id).toArray()).every((s) => s.deleted_at === null)).toBe(true);
  });

  it('suspends and unsuspends many notes in one transaction', async () => {
    const ids = await Promise.all(['apple', 'bread'].map((t) => word(t)));
    expect(await bulkSetSuspended(ids, true, { now: T })).toBeGreaterThan(0);
    expect((await db.cards.toArray()).every((c) => c.suspended)).toBe(true);
    await bulkSetSuspended(ids, false, { now: T + 1 });
    expect((await db.cards.toArray()).every((c) => !c.suspended)).toBe(true);
  });

  it('"Biliyorum" moves words to the known words and undo puts them back', async () => {
    const id = await word('apple');
    const res = await markNotesKnown([id], T);
    expect((await getKnownTermKeys()).has('apple')).toBe(true);
    expect((await db.notes.get(id))!.deleted_at).toBe(T);
    await undoMarkNotesKnown(res, T + 1000);
    expect((await getKnownTermKeys()).has('apple')).toBe(false);
    expect((await db.notes.get(id))!.deleted_at).toBeNull();
  });

  it('resets a word to new, keeps the review logs, and undo restores the old cards', async () => {
    const id = await word('apple');
    const rec = (await db.cards.where('note_id').equals(id).toArray()).find((c) => c.card_type === 'recognition')!;
    await answerCard({ card_id: rec.id, rating: Rating.Good, duration_ms: 3000 }, T - DAY);
    const logs = await db.review_logs.count();
    const res = await resetNoteProgress(id, T);
    const live = (await db.cards.where('note_id').equals(id).toArray()).filter((c) => c.deleted_at === null);
    expect(live.length).toBe(res.created.length);
    expect(live.every((c) => c.reps === 0 && c.state === 0)).toBe(true);
    expect(await db.review_logs.count()).toBe(logs);
    await undoNoteReset(res, T + 1000);
    const back = (await db.cards.where('note_id').equals(id).toArray()).filter((c) => c.deleted_at === null);
    expect(back.map((c) => c.id).sort()).toEqual([...res.original].sort());
  });

  it('a deleted deck can be restored', async () => {
    const d = await createDeck({ name: 'İş', filter: { v: 1, tags: ['iş'] } }, T);
    await deleteDeck(d.id, T + 1);
    await restoreDeck(d.id, T + 2);
    expect((await db.decks.get(d.id))!.deleted_at).toBeNull();
  });
});
