// Smart new-card order, data side (v0.4, docs/decisions/0039): reads what domain/newOrder.ts
// needs about the notes of today's new cards, inside the queue's transaction (newOrderTables).
//
// The client level file is used once something else loaded it (the card's level badge does,
// on the first card shown): it is never awaited or fetched here, because the queue is built
// inside useLiveQuery, where awaiting a fetch would lose Dexie's zone, and parsing it would
// delay a cold start's first card. Until then the levels stored with the lexicon count; the
// cards not shown yet may move once it is there, which the user does not see (cards introduced
// earlier today always seed the selection, so what was shown stays consistent). Word
// families come from the morphology file the family screens cached (ref_cache), read once per
// app session. The part that only depends on earlier days (sources the user started words
// from in the last 7 days) is computed once per day.
import { CONFUSION_KIND, contrastTerms, pairKey } from '../domain/confusables';
import type { DayBounds } from '../domain/day';
import type { LevelData } from '../domain/level';
import type { MorphologyFile } from '../domain/morphology';
import { type NewNoteFacts, type NewOrderInput, newOrderSeed, noteFacts } from '../domain/newOrder';
import { normalizeTerm } from '../domain/normalize';
import { effectiveLogs } from '../domain/recompute';
import type { Card, Id, LexiconSense, Note, Sense, Settings } from '../domain/types';
import Dexie from 'dexie';
import { db } from './db';
import { logsByCard, type TodayFacts } from './history';
import { levelDataNow } from './levelData';

const DAY_MS = 86_400_000;
/** A source imported this many days before today (or today) counts as one the user works on. */
export const ACTIVE_SOURCE_NEW_DAYS = 14;
/** …as does a source the user started a word from in this many days before today. */
export const ACTIVE_SOURCE_STUDY_DAYS = 7;
// Inside a Dexie transaction, only a function that has just awaited a Dexie request may be
// awaited: awaiting one that returns at once (a cache hit) can drop Dexie's zone, after which
// the next query runs outside the transaction and the transaction commits too early. So every
// cached value below is read synchronously and the loader is awaited only on a miss.

/** Word family of a lemma; undefined = not read yet this app session; null = no file cached. */
let familyMap: Map<string, number> | null | undefined;

async function readFamilies(): Promise<void> {
  const file = (await db.ref_cache.get('morphology'))?.data as MorphologyFile | undefined;
  if (file && Array.isArray(file.words)) {
    const map = new Map<string, number>();
    for (const [lemma, , family] of file.words) if (family >= 0) map.set(lemma, family);
    familyMap = map;
  } else familyMap = null;
}

function familyLookup(): ((lemma: string) => number | null) | undefined {
  const map = familyMap;
  return map ? (lemma) => map.get(lemma) ?? null : undefined;
}

/** Tests only: forget what was read once per app session. */
export function resetNewOrderCaches(): void {
  familyMap = undefined;
  studied = null;
  cache = null;
}

/** Tables newOrderInput reads (add them to the caller's transaction). */
export const newOrderTables = () => [
  db.notes,
  db.senses,
  db.cards,
  db.review_logs,
  db.sources,
  db.lexicon_cache,
  db.user_content,
  db.lexicon_pair_notes,
  db.ref_cache,
];

// ------------------------------------------------------------------ active sources

let studied: { key: string; sources: Set<Id> } | null = null;

/**
 * Sources the user started a word from (a card's first answer) in the 7 days before today.
 * Only earlier days count, so the answer does not change during the day; cached per day
 * (`studied`, keyed by user and day).
 */
async function readStudiedSources(bounds: DayBounds, key: string): Promise<void> {
  const from = bounds.start - ACTIVE_SOURCE_STUDY_DAYS * DAY_MS;
  const window = await db.review_logs.where('reviewed_at').between(from, bounds.start, true, false).toArray();
  const cardIds = new Set(window.map((l) => l.card_id));
  const started = new Set<Id>();
  for (const [cardId, logs] of cardIds.size ? await logsByCard(cardIds) : []) {
    const first = effectiveLogs(logs)[0];
    if (first && first.reviewed_at >= from && first.reviewed_at < bounds.start) started.add(cardId);
  }
  const noteIds = new Set(
    (await db.cards.bulkGet([...started])).filter((c): c is Card => !!c).map((c) => c.note_id),
  );
  const sources = new Set<Id>();
  if (noteIds.size) {
    for (const s of await db.senses.where('note_id').anyOf([...noteIds]).toArray()) {
      if (s.source_id) sources.add(s.source_id);
    }
  }
  studied = { key, sources };
}

// ------------------------------------------------------------------ input

/** Words of a false friend's "İng. karşılığı" ("current, topical") as term keys. */
function englishWords(v: unknown): string[] {
  if (typeof v !== 'string') return [];
  return v
    .split(/[,;/]|\bor\b/)
    .map((w) => normalizeTerm(w.replace(/\(.*?\)/g, '')))
    .filter(Boolean);
}

// ------------------------------------------------------------------ per-note facts, cached

/**
 * The rows of the notes read so far, their facts and the false-friend pairs of their terms.
 * Answers only change cards and logs, so the queue rebuilt after every answer reads nothing
 * new; any write to a table the rows come from (here or in another tab: a sync pull, an edit)
 * clears it. When the level file or the word families arrive, only the facts are recomputed.
 */
interface RawNote {
  note: Note;
  /** Live senses in display order. */
  senses: Sense[];
  lex: Map<Id, LexiconSense>;
}

interface FactsCache {
  raw: Map<Id, RawNote>;
  /** Facts for `levels` and `families`. */
  levels: LevelData | null;
  families: boolean;
  facts: Map<Id, NewNoteFacts>;
  /** Note ids with no note row (a card whose note has not synced yet): not looked up again. */
  absent: Set<Id>;
  /** Note id → pair keys of its false friends. */
  falseFriends: Map<Id, string[]>;
  confusions: Set<string> | null;
}

let cache: FactsCache | null = null;
const FACT_TABLES = /\/(notes|senses|lexicon_cache|lexicon_pair_notes|user_content|ref_cache)\//;
let listening = false;

function listen(): void {
  if (listening) return;
  listening = true;
  Dexie.on('storagemutated', (parts) => {
    if (cache && Object.keys(parts).some((k) => FACT_TABLES.test(k))) cache = null;
  });
}

/**
 * Above this many notes to read, reading the whole table at once (getAll) beats a lookup per
 * key; a Dexie filter() would walk a cursor row by row, which is slower than both.
 */
const SCAN_ABOVE = 300;

/** Reads the rows of `missing` (not empty) into the cache. */
async function loadRows(missing: Id[], c: FactsCache): Promise<void> {
  const wanted = new Set(missing);
  const scan = missing.length > SCAN_ABOVE;
  const [notes, senseRows] = await Promise.all([
    scan
      ? db.notes.toArray().then((all) => {
          const byId = new Map(all.map((n) => [n.id, n]));
          return missing.map((id) => byId.get(id));
        })
      : db.notes.bulkGet(missing),
    scan
      ? db.senses.toArray().then((all) => all.filter((x) => wanted.has(x.note_id)))
      : db.senses.where('note_id').anyOf(missing).toArray(),
  ]);
  const sensesByNote = new Map<Id, Sense[]>();
  const lexIds = new Set<Id>();
  for (const s of senseRows) {
    if (s.deleted_at !== null) continue;
    const list = sensesByNote.get(s.note_id);
    if (list) list.push(s);
    else sensesByNote.set(s.note_id, [s]);
    if (s.lexicon_sense_id) lexIds.add(s.lexicon_sense_id);
  }
  const lex = new Map<Id, LexiconSense>();
  if (lexIds.size) for (const r of await db.lexicon_cache.bulkGet([...lexIds])) if (r) lex.set(r.id, r);
  const byTerm = new Map<string, Id[]>();
  for (const [i, n] of notes.entries()) {
    if (!n) {
      c.absent.add(missing[i]!);
      continue;
    }
    const own = (sensesByNote.get(n.id) ?? []).sort((a, b) => a.sense_no - b.sense_no);
    const ownLex = new Map<Id, LexiconSense>();
    for (const x of own) if (x.lexicon_sense_id && lex.has(x.lexicon_sense_id)) ownLex.set(x.lexicon_sense_id, lex.get(x.lexicon_sense_id)!);
    c.raw.set(n.id, { note: n, senses: own, lex: ownLex });
    (byTerm.get(n.term_norm) ?? byTerm.set(n.term_norm, []).get(n.term_norm)!).push(n.id);
  }
  // False friends of these words (cached lexicon_pair_notes rows): the Turkish look-alike's
  // English words ("actual" → "current") are confusable with the word.
  const terms = [...byTerm.keys()];
  if (terms.length === 0) return;
  const termSet = new Set(terms);
  const rows =
    terms.length > SCAN_ABOVE
      ? (await db.lexicon_pair_notes.toArray()).filter((r) => termSet.has(r.term_norm))
      : await db.lexicon_pair_notes.where('term_norm').anyOf(terms).toArray();
  for (const r of rows) {
    if (r.kind !== 'false_friend' || r.status !== 'active') continue;
    const keys = englishWords(r.content.tr_meaning_en)
      .filter((w) => w !== r.term_norm)
      .map((w) => pairKey(r.term_norm, w));
    if (keys.length === 0) continue;
    for (const noteId of byTerm.get(r.term_norm) ?? []) c.falseFriends.set(noteId, [...(c.falseFriends.get(noteId) ?? []), ...keys]);
  }
}

/** The user's reported confusions, as pair keys. */
async function reportedPairs(): Promise<Set<string>> {
  const pairs = new Set<string>();
  for (const r of await db.user_content.where('kind').equals(CONFUSION_KIND).toArray()) {
    if (r.deleted_at !== null || r.context !== 'reported') continue;
    const two = contrastTerms(r.text);
    if (two) pairs.add(pairKey(two[0], two[1]));
  }
  return pairs;
}

/**
 * Inside the queue's transaction (newOrderTables): what the order needs about the notes of
 * `fresh` and of the cards introduced earlier today.
 */
export async function newOrderInput(
  fresh: readonly Card[],
  today: Pick<TodayFacts, 'bounds' | 'introducedNoteIds'>,
  settings: Pick<Settings, 'level' | 'user_id' | 'created_at'>,
  /** v0.5 İP10 (decision 0052): the order and the cards the guard postponed on earlier days. */
  guard: { order?: 'smart' | 'added'; carry?: readonly Id[] } = {},
): Promise<NewOrderInput> {
  listen();
  const levels = levelDataNow();
  if (familyMap === undefined) await readFamilies();
  const familyOf = familyLookup();
  cache ??= { raw: new Map(), levels, families: !!familyOf, facts: new Map(), absent: new Set(), falseFriends: new Map(), confusions: null };
  const c = cache;
  if (c.levels !== levels || c.families !== !!familyOf) {
    c.levels = levels;
    c.families = !!familyOf;
    c.facts = new Map();
  }
  const userKey = settings.user_id ?? `guest:${settings.created_at}`;
  const noteIds = [...new Set([...fresh.map((x) => x.note_id), ...today.introducedNoteIds])];
  const missing = noteIds.filter((id) => !c.raw.has(id) && !c.absent.has(id));
  if (missing.length) await loadRows(missing, c);
  for (const id of noteIds) {
    const r = c.raw.get(id);
    if (r && !c.facts.has(id)) c.facts.set(id, noteFacts(r.note, r.senses, (x) => r.lex.get(x), levels, familyOf));
  }
  c.confusions ??= await reportedPairs();

  // Sources the user works on: imported lately, or words started from them lately.
  const recent = await db.sources
    .where('created_at')
    .aboveOrEqual(today.bounds.start - ACTIVE_SOURCE_NEW_DAYS * DAY_MS)
    .filter((x) => x.deleted_at === null)
    .primaryKeys();
  // Only worth reading the last week's logs when one of these words comes from a source.
  const fromSource = noteIds.some((id) => !!c.facts.get(id)?.source_id);
  const activeSources = new Set<Id>(recent);
  if (fromSource) {
    const key = `${userKey}|${today.bounds.key}`;
    if (studied?.key !== key) await readStudiedSources(today.bounds, key);
    for (const s of studied!.sources) activeSources.add(s);
  }

  const pairs = new Set(c.confusions);
  const notes = new Map<Id, NewNoteFacts>();
  for (const id of noteIds) {
    const f = c.facts.get(id);
    if (f) notes.set(id, f);
    for (const k of c.falseFriends.get(id) ?? []) pairs.add(k);
  }
  return {
    level: settings.level,
    seed: newOrderSeed(userKey, today.bounds.key),
    dayStart: today.bounds.start,
    notes,
    activeSources,
    pairs,
    introducedToday: today.introducedNoteIds,
    ...(guard.carry?.length ? { carry: guard.carry } : {}),
    ...(guard.order === 'added' ? { order: 'added' as const } : {}),
  };
}
