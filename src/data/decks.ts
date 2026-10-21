// Smart decks and tags, data side. Decks are synced mutable rows (writeTx → outbox); the
// filter itself is evaluated on the device (domain/deckFilter.ts) over the live notes.
import {
  cleanDeckName,
  type DeckContext,
  deckNoteIds,
  type DeckNoteFacts,
  normalizeDeckFilter,
  orderDecks,
  parseDeckFilter,
  type DeckFilter,
} from '../domain/deckFilter';
import { HARD_WINDOW_MS } from '../domain/practice';
import { effectiveLogs } from '../domain/recompute';
import {
  cleanTag,
  hasTag,
  renamedTags,
  sameTag,
  tagCounts,
  withoutTags,
  withTags,
} from '../domain/tags';
import { type LevelData, noteLevel } from '../domain/level';
import {
  type Card,
  type CefrLevel,
  type Deck,
  type Id,
  type LexiconSense,
  type Millis,
  type Note,
  Rating,
  type Sense,
} from '../domain/types';
import { db } from './db';
import { ActionError } from './errors';
import { logsByCard } from './history';
import { levelDataNow } from './levelData';
import { writeTx } from './writer';

// ------------------------------------------------------------------ evaluation context

/**
 * Resolvers for the reserved filter keys:
 *   - `levelOf`: the note's level as the app shows it (İP2 noteLevel: the user's own level,
 *     else the first sense with a stored or computed level). The client level file is used
 *     when it is already loaded (`levelData`, default levelDataNow()); before that only
 *     stored levels and overrides count, and screens re-run when it arrives.
 *   - `topicsOf`: topic keys (İP7) of the live sources the note's live senses came from.
 */
export async function deckContext(
  now: Millis,
  levelData: LevelData | null = levelDataNow(),
): Promise<DeckContext> {
  const notes = await db.notes.filter((n) => n.deleted_at === null).toArray();
  const senses = await db.senses.filter((s) => s.deleted_at === null).toArray();
  const sources = await db.sources.filter((s) => s.deleted_at === null).toArray();
  const lexIds = [...new Set(senses.map((s) => s.lexicon_sense_id).filter((x): x is Id => !!x))];
  const lexRows = lexIds.length ? await db.lexicon_cache.bulkGet(lexIds) : [];
  const lexicon = new Map(lexRows.filter((r): r is LexiconSense => !!r).map((r) => [r.id, r]));

  const notesById = new Map(notes.map((n) => [n.id, n]));
  const sensesByNote = new Map<Id, Sense[]>();
  for (const s of senses) {
    const list = sensesByNote.get(s.note_id);
    if (list) list.push(s);
    else sensesByNote.set(s.note_id, [s]);
  }
  for (const list of sensesByNote.values()) list.sort((a, b) => a.sense_no - b.sense_no);
  const topicsBySource = new Map(sources.map((s) => [s.id, s.topics ?? []]));

  const levels = new Map<Id, CefrLevel | null>();
  return {
    now,
    levelOf: (noteId) => {
      if (levels.has(noteId)) return levels.get(noteId)!;
      const note = notesById.get(noteId);
      const level = note
        ? (noteLevel(note, sensesByNote.get(noteId) ?? [], (id) => lexicon.get(id), levelData)?.cefr ?? null)
        : null;
      levels.set(noteId, level);
      return level;
    },
    topicsOf: (noteId) => {
      const out = new Set<string>();
      for (const s of sensesByNote.get(noteId) ?? []) {
        for (const t of (s.source_id && topicsBySource.get(s.source_id)) || []) out.add(t);
      }
      return [...out];
    },
  };
}

/** Every live note with its live cards and recent misses (one pass, ~10 ms for 1,000 notes). */
export async function loadDeckFacts(now: Millis = Date.now()): Promise<DeckNoteFacts[]> {
  return db.transaction('r', [db.notes, db.cards, db.review_logs, db.practice_logs], async () => {
    const since = now - HARD_WINDOW_MS;
    const [notes, cards, recentLogs, misses] = await Promise.all([
      db.notes.filter((n) => n.deleted_at === null).toArray(),
      db.cards.filter((c) => c.deleted_at === null).toArray(),
      db.review_logs.where('reviewed_at').aboveOrEqual(since).toArray(),
      db.practice_logs
        .where('practiced_at')
        .aboveOrEqual(since)
        .filter((p) => p.result === 'unknown')
        .toArray(),
    ]);
    const cardsByNote = new Map<Id, Card[]>();
    const noteOfCard = new Map<Id, Id>();
    for (const c of cards) {
      noteOfCard.set(c.id, c.note_id);
      const list = cardsByNote.get(c.note_id);
      if (list) list.push(c);
      else cardsByNote.set(c.note_id, [c]);
    }
    // Latest Again per note, from all logs of the cards answered in the window (an undo row
    // can cancel an answer from before the window's first log of that card).
    const lastAgain = new Map<Id, Millis>();
    const touched = await logsByCard(recentLogs.map((l) => l.card_id));
    for (const [cardId, logs] of touched) {
      const noteId = noteOfCard.get(cardId);
      if (!noteId) continue;
      for (const l of effectiveLogs(logs))
        if (l.rating === Rating.Again && l.reviewed_at >= since)
          lastAgain.set(noteId, Math.max(lastAgain.get(noteId) ?? 0, l.reviewed_at));
    }
    const lastMiss = new Map<Id, Millis>();
    for (const p of misses) {
      const noteId = noteOfCard.get(p.card_id);
      if (noteId) lastMiss.set(noteId, Math.max(lastMiss.get(noteId) ?? 0, p.practiced_at));
    }
    return notes.map((note) => ({
      note,
      cards: cardsByNote.get(note.id) ?? [],
      lastAgainAt: lastAgain.get(note.id) ?? null,
      lastPracticeMissAt: lastMiss.get(note.id) ?? null,
    }));
  });
}

// ------------------------------------------------------------------ decks

export async function listDecks(): Promise<Deck[]> {
  return orderDecks(await db.decks.toArray());
}

export interface DeckSummary {
  deck: Deck;
  /** Parsed filter, or null when this app version cannot read it. */
  filter: DeckFilter | null;
  /** Matching notes; null when the deck cannot be evaluated here (made by a newer version). */
  count: number | null;
}

/** Live decks in order, with their filters and note counts. */
export async function getDeckSummaries(now: Millis = Date.now()): Promise<DeckSummary[]> {
  const [decks, facts, ctx] = await Promise.all([
    listDecks(),
    loadDeckFacts(now),
    deckContext(now),
  ]);
  return decks.map((deck) => {
    const parsed = parseDeckFilter(deck.filter);
    const ids = deckNoteIds(deck.filter, facts, ctx);
    return { deck, filter: parsed.ok ? parsed.filter : null, count: ids ? ids.size : null };
  });
}

/** Note ids of a deck, or null when it is missing, deleted or not evaluable here. */
export async function getDeckNoteIds(
  deckId: Id,
  now: Millis = Date.now(),
): Promise<Set<Id> | null> {
  const deck = await db.decks.get(deckId);
  if (!deck || deck.deleted_at !== null) return null;
  return deckNoteIds(deck.filter, await loadDeckFacts(now), await deckContext(now));
}

/** How many notes a filter being edited would match (live preview in the editor). */
export async function countDeckFilter(
  filter: DeckFilter,
  now: Millis = Date.now(),
): Promise<number | null> {
  const ids = deckNoteIds(filter, await loadDeckFacts(now), await deckContext(now));
  return ids ? ids.size : null;
}

function checkName(raw: string): string {
  const name = cleanDeckName(raw);
  if (!name) throw new ActionError('invalid_input', 'Empty deck name');
  return name;
}

export interface DeckInput {
  name: string;
  filter: DeckFilter;
}

/** New deck at the end of the list. */
export async function createDeck(input: DeckInput, now: Millis = Date.now()): Promise<Deck> {
  const name = checkName(input.name);
  const filter = normalizeDeckFilter(input.filter);
  return writeTx([db.decks], now, async (w) => {
    const live = (await db.decks.toArray()).filter((d) => d.deleted_at === null);
    const sort = live.reduce((m, d) => Math.max(m, d.sort), 0) + 1;
    return w.put('decks', { ...w.base(), name, filter: { ...filter }, sort });
  });
}

/**
 * Rename a deck and/or replace its filter. A filter this version cannot read is kept as
 * stored unless a new one is given.
 */
export async function updateDeck(
  id: Id,
  patch: { name?: string; filter?: DeckFilter },
  now: Millis = Date.now(),
): Promise<Deck> {
  return writeTx([db.decks], now, async (w) => {
    const deck = await db.decks.get(id);
    if (!deck || deck.deleted_at !== null) throw new ActionError('not_found');
    const next: Deck = { ...deck };
    if (patch.name !== undefined) next.name = checkName(patch.name);
    if (patch.filter !== undefined) next.filter = { ...normalizeDeckFilter(patch.filter) };
    return w.put('decks', next);
  });
}

/** Soft-delete (the tombstone syncs). Notes are not touched. */
export async function deleteDeck(id: Id, now: Millis = Date.now()): Promise<void> {
  await writeTx([db.decks], now, async (w) => {
    const deck = await db.decks.get(id);
    if (!deck) throw new ActionError('not_found');
    if (deck.deleted_at === null) await w.put('decks', { ...deck, deleted_at: now });
  });
}

/**
 * Move a deck one place up (-1) or down (+1). Decks are renumbered 1..n, writing only the
 * rows whose position changed.
 */
export async function moveDeck(id: Id, dir: -1 | 1, now: Millis = Date.now()): Promise<void> {
  await writeTx([db.decks], now, async (w) => {
    const list = orderDecks(await db.decks.toArray());
    const i = list.findIndex((d) => d.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    for (const [k, d] of list.entries())
      if (d.sort !== k + 1) await w.put('decks', { ...d, sort: k + 1 });
  });
}

// ------------------------------------------------------------------ tags

/** Tags of live notes with their note counts, most used first. */
export async function listTags(): Promise<{ tag: string; count: number }[]> {
  const notes = await db.notes.filter((n) => n.deleted_at === null).toArray();
  return tagCounts(notes.map((n) => n.tags));
}

export interface BulkTagResult {
  /** Notes written. */
  changed: number;
  /** Notes that would have more than LIMITS.tags tags: left unchanged. */
  full: number;
}

/**
 * Add and/or remove tags on many notes in ONE transaction (one outbox row per changed note).
 * Tags compare case-insensitively; a note that already has a tag keeps its spelling.
 */
export async function setNoteTags(
  noteIds: Iterable<Id>,
  change: { add?: string[]; remove?: string[] },
  now: Millis = Date.now(),
): Promise<BulkTagResult> {
  const add = (change.add ?? []).map(cleanTag).filter(Boolean);
  const remove = (change.remove ?? [])
    .map(cleanTag)
    .filter(Boolean)
    .filter((t) => !add.some((a) => sameTag(a, t)));
  if (add.length === 0 && remove.length === 0) return { changed: 0, full: 0 };
  const ids = [...new Set(noteIds)];
  return writeTx([db.notes], now, async (w) => {
    const notes = await db.notes.bulkGet(ids);
    const res: BulkTagResult = { changed: 0, full: 0 };
    for (const note of notes) {
      if (!note || note.deleted_at !== null) continue;
      const next = withTags(withoutTags(note.tags, remove), add);
      if (!next) {
        res.full++;
        continue;
      }
      if (next.length === note.tags.length && next.every((t, i) => t === note.tags[i])) continue;
      await w.put('notes', { ...note, tags: next });
      res.changed++;
    }
    return res;
  });
}

/**
 * Rename a tag on every live note (merging with `to` where a note has both) and in the
 * decks that use it. Returns the number of notes changed.
 */
export async function renameTag(
  from: string,
  to: string,
  now: Millis = Date.now(),
): Promise<number> {
  const target = cleanTag(to);
  if (!target) throw new ActionError('invalid_input', 'Empty tag');
  return writeTx([db.notes, db.decks], now, async (w) => {
    let n = 0;
    // Not the *tags index: it is case-sensitive and the tag may be spelled differently.
    const notes = await db.notes
      .filter((x) => x.deleted_at === null && hasTag(x.tags, from))
      .toArray();
    for (const note of notes) {
      const next = renamedTags(note.tags, from, target);
      if (next.join('\u0000') !== note.tags.join('\u0000')) {
        await w.put('notes', { ...note, tags: next } satisfies Note);
        n++;
      }
    }
    for (const deck of await db.decks.toArray()) {
      if (deck.deleted_at !== null) continue;
      const parsed = parseDeckFilter(deck.filter);
      if (!parsed.ok || !parsed.filter.tags || !hasTag(parsed.filter.tags, from)) continue;
      const tags = renamedTags(parsed.filter.tags, from, target);
      await w.put('decks', {
        ...deck,
        filter: { ...normalizeDeckFilter({ ...parsed.filter, tags }) },
      });
    }
    return n;
  });
}

/** Remove a tag from every live note. Decks keep it (they then match no note with it). */
export async function deleteTag(tag: string, now: Millis = Date.now()): Promise<number> {
  const ids = (await db.notes
    .filter((x) => x.deleted_at === null && hasTag(x.tags, tag))
    .primaryKeys()) as Id[];
  return (await setNoteTags(ids, { remove: [tag] }, now)).changed;
}
