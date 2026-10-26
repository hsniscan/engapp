// Leech cards on the device (v0.3 İP6, docs/decisions/0026): lapses read from the review
// logs, the "Bu karta başka yoldan bakalım" sheet's data, and the two card actions only the
// user can start: split a recognition card per sense, and reset a card. Review logs are only
// read: a split keeps the history on the original card, a reset suspends the old card and
// adds a fresh copy, so no log is ever changed or moved.
import { emptyFsrs } from '../domain/fsrs';
import {
  becameLeech,
  canSplitSenses,
  isLeech,
  lapsesFromLogs,
  type LeechEntry,
  listLeeches,
  primaryRecognition,
  splitTargets,
} from '../domain/leech';
import { deriveUnlocked } from '../domain/recompute';
import type { Card, Id, Millis, Note, Sense } from '../domain/types';
import { syncFromPrimary } from './actions';
import { db } from './db';
import { ActionError } from './errors';
import { logsByCard } from './history';
import { writeTx } from './writer';
import { scanWhere } from './scan';

/** Lapses of a card, from its review logs (undo-aware). Safe in live queries. */
export async function getCardLapses(cardId: Id): Promise<number> {
  return lapsesFromLogs(await db.review_logs.where('card_id').equals(cardId).toArray());
}

/** Did this answer make the card a leech? (Asked right after answerCard, in the session.) */
export async function leechAfterAnswer(cardId: Id, logId: Id): Promise<{ crossed: boolean; lapses: number }> {
  const logs = await db.review_logs.where('card_id').equals(cardId).toArray();
  return { crossed: becameLeech(logs, logId), lapses: lapsesFromLogs(logs) };
}

export interface LeechSheetData {
  card: Card;
  note: Note;
  /** Live senses of the note, in display order. */
  senses: Sense[];
  /** The senses this card asks about: its own sense, or every sense for a recognition card. */
  cardSenses: Sense[];
  lapses: number;
  leech: boolean;
  /** "Anlamları ayrı kartlara böl" is possible. */
  canSplit: boolean;
  /** Senses that would get their own recognition card. */
  splitSenseIds: Id[];
}

/** Everything the "Bu karta başka yoldan bakalım" sheet needs (live). */
export async function getLeechSheet(cardId: Id): Promise<LeechSheetData | null> {
  const card = await db.cards.get(cardId);
  if (!card || card.deleted_at !== null) return null;
  const note = await db.notes.get(card.note_id);
  if (!note || note.deleted_at !== null) return null;
  const [senses, noteCards, logs] = await Promise.all([
    db.senses.where('note_id').equals(note.id).toArray(),
    db.cards.where('note_id').equals(note.id).toArray(),
    db.review_logs.where('card_id').equals(cardId).toArray(),
  ]);
  const live = senses.filter((s) => s.deleted_at === null).sort((a, b) => a.sense_no - b.sense_no);
  const cardSenses = card.sense_id ? live.filter((s) => s.id === card.sense_id) : live;
  const lapses = lapsesFromLogs(logs);
  const canSplit = canSplitSenses(card, live, noteCards, note.term_type);
  return {
    card,
    note,
    senses: live,
    cardSenses,
    lapses,
    leech: isLeech(lapses),
    canSplit,
    splitSenseIds: canSplit ? splitTargets(live, noteCards) : [],
  };
}

export interface LeechListItem extends LeechEntry {
  term: string;
  card_type: Card['card_type'];
  /** The Turkish meaning the card asks about (its sense, else the note's first sense). */
  meaning: string | null;
}

/** "Zorlandıklarım": live, unsuspended leech cards with their words, most lapses first. */
export async function listLeechCards(): Promise<LeechListItem[]> {
  return db.transaction('r', [db.cards, db.review_logs, db.notes, db.senses], async () => {
    // Only cards that FSRS already counts six lapses for can be leeches (card.lapses = replay
    // of the logs, invariant 3); their logs decide.
    const candidates = await scanWhere(db.cards, (c) => c.deleted_at === null && !c.suspended && isLeech(c.lapses));
    if (candidates.length === 0) return [];
    const logs = await logsByCard(candidates.map((c) => c.id));
    const entries = listLeeches(candidates, logs);
    const byId = new Map(candidates.map((c) => [c.id, c]));
    const notes = new Map(
      (await db.notes.bulkGet([...new Set(entries.map((e) => e.note_id))])).flatMap((n) => (n && n.deleted_at === null ? [[n.id, n] as const] : [])),
    );
    const senses = await db.senses.where('note_id').anyOf([...notes.keys()]).toArray();
    const out: LeechListItem[] = [];
    for (const e of entries) {
      const note = notes.get(e.note_id);
      const card = byId.get(e.card_id)!;
      if (!note) continue;
      const own = senses
        .filter((s) => s.note_id === note.id && s.deleted_at === null)
        .sort((a, b) => a.sense_no - b.sense_no);
      const sense = (card.sense_id && own.find((s) => s.id === card.sense_id)) || own[0];
      out.push({
        ...e,
        term: note.term,
        card_type: card.card_type,
        meaning: sense ? (sense.meaning_tr_override ?? sense.meaning_tr) : null,
      });
    }
    return out;
  });
}

/** Lapses per note (the sum over its live cards), for ranking confusable pairs. */
export async function lapsesByNote(): Promise<Map<Id, number>> {
  const out = new Map<Id, number>();
  await db.cards.each((c) => {
    if (c.deleted_at !== null || c.lapses === 0) return;
    out.set(c.note_id, (out.get(c.note_id) ?? 0) + c.lapses);
  });
  return out;
}

// ------------------------------------------------------------------ the user's actions

/**
 * "Anlamları ayrı kartlara böl": one recognition card per sense (sense_id set, starting new),
 * and the original card is suspended — its history stays on it, untouched. Only the user
 * starts this. Returns the new card ids.
 * @throws ActionError('invalid_input') when the card cannot be split.
 */
export async function splitSenses(cardId: Id, now: Millis = Date.now()): Promise<Id[]> {
  return writeTx([db.cards, db.notes, db.senses], now, async (w) => {
    const card = await db.cards.get(cardId);
    if (!card || card.deleted_at !== null) throw new ActionError('not_found');
    const note = await db.notes.get(card.note_id);
    if (!note || note.deleted_at !== null) throw new ActionError('not_found');
    const senses = (await db.senses.where('note_id').equals(note.id).toArray())
      .filter((s) => s.deleted_at === null)
      .sort((a, b) => a.sense_no - b.sense_no);
    const noteCards = await db.cards.where('note_id').equals(note.id).toArray();
    if (!canSplitSenses(card, senses, noteCards, note.term_type)) throw new ActionError('invalid_input', 'cannot split');
    const ids: Id[] = [];
    for (const senseId of splitTargets(senses, noteCards)) {
      const created = await w.put('cards', {
        ...w.base(),
        note_id: note.id,
        sense_id: senseId,
        card_type: 'recognition',
        suspended: false,
        unlocked: true,
        ...emptyFsrs(now),
      });
      ids.push(created.id);
    }
    if (!card.suspended) await w.put('cards', { ...card, suspended: true });
    // The suspended original stays the primary recognition card: nothing is re-locked.
    await syncFromPrimary(w, note.id);
    return ids;
  });
}

/**
 * "Sıfırla": start this card again from scratch. The old card is suspended with its history
 * (review logs are never changed) and a fresh copy of it starts as new. Only the user starts
 * this. Returns the new card.
 */
export async function resetCard(cardId: Id, now: Millis = Date.now()): Promise<Card> {
  return writeTx([db.cards], now, async (w) => {
    const card = await db.cards.get(cardId);
    if (!card || card.deleted_at !== null) throw new ActionError('not_found');
    await w.put('cards', { ...card, suspended: true });
    const noteCards = await db.cards.where('note_id').equals(card.note_id).toArray();
    const fresh = emptyFsrs(now);
    const recState = primaryRecognition(noteCards) ?? null;
    const copy = await w.put('cards', {
      ...w.base(),
      note_id: card.note_id,
      sense_id: card.sense_id,
      card_type: card.card_type,
      suspended: false,
      unlocked: deriveUnlocked({ card_type: card.card_type, ...fresh }, recState),
      ...fresh,
    });
    if (card.card_type === 'recognition') await syncFromPrimary(w, card.note_id);
    return (await db.cards.get(copy.id)) ?? copy;
  });
}

/**
 * "Geri al" right after a split or a reset: the new cards go (soft delete; only while they
 * have no answers of their own) and the original card is active again.
 */
export async function undoLeechAction(originalId: Id, createdIds: readonly Id[], now: Millis = Date.now()): Promise<void> {
  await writeTx([db.cards, db.review_logs], now, async (w) => {
    const original = await db.cards.get(originalId);
    if (!original) throw new ActionError('not_found');
    for (const id of createdIds) {
      const c = await db.cards.get(id);
      if (!c || c.deleted_at !== null) continue;
      if ((await db.review_logs.where('card_id').equals(id).count()) > 0) continue;
      await w.put('cards', { ...c, deleted_at: now });
    }
    if (original.suspended) await w.put('cards', { ...original, suspended: false });
    await syncFromPrimary(w, original.note_id);
  });
}
