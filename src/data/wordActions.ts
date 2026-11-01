// Many-word actions for Kelimelerim (v0.5.2, ADR 0063): bulk delete / suspend in ONE
// transaction with a progress callback, "Geri al" for deletes, "Biliyorum" for words the
// user already has, and "İlerlemeyi sıfırla" for one word. Review logs are only read.
import { emptyFsrs } from '../domain/fsrs';
import { primaryRecognition } from '../domain/leech';
import { deriveUnlocked } from '../domain/recompute';
import type { Card, Id, Millis, Note } from '../domain/types';
import { syncFromPrimary } from './actions';
import { db } from './db';
import { ActionError } from './errors';
import { markKnownIn } from './knownTerms';
import { type SyncWriter, writeTx } from './writer';

export type Progress = (done: number, total: number) => void;

/** How often (rows) a bulk action reports progress. */
const STEP = 25;

function reporter(total: number, onProgress?: Progress) {
  let last = -1;
  return (done: number) => {
    if (!onProgress) return;
    if (done === total || done - last >= STEP) {
      last = done;
      onProgress(done, total);
    }
  };
}

async function deleteNoteIn(w: SyncWriter, note: Note, at: Millis): Promise<boolean> {
  if (note.deleted_at !== null) return false;
  await w.put('notes', { ...note, deleted_at: at });
  for (const s of await db.senses.where('note_id').equals(note.id).toArray())
    if (s.deleted_at === null) await w.put('senses', { ...s, deleted_at: at });
  for (const c of await db.cards.where('note_id').equals(note.id).toArray())
    if (c.deleted_at === null) await w.put('cards', { ...c, deleted_at: at });
  return true;
}

export interface BulkDeleteResult {
  /** Notes deleted by this call (already deleted ones are skipped). */
  ids: Id[];
  /** The deleted_at stamp, needed by restoreNotes ("Geri al"). */
  at: Millis;
}

/**
 * Soft-delete many notes with their senses and cards in ONE transaction (one live-query
 * refresh instead of one per note). Only the given ids are touched.
 */
export async function bulkSoftDeleteNotes(
  noteIds: Iterable<Id>,
  opts: { now?: Millis; onProgress?: Progress } = {},
): Promise<BulkDeleteResult> {
  const now = opts.now ?? Date.now();
  const ids = [...new Set(noteIds)];
  const tick = reporter(ids.length, opts.onProgress);
  return writeTx([db.notes, db.senses, db.cards], now, async (w) => {
    const notes = await db.notes.bulkGet(ids);
    const done: Id[] = [];
    for (const [i, note] of notes.entries()) {
      if (note && (await deleteNoteIn(w, note, now))) done.push(note.id);
      tick(i + 1);
    }
    return { ids: done, at: now };
  });
}

/**
 * "Geri al" after a delete: bring back the notes, and the senses and cards that were deleted
 * together with them (same deleted_at). Rows deleted earlier stay deleted.
 */
export async function restoreNotes(noteIds: Iterable<Id>, at: Millis, now: Millis = Date.now()): Promise<number> {
  const ids = [...new Set(noteIds)];
  return writeTx([db.notes, db.senses, db.cards], now, async (w) => {
    let n = 0;
    for (const note of await db.notes.bulkGet(ids)) {
      if (!note || note.deleted_at !== at) continue;
      await w.put('notes', { ...note, deleted_at: null });
      for (const s of await db.senses.where('note_id').equals(note.id).toArray())
        if (s.deleted_at === at) await w.put('senses', { ...s, deleted_at: null });
      for (const c of await db.cards.where('note_id').equals(note.id).toArray())
        if (c.deleted_at === at) await w.put('cards', { ...c, deleted_at: null });
      n++;
    }
    return n;
  });
}

/** Suspend or unsuspend every card of many notes in ONE transaction. Returns cards changed. */
export async function bulkSetSuspended(
  noteIds: Iterable<Id>,
  suspended: boolean,
  opts: { now?: Millis; onProgress?: Progress } = {},
): Promise<number> {
  const now = opts.now ?? Date.now();
  const ids = [...new Set(noteIds)];
  const tick = reporter(ids.length, opts.onProgress);
  return writeTx([db.cards], now, async (w) => {
    let n = 0;
    for (const [i, id] of ids.entries()) {
      for (const c of await db.cards.where('note_id').equals(id).toArray()) {
        if (c.deleted_at !== null || c.suspended === suspended) continue;
        await w.put('cards', { ...c, suspended });
        n++;
      }
      tick(i + 1);
    }
    return n;
  });
}

export interface MarkKnownResult extends BulkDeleteResult {
  /** Known-word keys this call added (the undo removes only these). */
  added: string[];
}

/**
 * "Biliyorum" for words the user already has: each word moves to Bildiğim kelimeler and its
 * cards leave study (the note is soft-deleted; its review history stays). Undo with
 * undoMarkNotesKnown. Re-adding the word later brings the note back with its progress.
 */
export async function markNotesKnown(noteIds: Iterable<Id>, now: Millis = Date.now()): Promise<MarkKnownResult> {
  const ids = [...new Set(noteIds)];
  return writeTx([db.notes, db.senses, db.cards, db.known_terms], now, async (w) => {
    const done: Id[] = [];
    const added: string[] = [];
    for (const note of await db.notes.bulkGet(ids)) {
      if (!note || note.deleted_at !== null) continue;
      const before = await db.known_terms.where('term_norm').equals(note.term_norm).toArray();
      const wasKnown = before.some((r) => r.deleted_at === null);
      await markKnownIn(w, note.term_norm, 'manual');
      if (!wasKnown) added.push(note.term_norm);
      await deleteNoteIn(w, note, now);
      done.push(note.id);
    }
    return { ids: done, at: now, added };
  });
}

/** Undo markNotesKnown: the notes come back and the known-word rows it added go. */
export async function undoMarkNotesKnown(res: MarkKnownResult, now: Millis = Date.now()): Promise<void> {
  await restoreNotes(res.ids, res.at, now);
  if (res.added.length === 0) return;
  await writeTx([db.known_terms], now, async (w) => {
    for (const key of res.added)
      for (const r of await db.known_terms.where('term_norm').equals(key).toArray())
        if (r.deleted_at === null) await w.put('known_terms', { ...r, deleted_at: now });
  });
}

export interface ResetResult {
  /** The old cards (soft-deleted; their review logs stay). */
  original: Id[];
  /** Their fresh copies. */
  created: Id[];
}

/**
 * "İlerlemeyi sıfırla" for one word: every live card starts again as new. The old cards are
 * soft-deleted with their history kept (review logs are never changed) and fresh copies
 * take their place, with the same suspend state.
 */
export async function resetNoteProgress(noteId: Id, now: Millis = Date.now()): Promise<ResetResult> {
  return writeTx([db.notes, db.cards], now, async (w) => {
    const note = await db.notes.get(noteId);
    if (!note || note.deleted_at !== null) throw new ActionError('not_found');
    const cards = (await db.cards.where('note_id').equals(noteId).toArray()).filter((c) => c.deleted_at === null);
    const res: ResetResult = { original: [], created: [] };
    const fresh = emptyFsrs(now);
    // Recognition first, so the copies of the other cards lock against the fresh recognition.
    const ordered = [...cards].sort((a, b) => Number(b.card_type === 'recognition') - Number(a.card_type === 'recognition'));
    const copies: Card[] = [];
    for (const c of ordered) {
      await w.put('cards', { ...c, deleted_at: now });
      res.original.push(c.id);
      const rec = primaryRecognition(copies) ?? null;
      const copy = await w.put('cards', {
        ...w.base(),
        note_id: c.note_id,
        sense_id: c.sense_id,
        card_type: c.card_type,
        suspended: c.suspended,
        unlocked: deriveUnlocked({ card_type: c.card_type, ...fresh }, rec),
        ...fresh,
      });
      copies.push(copy);
      res.created.push(copy.id);
    }
    await syncFromPrimary(w, noteId);
    return res;
  });
}

/** "Geri al" right after a reset: the copies go (while unanswered) and the old cards return. */
export async function undoNoteReset(res: ResetResult, now: Millis = Date.now()): Promise<void> {
  await writeTx([db.cards, db.review_logs], now, async (w) => {
    for (const id of res.created) {
      const c = await db.cards.get(id);
      if (!c || c.deleted_at !== null) continue;
      if ((await db.review_logs.where('card_id').equals(id).count()) > 0) continue;
      await w.put('cards', { ...c, deleted_at: now });
    }
    let noteId: Id | null = null;
    for (const id of res.original) {
      const c = await db.cards.get(id);
      if (!c || c.deleted_at === null) continue;
      await w.put('cards', { ...c, deleted_at: null });
      noteId = c.note_id;
    }
    if (noteId) await syncFromPrimary(w, noteId);
  });
}

/** "Geri al" after a deck delete. */
export async function restoreDeck(id: Id, now: Millis = Date.now()): Promise<void> {
  await writeTx([db.decks], now, async (w) => {
    const deck = await db.decks.get(id);
    if (deck && deck.deleted_at !== null) await w.put('decks', { ...deck, deleted_at: null });
  });
}
