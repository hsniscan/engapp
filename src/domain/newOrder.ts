// Smart new-card order ("Akıllı yeni kart sırası", v0.4, docs/decisions/0039-smart-new-card-order.md).
// Pure: the data layer passes in per-note facts it read once (data/newOrder.ts); buildQueue
// (domain/queue.ts) calls selectNewCards instead of taking the new cards by insertion order.
//
// Which new cards are introduced today, in this order:
//   1. Priority: cards of notes the user typed in by hand (no source) in the last 7 days,
//      oldest first: an explicit intent signal, outside the level rule.
//   2. The mix, by level band against the learner's level X (the smart-extraction rule,
//      domain/candidates.ts): about 60 % at X, 30 % below X (closest level first), at most
//      10 % at X+1 (unknown level counts as X+1), nothing above X+1 while any card at or
//      below X+1 is left. Inside a band: an active source (recently imported, or one whose
//      words the user started in the last 7 days), an older hand-added card, word frequency
//      (zipf) and waiting time raise a card; a small per-user, per-day jitter breaks ties so
//      two accounts with the same cards do not see the same order.
//   3. Interference: a card that is confusable with a card already chosen today (same word
//      family, same lemma, a shared Turkish meaning, near spelling, a reported confusion or
//      contrast pair, a false friend) waits for another day while another card can take its
//      place.
// Stable within a day: every input is fixed for the day (seed from user + day, ages from the
// day's start), and cards introduced earlier today seed the selection, so re-opening the
// session continues the same sequence instead of reshuffling.
import { meaningAlternatives } from '../../supabase/functions/_shared/text';
import {
  CONTRAST_TERM_TYPE,
  contrastTerms,
  damerauLevenshtein,
  MAX_SPELLING_DISTANCE,
  MIN_SPELLING_LENGTH,
  pairKey,
} from './confusables';
import { type LevelData, levelRank, noteLevel } from './level';
import { normalizeTerm } from './normalize';
import type { CefrLevel, Id, LexiconSense, Millis, Note, NoteTermType, Sense } from './types';

const DAY_MS = 86_400_000;

/** Hand-added cards created this many days before today's start (or today) come first. */
export const MANUAL_PRIORITY_DAYS = 7;
/** Share targets of the mix: at the learner's level, below it, one level above (cap). */
export const SHARE_SAME = 0.6;
export const SHARE_LOWER = 0.3;
export const SHARE_NEXT_MAX = 0.1;
/** Candidates looked at per band before deciding it has only confusable cards left. */
const SCAN_LIMIT = 64;
/** Shortest common prefix that marks two words as one family without the morphology file. */
const STEM_MIN = 5;

/** What the order needs to know about one note (precomputed by the data layer). */
export interface NewNoteFacts {
  note_id: Id;
  term_norm: string;
  term_type: NoteTermType;
  created_at: Millis;
  /** Resolved level (user's own, lexicon, client level file); null = unknown. */
  cefr: CefrLevel | null;
  /** Word frequency (Zipf); null = unknown. */
  zipf: number | null;
  /** Every live sense has no source: typed in by the user (or a root / contrast card they made). */
  manual: boolean;
  /** Source of the note's senses (the first one with a source); null = none. */
  source_id: Id | null;
  /** Word-family id from the morphology file; null = unknown. */
  family: string | number | null;
  /** Dictionary lemma (lexicon lemma_norm, else term_norm). */
  lemma: string;
  /** Turkish meaning alternatives of its live senses (meaningAlternatives). */
  meanings: readonly string[];
  /** A contrast card: its two terms, normalised. */
  contrast: readonly [string, string] | null;
}

export interface NewOrderInput {
  level: CefrLevel;
  /** newOrderSeed(user, day). */
  seed: number;
  /** Start of today's local day: ages and the priority window are measured from it. */
  dayStart: Millis;
  notes: ReadonlyMap<Id, NewNoteFacts>;
  /** Sources the user is working on (recent import, or words started in the last 7 days). */
  activeSources: ReadonlySet<Id>;
  /** Known confusable pairs (pairKey of two term_norms): reported, contrast cards, false friends. */
  pairs: ReadonlySet<string>;
  /** Notes of the cards introduced earlier today (they seed the day's quotas and conflicts). */
  introducedToday: readonly Id[];
}

export type NewBand = 'priority' | 'same' | 'lower' | 'next' | 'above';
export type NewReason = 'manual' | 'source' | 'level' | 'gap' | 'stretch' | 'beyond';

export interface NewCardLike {
  id: Id;
  note_id: Id;
  card_type: string;
  created_at: Millis;
}

/**
 * The facts of one note, from its live senses (display order), their cached lexicon rows and
 * the client level file. `familyOf`: word-family id of a lemma (morphology file), if loaded.
 */
export function noteFacts(
  note: Pick<Note, 'id' | 'term' | 'term_norm' | 'term_type' | 'created_at' | 'level_override'>,
  senses: readonly Pick<Sense, 'pos' | 'lexicon_sense_id' | 'meaning_tr' | 'meaning_tr_override' | 'source_id'>[],
  lexOf: (id: Id) => LexiconSense | undefined,
  data: LevelData | null,
  familyOf: (lemma: string) => string | number | null = () => null,
): NewNoteFacts {
  const level = noteLevel(note, [...senses], lexOf, data);
  const firstLex = senses.map((s) => (s.lexicon_sense_id ? lexOf(s.lexicon_sense_id) : undefined)).find((x) => !!x);
  const lemma = firstLex?.lemma_norm || note.term_norm;
  const meanings = new Set<string>();
  for (const s of senses) for (const m of meaningAlternatives(s.meaning_tr_override?.trim() || s.meaning_tr)) meanings.add(m);
  const pair = note.term_type === CONTRAST_TERM_TYPE ? contrastTerms(note.term) : null;
  return {
    note_id: note.id,
    term_norm: note.term_norm,
    term_type: note.term_type,
    created_at: note.created_at,
    cefr: level?.cefr ?? null,
    zipf: (data?.lookup(lemma) ?? data?.lookup(note.term_norm))?.zipf ?? null,
    manual: senses.every((s) => !s.source_id),
    source_id: senses.find((s) => !!s.source_id)?.source_id ?? null,
    family: note.term_type === 'word' ? familyOf(lemma) : null,
    lemma,
    meanings: [...meanings],
    contrast: pair ? [normalizeTerm(pair[0]), normalizeTerm(pair[1])] : null,
  };
}

// ------------------------------------------------------------------ seed and jitter

/** 32-bit FNV-1a, mixed (deterministic on every platform). */
function hash32(s: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** The day's seed of one user (the account id, or the guest's settings creation time). */
export function newOrderSeed(userKey: string, day: string): number {
  return hash32(`${userKey}|${day}`);
}

/** Deterministic value in [0, 1) for a card on this seed. */
export function jitter(seed: number, cardId: Id): number {
  return hash32(cardId, seed) / 0x1_0000_0000;
}

// ------------------------------------------------------------------ bands and scores

const unknownFacts = (noteId: Id): NewNoteFacts => ({
  note_id: noteId,
  term_norm: '',
  term_type: 'word',
  created_at: 0,
  cefr: null,
  zipf: null,
  manual: false,
  source_id: null,
  family: null,
  lemma: '',
  meanings: [],
  contrast: null,
});

function levelDistance(cefr: CefrLevel | null, level: CefrLevel): number {
  return cefr === null ? 1 : levelRank(cefr) - levelRank(level);
}

/** Band of a note for a learner at `level` (priority aside). */
export function bandOf(f: NewNoteFacts, level: CefrLevel, active: boolean, dayStart: Millis): NewBand {
  if (f.manual && f.created_at >= dayStart - MANUAL_PRIORITY_DAYS * DAY_MS) return 'priority';
  const d = levelDistance(f.cefr, level);
  if (d === 0) return 'same';
  if (d < 0) return 'lower';
  // The user chose these (by hand or by working on the source): never held back for good.
  if (d === 1 || f.manual || active) return 'next';
  return 'above';
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Higher first. Fixed for the day: ages count from the day's start. */
function scoreOf(c: NewCardLike, f: NewNoteFacts, input: NewOrderInput, active: boolean): number {
  const zipf = f.zipf === null ? 0.35 : clamp((f.zipf - 2) / 5, 0, 1);
  const created = f.created_at || c.created_at;
  const ageDays = clamp((input.dayStart - created) / DAY_MS, 0, 365);
  let s = zipf + Math.min(0.4, ageDays / 150) + (jitter(input.seed, c.id) - 0.5) * 0.3;
  // The source the user is working on leads its band (above any frequency or age).
  if (active) s += 2;
  if (f.manual) s += 0.4;
  // Below the level: the closest level first (an A2 gap before an A1 gap for a B1 learner).
  const d = levelDistance(f.cefr, input.level);
  if (d < 0) s -= 0.25 * (-d - 1);
  // Introduce the word itself before its production / cloze practice.
  if (c.card_type === 'recognition') s += 0.05;
  return s;
}

// ------------------------------------------------------------------ interference

const stem = (t: string) => ([...t].length >= STEM_MIN ? [...t].slice(0, STEM_MIN).join('') : null);

function commonPrefix(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

/** Strings made by deleting up to two characters (symmetric-delete keys of a spelling pair). */
function deletions(word: string): string[] {
  // Code units are code points unless the term has a surrogate pair (rare in English terms).
  const astral = /[\uD800-\uDFFF]/.test(word);
  const out = new Set<string>([word]);
  let frontier = [word];
  for (let d = 0; d < MAX_SPELLING_DISTANCE; d++) {
    const next: string[] = [];
    for (const w of frontier) {
      const cps = astral ? [...w] : null;
      const n = cps ? cps.length : w.length;
      for (let i = 0; i < n; i++) {
        const v = cps ? cps.slice(0, i).join('') + cps.slice(i + 1).join('') : w.slice(0, i) + w.slice(i + 1);
        if (!out.has(v)) {
          out.add(v);
          next.push(v);
        }
      }
    }
    frontier = next;
  }
  return [...out];
}

const isWord = (f: NewNoteFacts) => f.term_type === 'word' || f.term_type === 'phrase' || f.term_type === 'pattern';

/**
 * Two notes that should not be introduced on the same day: same family or lemma, a shared
 * Turkish meaning alternative, near spelling (the confusables rule), an obvious derivation
 * (a long common prefix: "employ" / "employer"), a known pair, or a contrast card and one of
 * its terms.
 */
export function confusable(a: NewNoteFacts, b: NewNoteFacts, pairs: ReadonlySet<string>): boolean {
  if (a.note_id === b.note_id) return true;
  if (!a.term_norm || !b.term_norm) return false;
  if (a.contrast?.includes(b.term_norm) || b.contrast?.includes(a.term_norm)) return true;
  if (a.contrast && b.contrast && a.contrast.some((t) => b.contrast!.includes(t))) return true;
  if (!isWord(a) || !isWord(b)) return false;
  if (a.family !== null && a.family === b.family) return true;
  if (a.lemma && a.lemma === b.lemma) return true;
  if (pairs.has(pairKey(a.term_norm, b.term_norm))) return true;
  if (a.meanings.some((m) => b.meanings.includes(m))) return true;
  const la = [...a.term_norm].length;
  const lb = [...b.term_norm].length;
  const short = Math.min(la, lb);
  if (short >= STEM_MIN && commonPrefix(a.term_norm, b.term_norm) >= Math.max(STEM_MIN, Math.ceil(0.7 * short))) return true;
  if (la >= MIN_SPELLING_LENGTH && lb >= MIN_SPELLING_LENGTH && la <= 32 && lb <= 32)
    return damerauLevenshtein(a.term_norm, b.term_norm, MAX_SPELLING_DISTANCE) <= MAX_SPELLING_DISTANCE;
  return false;
}

/** Lookup keys under which a possibly confusable chosen note is found (then checked exactly). */
function keysOf(f: NewNoteFacts, partners: ReadonlyMap<string, readonly string[]>): string[] {
  if (!f.term_norm) return [];
  const keys: string[] = [`t:${f.term_norm}`];
  for (const p of partners.get(f.term_norm) ?? []) keys.push(`t:${p}`);
  if (f.contrast) for (const t of f.contrast) keys.push(`t:${t}`);
  if (!isWord(f)) return keys;
  if (f.family !== null) keys.push(`f:${f.family}`);
  if (f.lemma) keys.push(`l:${f.lemma}`);
  for (const m of f.meanings) keys.push(`m:${m}`);
  const s = stem(f.term_norm);
  if (s) keys.push(`s:${s}`);
  const len = [...f.term_norm].length;
  if (len >= MIN_SPELLING_LENGTH && len <= 32) for (const v of deletions(f.term_norm)) keys.push(`d:${v}`);
  return keys;
}

const NO_PARTNERS: ReadonlyMap<string, readonly string[]> = new Map();

function partnerMap(pairs: ReadonlySet<string>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const k of pairs) {
    const [a, b] = k.split('\u0000');
    if (!a || !b) continue;
    (out.get(a) ?? out.set(a, []).get(a)!).push(b);
    (out.get(b) ?? out.set(b, []).get(b)!).push(a);
  }
  return out;
}

// ------------------------------------------------------------------ selection

interface Entry<T> {
  card: T;
  facts: NewNoteFacts;
  band: NewBand;
  score: number;
}

export interface NewSelection<T> {
  cards: T[];
  /** Why each chosen card came today, by card id (for a "neden bu kelime?" hint). */
  reasons: Map<Id, NewReason>;
}

/**
 * Today's new cards, in introduction order: at most `limit`, skipping cards for which
 * `blocked` is true (their note is already in today's queue). See the header for the rule.
 */
export function selectNewCards<T extends NewCardLike>(
  fresh: readonly T[],
  limit: number,
  blocked: (c: T) => boolean,
  input: NewOrderInput,
): NewSelection<T> {
  const reasons = new Map<Id, NewReason>();
  const out: T[] = [];
  if (limit <= 0 || fresh.length === 0) return { cards: out, reasons };
  const factsOf = (noteId: Id) => input.notes.get(noteId) ?? unknownFacts(noteId);
  const isActive = (f: NewNoteFacts) => f.source_id !== null && input.activeSources.has(f.source_id);
  const partners = partnerMap(input.pairs);

  const lists: Record<NewBand, Entry<T>[]> = { priority: [], same: [], lower: [], next: [], above: [] };
  for (const c of fresh) {
    const facts = factsOf(c.note_id);
    const active = isActive(facts);
    const band = bandOf(facts, input.level, active, input.dayStart);
    lists[band].push({ card: c, facts, band, score: band === 'priority' ? 0 : scoreOf(c, facts, input, active) });
  }
  const byId = (a: Entry<T>, b: Entry<T>) => (a.card.id < b.card.id ? -1 : a.card.id > b.card.id ? 1 : 0);
  lists.priority.sort(
    (a, b) =>
      a.facts.created_at - b.facts.created_at ||
      (a.facts.note_id < b.facts.note_id ? -1 : a.facts.note_id > b.facts.note_id ? 1 : 0) ||
      Number(b.card.card_type === 'recognition') - Number(a.card.card_type === 'recognition') ||
      a.card.created_at - b.card.created_at ||
      byId(a, b),
  );
  for (const b of ['same', 'lower', 'next', 'above'] as const) lists[b].sort((x, y) => y.score - x.score || byId(x, y));

  // Today's chosen notes, by lookup key, seeded with the cards introduced earlier today.
  const chosen = new Map<string, NewNoteFacts[]>();
  const chosenNotes = new Set<Id>();
  const counts = { same: 0, lower: 0, next: 0, above: 0 };
  const remember = (f: NewNoteFacts) => {
    chosenNotes.add(f.note_id);
    // Stored under its own keys; a candidate looks up its partners' terms too.
    for (const k of keysOf(f, NO_PARTNERS)) (chosen.get(k) ?? chosen.set(k, []).get(k)!).push(f);
  };
  for (const noteId of input.introducedToday) {
    if (chosenNotes.has(noteId)) continue;
    const f = factsOf(noteId);
    const band = bandOf(f, input.level, isActive(f), input.dayStart);
    if (band !== 'priority') counts[band]++;
    remember(f);
  }
  // Once confusable with a chosen note, always (the chosen set only grows).
  const conflicted = new Set<Id>();
  const keyCache = new Map<Id, string[]>();
  const conflicts = (f: NewNoteFacts): boolean => {
    if (conflicted.has(f.note_id)) return true;
    let keys = keyCache.get(f.note_id);
    if (!keys) keyCache.set(f.note_id, (keys = keysOf(f, partners)));
    for (const k of keys) {
      for (const g of chosen.get(k) ?? []) {
        if (confusable(f, g, input.pairs)) {
          conflicted.add(f.note_id);
          return true;
        }
      }
    }
    return false;
  };

  const taken = new Set<Id>();
  const heads: Record<NewBand, number> = { priority: 0, same: 0, lower: 0, next: 0, above: 0 };
  const usable = (e: Entry<T>) => !taken.has(e.card.id) && !chosenNotes.has(e.card.note_id) && !blocked(e.card);
  /** First usable entry of a band (moves the head past used ones); with `strict`, not confusable. */
  const pick = (band: NewBand, strict: boolean): Entry<T> | null => {
    const list = lists[band];
    while (heads[band] < list.length && !usable(list[heads[band]]!)) heads[band]++;
    let looked = 0;
    for (let i = heads[band]; i < list.length; i++) {
      const e = list[i]!;
      if (!usable(e)) continue;
      if (!strict || !conflicts(e.facts)) return e;
      if (++looked >= SCAN_LIMIT) return null;
    }
    return null;
  };
  const hasLeft = (band: NewBand) => pick(band, false) !== null;

  /** Mix bands in the order to try now: the largest shortfall against its share first. */
  const mixOrder = (): ('same' | 'lower' | 'next')[] => {
    const left = { same: hasLeft('same'), lower: hasLeft('lower'), next: hasLeft('next') };
    const n = counts.same + counts.lower + counts.next + counts.above;
    let ws = SHARE_SAME;
    let wl = SHARE_LOWER;
    if (!left.same) wl += ws;
    if (!left.lower) ws += wl;
    const deficit = {
      same: ws * (n + 1) - counts.same,
      lower: wl * (n + 1) - counts.lower,
      next: SHARE_NEXT_MAX * (n + 1) - counts.next,
    };
    const out: ('same' | 'lower' | 'next')[] = [];
    if (left.same) out.push('same');
    if (left.lower) out.push('lower');
    // X+1 only within its cap (integer test: 10 · next ≤ n), or when nothing at or below the
    // level is left.
    if (left.next && (10 * (counts.next + 1) <= n + 1 || (!left.same && !left.lower))) out.push('next');
    const rank = { same: 0, lower: 1, next: 2 };
    out.sort((a, b) => deficit[b] - deficit[a] || rank[a] - rank[b]);
    return out;
  };

  while (out.length < limit) {
    let e: Entry<T> | null = pick('priority', true);
    if (!e) {
      const order = mixOrder();
      for (const b of order) if ((e = pick(b, true))) break;
      // A card one level up rather than a confusable one at the level.
      if (!e && !order.includes('next')) e = pick('next', true);
      // Only confusable cards left: take the best of them after all.
      if (!e) e = pick('priority', false);
      if (!e) for (const b of order) if ((e = pick(b, false))) break;
      if (!e) e = pick('next', false);
      // Never above X+1 while anything at or below it is left.
      if (!e) e = pick('above', true) ?? pick('above', false);
    }
    if (!e) break;
    taken.add(e.card.id);
    remember(e.facts);
    if (e.band !== 'priority') counts[e.band]++;
    out.push(e.card);
    reasons.set(e.card.id, reasonOf(e, isActive(e.facts)));
  }
  return { cards: out, reasons };
}

function reasonOf(e: Entry<NewCardLike>, active: boolean): NewReason {
  if (e.band === 'priority') return 'manual';
  if (active) return 'source';
  return e.band === 'same' ? 'level' : e.band === 'lower' ? 'gap' : e.band === 'next' ? 'stretch' : 'beyond';
}
