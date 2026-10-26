// Desteler (redesign), data side: the user's decks with their stage mix and today's load, the
// "what do I have" index the suggested decks are measured against, and adding a suggested
// deck. Adding goes word by word through addNoteWithSenses like the word bank (decision 0038):
// the same duplicate rules, and the new cards enter the normal queue, where the smart new-card
// order (decision 0039) and the daily new limit decide when each one is introduced.
import { dayBounds } from '../domain/day';
import {
  deckNoteIds,
  type DeckFilter,
  type DeckNoteFacts,
  orderDecks,
  parseDeckFilter,
} from '../domain/deckFilter';
import { normalizeTerm } from '../domain/normalize';
import { cardStage, type WordStage } from '../domain/stages';
import { deckWordStatus, type OwnedIndex } from '../domain/suggestedDecks';
import { hasTag } from '../domain/tags';
import { type Card, CardState, type Deck, type Id, type Millis, type Note } from '../domain/types';
import type { WordBankEntry } from '../domain/wordBank';
import { addNoteWithSenses } from './actions';
import { db } from './db';
import { createDeck, deckContext, loadDeckFacts, setNoteTags } from './decks';
import { getKnownTermKeys } from './knownTerms';
import { dayConfig, getSettings } from './settings';
import { bankNoteInput } from './wordBank';

/** The card a word's stage comes from: its recognition card (ogrenme-modeli §2.3). */
function stageCard(cards: readonly Card[]): Card | undefined {
  const live = cards.filter((c) => c.deleted_at === null);
  return live.find((c) => c.card_type === 'recognition') ?? live[0];
}

export interface WordStageMix {
  /** Words (notes). */
  total: number;
  /** Öğrenildi + Kalıcı. */
  learned: number;
  /** Öğreniyor + Pekişiyor. */
  studying: number;
  /** Not answered yet. */
  fresh: number;
}

function addStage(mix: WordStageMix, stage: WordStage | null) {
  mix.total++;
  if (stage === 'learned' || stage === 'mastered') mix.learned++;
  else if (stage === 'learning' || stage === 'consolidating') mix.studying++;
  else mix.fresh++;
}

/** loadDeckFacts keeps the whole card rows (typed narrower for the filter evaluator). */
const fullCards = (f: DeckNoteFacts): readonly Card[] => f.cards as readonly Card[];

const emptyMix = (): WordStageMix => ({ total: 0, learned: 0, studying: 0, fresh: 0 });

/** Live notes by normalised term with the stage of their main card; known words. */
export async function getOwnedIndex(now: Millis = Date.now()): Promise<OwnedIndex> {
  const [notes, cards, known] = await Promise.all([
    db.notes.filter((n) => n.deleted_at === null).toArray(),
    db.cards.filter((c) => c.deleted_at === null).toArray(),
    getKnownTermKeys(),
  ]);
  const byNote = groupCards(cards);
  const at = new Date(now);
  const stage = new Map<string, WordStage>();
  for (const n of notes) {
    const c = stageCard(byNote.get(n.id) ?? []);
    stage.set(n.term_norm, c ? cardStage(c, at) : 'new');
  }
  return { known, stage };
}

function groupCards(cards: readonly Card[]): Map<Id, Card[]> {
  const out = new Map<Id, Card[]>();
  for (const c of cards) {
    const list = out.get(c.note_id);
    if (list) list.push(c);
    else out.set(c.note_id, [c]);
  }
  return out;
}

export interface MyDeck {
  deck: Deck;
  filter: DeckFilter | null;
  /** Null when this app version cannot evaluate the deck. */
  mix: WordStageMix | null;
  /** Cards of the deck's words waiting today (reviews and learning steps, not new cards). */
  dueToday: number;
}

export interface MyDecksOverview {
  decks: MyDeck[];
  /** Every word ("Tüm kelimelerim"). */
  all: WordStageMix & { cards: number; dueToday: number };
  tagCount: number;
}

/** The Destelerim tab: every live deck with its stage mix and today's waiting cards. */
export async function getMyDecks(now: Millis = Date.now()): Promise<MyDecksOverview> {
  const [decks, facts, ctx, settings, notes] = await Promise.all([
    db.decks.toArray().then(orderDecks),
    loadDeckFacts(now),
    deckContext(now),
    getSettings(now),
    db.notes.filter((n) => n.deleted_at === null).toArray(),
  ]);
  const { end } = dayBounds(now, dayConfig(settings));
  const at = new Date(now);
  const stageOf = new Map<Id, WordStage | null>();
  const dueOf = new Map<Id, number>();
  let cardCount = 0;
  for (const f of facts) {
    const cards = fullCards(f);
    const c = stageCard(cards);
    stageOf.set(f.note.id, c ? cardStage(c, at) : null);
    cardCount += cards.length;
    dueOf.set(
      f.note.id,
      cards.filter((x) => !x.suspended && x.unlocked && x.state !== CardState.New && x.due < end)
        .length,
    );
  }
  const all = { ...emptyMix(), cards: cardCount, dueToday: 0 };
  for (const f of facts) {
    addStage(all, stageOf.get(f.note.id) ?? null);
    all.dueToday += dueOf.get(f.note.id) ?? 0;
  }
  const tags = new Set<string>();
  for (const n of notes) for (const t of n.tags) tags.add(t.toLocaleLowerCase('tr'));
  return {
    decks: decks.map((deck) => {
      const parsed = parseDeckFilter(deck.filter);
      const ids = deckNoteIds(deck.filter, facts, ctx);
      if (!ids) return { deck, filter: parsed.ok ? parsed.filter : null, mix: null, dueToday: 0 };
      const mix = emptyMix();
      let dueToday = 0;
      for (const id of ids) {
        addStage(mix, stageOf.get(id) ?? null);
        dueToday += dueOf.get(id) ?? 0;
      }
      return { deck, filter: parsed.ok ? parsed.filter : null, mix, dueToday };
    }),
    all,
    tagCount: tags.size,
  };
}

export interface DeckWordRow {
  note: Note;
  /** First meaning (the user's correction wins). */
  meaning: string | null;
  pos: string | null;
  stage: WordStage | null;
}

/** One deck's words for its detail page, newest first. Null: missing, deleted or not evaluable. */
export async function getDeckWords(
  deckId: Id,
  now: Millis = Date.now(),
): Promise<{ deck: Deck; filter: DeckFilter | null; words: DeckWordRow[] } | null> {
  const deck = await db.decks.get(deckId);
  if (!deck || deck.deleted_at !== null) return null;
  const [facts, ctx] = await Promise.all([loadDeckFacts(now), deckContext(now)]);
  const parsed = parseDeckFilter(deck.filter);
  const ids = deckNoteIds(deck.filter, facts, ctx);
  if (!ids) return { deck, filter: null, words: [] };
  const at = new Date(now);
  const chosen = facts.filter((f) => ids.has(f.note.id));
  const senses = await db.senses.where('note_id').anyOf([...ids]).toArray();
  const first = new Map<Id, (typeof senses)[number]>();
  for (const s of senses.filter((x) => x.deleted_at === null).sort((a, b) => a.sense_no - b.sense_no))
    if (!first.has(s.note_id)) first.set(s.note_id, s);
  const words = chosen
    .map((f): DeckWordRow => {
      const s = first.get(f.note.id);
      const c = stageCard(fullCards(f));
      return {
        note: f.note as Note,
        meaning: s ? (s.meaning_tr_override ?? s.meaning_tr) : null,
        pos: s?.pos ?? null,
        stage: c ? cardStage(c, at) : null,
      };
    })
    .sort((a, b) => b.note.created_at - a.note.created_at);
  return { deck, filter: parsed.ok ? parsed.filter : null, words };
}

// ------------------------------------------------------------------ adding a suggested deck

export interface SuggestedAddResult {
  /** Words that got a new note. */
  added: number;
  /** Cards created. */
  cards: number;
  /** Words of the deck the user already had a card for (tagged, not touched otherwise). */
  alreadyCarded: number;
  /** Words skipped because the user marked them "Biliyorum". */
  known: number;
  /** The deck in Destelerim (created now, or the one that already shows this set). */
  deck: Deck | null;
}

/** The live deck that shows exactly this tag (a suggested deck added before), if any. */
export async function findTagDeck(tag: string): Promise<Deck | null> {
  for (const d of orderDecks(await db.decks.toArray())) {
    const p = parseDeckFilter(d.filter);
    if (!p.ok) continue;
    const f = p.filter;
    const onlyTag =
      f.tags?.length === 1 &&
      hasTag(f.tags, tag) &&
      !f.states?.length &&
      !f.levels?.length &&
      !f.topics?.length &&
      !f.addedWithinDays;
    if (onlyTag) return d;
  }
  return null;
}

/**
 * Adds a suggested deck: every word the user neither knows nor has gets a note (through the
 * normal add path, so a word that exists meanwhile is merged, never doubled), every word of the
 * set the user has a card for gets the deck's tag, and a smart deck on that tag appears in
 * Destelerim (once: adding again only adds what is new). `onProgress` gets (done, total).
 */
export async function addSuggestedDeck(
  words: readonly WordBankEntry[],
  name: string,
  opts: { onProgress?: (done: number, total: number) => void; now?: Millis } = {},
): Promise<SuggestedAddResult> {
  const now = opts.now ?? Date.now();
  const idx = await getOwnedIndex(now);
  const res: SuggestedAddResult = { added: 0, cards: 0, alreadyCarded: 0, known: 0, deck: null };
  const toAdd: WordBankEntry[] = [];
  const carded: string[] = [];
  for (const w of words) {
    const s = deckWordStatus(w, idx);
    if (s === 'new') toAdd.push(w);
    else if (s === 'known') res.known++;
    else carded.push(normalizeTerm(w.lemma_norm));
  }
  res.alreadyCarded = carded.length;

  const tag = name;
  for (const [i, w] of toAdd.entries()) {
    const r = await addNoteWithSenses({ ...bankNoteInput(w), tags: [tag] }, now + i);
    if (r.status !== 'existing') res.added++;
    else carded.push(r.note.term_norm);
    res.cards += r.createdCards.length;
    opts.onProgress?.(i + 1, toAdd.length);
  }
  if (carded.length) {
    const ids = (await db.notes.where('term_norm').anyOf(carded).toArray())
      .filter((n) => n.deleted_at === null)
      .map((n) => n.id);
    await setNoteTags(ids, { add: [tag] }, now + toAdd.length);
  }
  res.deck =
    (await findTagDeck(tag)) ??
    (res.added + carded.length > 0
      ? await createDeck({ name, filter: { v: 1, tags: [tag] } }, now + toAdd.length + 1)
      : null);
  return res;
}
